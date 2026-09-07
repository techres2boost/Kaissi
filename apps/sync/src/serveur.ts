/**
 * API de synchronisation — Hono sur Node.
 *
 * Pourquoi un process Node dédié plutôt que PostgREST ou une Edge Function :
 *   • PostgREST expose des tables ; le push a besoin de validation
 *     transactionnelle, d'idempotence et de reprojection ;
 *   • une Edge Function redémarre à froid et ne réutilise pas ses connexions
 *     — la latence du push en pâtirait, et le push est sur le chemin de
 *     la réconciliation d'une caisse.
 */

import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import type { AppareilAuthentifie, DepotSync } from './depot.js'
import { jetonDepuisEntete, empreinteDe } from './jeton.js'
import { ErreurSync, VERSION_PROTOCOLE, type ReponseErreur } from './protocole.js'
import { ServiceSync } from './service.js'
import {
  configAuthDepuisEnvironnement,
  identifierParMotDePasse,
  ErreurAuth,
  type ConfigAuth,
} from './auth-supabase.js'
import {
  changerMotDePasse,
  cleServiceDepuisEnvironnement,
  creerCompteSupabase,
  identifierParJeton,
  ROLES_ACCES,
  ROLES_QUI_DONNENT_LES_CLES,
  verifierEmail,
  verifierMotDePasse,
} from './admin-comptes.js'

/**
 * Variables portées par le contexte de requête.
 * Déclarées explicitement : sans cela, `c.get('appareil')` rendrait `unknown`
 * et l'identité de l'appareil circulerait sans type dans tout le serveur.
 */
type VariablesKaissi = { appareil: AppareilAuthentifie }
type ContexteKaissi = Context<{ Variables: VariablesKaissi }>

/** Forme d'un UUID, toutes versions confondues. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface OptionsServeur {
  readonly depot: DepotSync
  /** Origines autorisées. Le POS empaqueté n'en a pas besoin ; le
   *  back-office et les outils de diagnostic, oui. */
  readonly origines?: readonly string[]
  /** Supabase Auth, pour l'appairage par identifiants. Absent : la route
   *  répond 501 et les terminaux déjà appairés continuent normalement. */
  readonly auth?: ConfigAuth | null
  /** Injectable pour les tests : le seul appel réseau sortant du service. */
  readonly fetchAuth?: typeof fetch
  /**
   * Clé `service_role` de Supabase — pour CRÉER un compte de back-office.
   *
   * Elle ne vit QUE dans ce service : ni dans le back-office, ni dans l'APK.
   * Absente, les routes `/admin/*` répondent 501 et `pnpm sync:acces` reste
   * le chemin. Rien d'autre ne dépend d'elle.
   */
  readonly cleService?: string | null
}

export function creerServeur({
  depot,
  origines,
  auth = configAuthDepuisEnvironnement(),
  fetchAuth,
  cleService = cleServiceDepuisEnvironnement(),
}: OptionsServeur) {
  const service = new ServiceSync(depot)
  const app = new Hono<{ Variables: VariablesKaissi }>()

  // Les origines de la coque Capacitor sont TOUJOURS autorisées.
  //
  // Le POS empaqueté appelle nativement (plugin CapacitorHttp), donc il ne
  // dépend pas de CORS. Mais tout diagnostic depuis la WebView, et toute
  // configuration où le plugin serait désactivé, se heurterait sinon à une
  // réponse jetée par le navigateur avec « Failed to fetch » — un message
  // qui ne dit ni d'où vient le refus, ni comment le lever.
  //
  // Autoriser ces origines ne relâche rien : l'authentification reste le
  // jeton d'appareil. CORS protège l'utilisateur d'un SITE tiers, or il n'y
  // a pas de session de navigateur à voler ici — aucun cookie, aucune
  // identité implicite.
  const ORIGINES_CAPACITOR = ['https://localhost', 'http://localhost', 'capacitor://localhost']
  const corsKaissi = cors({
    origin: [...ORIGINES_CAPACITOR, ...(origines ?? [])],
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  })
  app.use('/sync/*', corsKaissi)
  app.use('/appairage', corsKaissi)
  app.use('/admin/*', corsKaissi)

  // ── Santé ────────────────────────────────────────────────────────────
  // Sans authentification : c'est ce que sonde l'hébergeur.
  // `/sante` joint la BASE, pas seulement le processus. Un contrôle de santé
  // qui répond « ok » parce que Node tourne ne surveille rien : c'est lui
  // qui décide si une plateforme redémarre le service ou le laisse dans un
  // état où aucune tablette ne peut se synchroniser.
  app.get('/sante', async (c) => {
    try {
      await depot.verifier()
    } catch (erreur) {
      return c.json(
        {
          etat: 'degrade',
          protocole: VERSION_PROTOCOLE,
          horodatage: new Date().toISOString(),
          base: erreur instanceof Error ? erreur.message : String(erreur),
        },
        503,
      )
    }
    return c.json({
      etat: 'ok',
      protocole: VERSION_PROTOCOLE,
      horodatage: new Date().toISOString(),
      base: 'joignable',
    })
  })

  // ── POST /appairage ──────────────────────────────────────────────────
  //
  // La SEULE route qui ne demande pas de jeton d'appareil : c'est elle qui
  // en délivre un. Un gérant saisit ses identifiants sur la tablette, et
  // celle-ci reçoit son jeton — plus rien à recopier à la main.
  //
  // Le modèle d'identités ne change pas : le jeton d'appareil reste ce qui
  // authentifie la caisse, révocable, distinct du compte et du PIN employé.
  // Seule sa REMISE est automatisée.
  app.post('/appairage', async (c) => {
    if (!auth) {
      // On NOMME ce qui manque, une variable à la fois.
      //
      // « non configuré » sans plus de détail envoie relire deux réglages
      // dont l'un est déjà bon — et une faute de frappe dans un nom de
      // variable est invisible à l'œil sur un tableau de bord d'hébergeur.
      const absentes = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter(
        (nom) => !(process.env[nom] ?? '').trim(),
      )
      const corps: ReponseErreur = {
        erreur: 'appairage_indisponible',
        message:
          "L'appairage par identifiants n'est pas configuré sur ce serveur. " +
          `Variable(s) absente(s) ou vide(s) : ${absentes.join(', ')}. ` +
          "Vérifiez l'orthographe EXACTE du nom sur l'hébergeur, puis " +
          'redéployez — une variable ajoutée ne prend effet qu’au redémarrage.',
      }
      return c.json(corps, 501)
    }

    let brut: unknown
    try {
      brut = await c.req.json()
    } catch {
      const corps: ReponseErreur = { erreur: 'requete_invalide', message: 'Corps JSON illisible.' }
      return c.json(corps, 400)
    }
    const { email, motDePasse, restaurantId, libelle, installationId } = (brut ?? {}) as Record<
      string,
      unknown
    >
    if (typeof email !== 'string' || typeof motDePasse !== 'string' || !email || !motDePasse) {
      const corps: ReponseErreur = {
        erreur: 'requete_invalide',
        message: 'E-mail et mot de passe sont requis.',
      }
      return c.json(corps, 400)
    }

    // L'identifiant d'installation part vers une colonne `uuid` : une valeur
    // mal formée provoquerait une erreur de conversion Postgres, donc un 500
    // qui ne dit rien. On la refuse ici, avec son nom.
    if (installationId !== undefined && !UUID.test(String(installationId))) {
      const corps: ReponseErreur = {
        erreur: 'requete_invalide',
        message: "L'identifiant d'installation doit être un UUID.",
      }
      return c.json(corps, 400)
    }

    try {
      const identite = await identifierParMotDePasse(auth, email, motDePasse, fetchAuth)
      const etablissements = await depot.etablissementsEnrolables(identite.userId)

      if (etablissements.length === 0) {
        const corps: ReponseErreur = {
          erreur: 'aucun_etablissement',
          message:
            "Ce compte n'est gérant d'aucun établissement. Demandez à " +
            "l'administrateur de vous y rattacher.",
        }
        return c.json(corps, 403)
      }

      // Plusieurs établissements et aucun choix : on rend la liste plutôt
      // que d'en choisir un au hasard. Enrôler la caisse dans le mauvais
      // restaurant enverrait ses ventes au mauvais endroit.
      const choisi =
        typeof restaurantId === 'string'
          ? etablissements.find((e) => e.restaurantId === restaurantId)
          : etablissements.length === 1
            ? etablissements[0]
            : undefined

      if (!choisi) {
        if (typeof restaurantId === 'string') {
          const corps: ReponseErreur = {
            erreur: 'etablissement_refuse',
            message: "Ce compte n'est pas gérant de cet établissement.",
          }
          return c.json(corps, 403)
        }
        return c.json({
          choix: etablissements.map((e) => ({ restaurantId: e.restaurantId, nom: e.nom })),
        })
      }

      const enrole = await depot.enrolerAppareil({
        restaurantId: choisi.restaurantId,
        libelle: typeof libelle === 'string' && libelle.trim() ? libelle.trim() : 'Terminal',
        ...(typeof installationId === 'string' ? { installationId } : {}),
      })

      return c.json({
        jeton: enrole.jeton,
        deviceId: enrole.deviceId,
        restaurantId: enrole.restaurantId,
        organizationId: enrole.organizationId,
        nomEtablissement: enrole.nomEtablissement,
        prefixe: enrole.prefixe,
        reprise: enrole.reprise,
      })
    } catch (erreur) {
      if (erreur instanceof ErreurAuth) {
        const corps: ReponseErreur = { erreur: 'identifiants_refuses', message: erreur.message }
        return c.json(corps, erreur.statut)
      }
      return reponseErreur(c, erreur)
    }
  })

  // ── Authentification par jeton d'appareil ────────────────────────────
  app.use('/sync/*', async (c, next) => {
    const jeton = jetonDepuisEntete(c.req.header('authorization'))
    if (!jeton) {
      const corps: ReponseErreur = { erreur: 'jeton_absent', message: "Jeton d'appareil absent." }
      return c.json(corps, 401)
    }
    const appareil = await depot.appareilParJeton(empreinteDe(jeton))
    if (!appareil) {
      // Message identique à celui d'un jeton révoqué : ne pas dire à un
      // curieux si le jeton existe.
      const corps: ReponseErreur = {
        erreur: 'jeton_invalide',
        message: "Jeton d'appareil invalide ou révoqué.",
      }
      return c.json(corps, 401)
    }
    if (appareil.revoque) {
      const corps: ReponseErreur = {
        erreur: 'appareil_revoque',
        message:
          'Cet appareil a été révoqué. Contactez le gérant pour le réappairer. ' +
          'Vos ventes locales ne sont pas perdues.',
      }
      return c.json(corps, 403)
    }
    c.set('appareil', appareil)
    await next()
  })


  // ── POST /admin/comptes ──────────────────────────────────────────────
  //
  // Ouvre un accès au back-office : crée le compte Supabase s'il n'existe
  // pas, puis le relie à l'établissement avec un rôle. C'est ce que faisait
  // « tableau de bord Supabase, PUIS pnpm sync:acces » — un enchaînement
  // qu'aucun restaurateur ne fera.
  //
  // L'appelant s'identifie par le JETON de sa session back-office ; ses
  // droits sont relus EN BASE. Le service parle à Postgres avec un rôle
  // privilégié : RLS ne le filtre pas, donc c'est cette relecture-là qui
  // décide, jamais une confiance faite au client.
  app.post('/admin/comptes', async (c) => {
    return adminSupabase(c, async ({ config, cle, appelant, corps }) => {
      const restaurantId = String(corps['restaurantId'] ?? '')
      if (!UUID.test(restaurantId)) {
        throw new ErreurAuth("L'établissement doit être un UUID.", 401)
      }
      const roleAppelant = await depot.roleDansEtablissement(appelant.userId, restaurantId)
      if (roleAppelant === null || !ROLES_QUI_DONNENT_LES_CLES.includes(roleAppelant)) {
        throw new ErreurAuth(
          "Votre rôle ne permet pas d'ouvrir un accès dans cet établissement.",
          401,
        )
      }

      const role = String(corps['role'] ?? '')
      if (!(ROLES_ACCES as readonly string[]).includes(role)) {
        throw new ErreurAuth(`Rôle inconnu « ${role} ».`, 401)
      }
      // Un gérant EXPLOITE, un administrateur DISTRIBUE (migration 0024).
      // Sans ce contrôle, cette route contournerait la frontière que RLS
      // pose ailleurs : un gérant se créerait un second gérant.
      if (ROLES_QUI_DONNENT_LES_CLES.includes(role) && roleAppelant !== 'admin') {
        throw new ErreurAuth(
          `Seul un administrateur peut accorder le rôle « ${role} ».`,
          401,
        )
      }

      const email = verifierEmail(corps['email'])
      const motDePasse = verifierMotDePasse(corps['motDePasse'])
      const nom = String(corps['nom'] ?? '').trim() || email.split('@')[0]!

      const cree = await creerCompteSupabase(config, cle, email, motDePasse, fetchAuth)
      let authUserId = cree.authUserId
      if (!authUserId) {
        // L'adresse avait déjà un compte : on le retrouve pour le rattacher.
        // Son mot de passe n'est PAS écrasé — on n'écrase pas silencieusement
        // le mot de passe d'un compte qui appartient peut-être à quelqu'un
        // d'autre. Le bouton « changer le mot de passe » est un geste à part.
        const compte = await depot.compteParEmail(email)
        if (!compte) {
          throw new ErreurAuth(
            'Cette adresse a déjà un compte Supabase, introuvable dans cette base. ' +
              'Il appartient sans doute à un autre projet.',
            500,
          )
        }
        authUserId = compte.id
      }

      const { employeId, cree: employeCree } = await depot.rattacherAcces({
        restaurantId,
        authUserId,
        email,
        nom,
        role,
      })

      return {
        employeId,
        email,
        role,
        compteCree: cree.nouveau,
        employeCree,
        message: cree.nouveau
          ? `Compte créé. ${email} peut se connecter au back-office dès maintenant.`
          : `Cette adresse avait déjà un compte : il est désormais rattaché à cet établissement (${role}).`,
      }
    })
  })

  // ── GET /admin/etablissements ────────────────────────────────────────
  //
  // « Où suis-je administrateur ? » — la question que le back-office pose
  // avant de proposer d'ouvrir un établissement. La réponse est relue EN
  // BASE, jamais déduite de ce que le client affirme.
  app.post('/admin/etablissements', async (c) => {
    return adminSupabase(c, async ({ appelant }) => {
      const administres = await depot.etablissementsAdministres(appelant.userId)
      return {
        // Une seule organisation en pratique ; la liste reste ouverte parce
        // que le schéma, lui, l'est depuis le premier jour.
        organisations: [...new Set(administres.map((e) => e.organizationId))],
        etablissements: administres,
      }
    })
  })

  // ── POST /admin/restaurants ──────────────────────────────────────────
  //
  // Ouvrir un NOUVEL établissement. Réservé à un administrateur : un gérant
  // exploite le sien, il n'en ouvre pas un second (migration 0024).
  //
  // Pourquoi ici et pas en base, sous RLS : la toute PREMIÈRE appartenance
  // ne peut pas être créée sous RLS — il faudrait déjà appartenir à
  // l'établissement pour s'y rattacher. Un restaurant créé sans appartenance
  // serait invisible de tout le monde, y compris de son auteur.
  app.post('/admin/restaurants', async (c) => {
    return adminSupabase(c, async ({ appelant, corps }) => {
      const administres = await depot.etablissementsAdministres(appelant.userId)
      if (administres.length === 0) {
        throw new ErreurAuth(
          "Seul un administrateur peut ouvrir un établissement. Votre compte n'administre aucun établissement existant.",
          401,
        )
      }

      const nom = String(corps['nom'] ?? '').trim()
      if (nom.length < 2 || nom.length > 200) {
        throw new ErreurAuth("Le nom de l'établissement doit faire entre 2 et 200 caractères.", 401)
      }

      /*
       * L'organisation vient du MODÈLE, pas du client.
       *
       * Laisser passer un `organizationId` dans le corps de la requête
       * permettrait à un administrateur d'ouvrir un établissement chez un
       * autre client — le service parle à Postgres avec un rôle privilégié,
       * RLS ne l'arrêterait pas. Elle est donc dérivée d'un établissement
       * qu'il administre DÉJÀ.
       */
      const modeleDemande = String(corps['modeleRestaurantId'] ?? '')
      const modele = modeleDemande
        ? administres.find((e) => e.restaurantId === modeleDemande)
        : administres[0]
      if (!modele) {
        throw new ErreurAuth(
          "L'établissement modèle doit être un établissement que vous administrez.",
          401,
        )
      }

      // Le fuseau par défaut est celui du produit, pas celui du serveur :
      // un conteneur en Europe ne doit pas décider de la journée
      // commerciale d'un restaurant tunisien.
      const timezone = String(corps['timezone'] ?? '').trim() || 'Africa/Tunis'
      const bascule = String(corps['bascule'] ?? '').trim() || '04:00'
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(bascule)) {
        throw new ErreurAuth('L\u2019heure de bascule doit s\u2019écrire « 04:00 ».', 401)
      }

      const { restaurantId, reglagesCopies } = await depot.creerEtablissement({
        organizationId: modele.organizationId,
        nom,
        timezone,
        bascule,
        modeleRestaurantId: modele.restaurantId,
        authUserId: appelant.userId,
      })

      return {
        restaurantId,
        reglagesCopies,
        message:
          `Établissement « ${nom} » ouvert, avec ${reglagesCopies} réglage(s) repris de ` +
          `« ${modele.nom} » — taux de taxe, modes de paiement et postes. La carte, elle, ` +
          'reste à saisir : on ne devine pas un menu.',
      }
    })
  })

  // ── POST /admin/mot-de-passe ─────────────────────────────────────────
  //
  // « J'ai perdu le mot de passe du cuisinier. » Le PIN se réinitialise au
  // back-office ; le MOT DE PASSE, lui, appartient à Supabase Auth et
  // exigeait jusqu'ici le tableau de bord. Ce sont deux identités
  // distinctes, et les confondre mène soit à des reconnexions permanentes,
  // soit à une traçabilité inexistante.
  app.post('/admin/mot-de-passe', async (c) => {
    return adminSupabase(c, async ({ config, cle, appelant, corps }) => {
      const restaurantId = String(corps['restaurantId'] ?? '')
      const employeId = String(corps['employeId'] ?? '')
      if (!UUID.test(restaurantId) || !UUID.test(employeId)) {
        throw new ErreurAuth("L'établissement et l'employé doivent être des UUID.", 401)
      }
      const roleAppelant = await depot.roleDansEtablissement(appelant.userId, restaurantId)
      if (roleAppelant === null || !ROLES_QUI_DONNENT_LES_CLES.includes(roleAppelant)) {
        throw new ErreurAuth('Votre rôle ne permet pas de changer ce mot de passe.', 401)
      }

      const cible = await depot.compteDeLEmploye(employeId, restaurantId)
      if (!cible) {
        throw new ErreurAuth(
          "Cet employé n'a pas de compte de back-office. Ouvrez-lui un accès plutôt.",
          401,
        )
      }
      // Un gérant ne remet pas le mot de passe d'un administrateur : ce
      // serait prendre sa place. La frontière est la même que partout.
      const roleCible = await depot.roleDansEtablissement(cible.authUserId, restaurantId)
      if (roleCible && ROLES_QUI_DONNENT_LES_CLES.includes(roleCible) && roleAppelant !== 'admin') {
        throw new ErreurAuth(
          'Seul un administrateur peut changer le mot de passe d’un gérant ou d’un administrateur.',
          401,
        )
      }

      const motDePasse = verifierMotDePasse(corps['motDePasse'])
      await changerMotDePasse(config, cle, cible.authUserId, motDePasse, fetchAuth)
      return {
        email: cible.email,
        message: `Mot de passe changé. Communiquez-le à ${cible.email || 'l’intéressé'} de vive voix.`,
      }
    })
  })

  /**
   * Enveloppe commune aux routes d'administration.
   *
   * Elle réunit ce qui doit être vrai AVANT toute écriture : la
   * configuration Supabase présente, la clé de service présente, un jeton
   * d'appelant valide, un corps JSON lisible. Chacune de ces quatre absences
   * a son propre message — « non configuré » sans plus de détail envoie
   * relire quatre réglages dont trois sont déjà bons.
   */
  async function adminSupabase(
    c: ContexteKaissi,
    travail: (contexte: {
      config: ConfigAuth
      cle: string
      appelant: { userId: string; email: string }
      corps: Record<string, unknown>
    }) => Promise<unknown>,
  ) {
    if (!auth || !cleService) {
      const absentes = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
        (nom) => !(process.env[nom] ?? '').trim(),
      )
      const corps: ReponseErreur = {
        erreur: 'administration_indisponible',
        message:
          "La gestion des accès n'est pas configurée sur ce serveur. " +
          `Variable(s) absente(s) : ${absentes.join(', ')}. ` +
          'En attendant, `pnpm sync:acces` reste le chemin.',
      }
      return c.json(corps, 501)
    }

    const jeton = jetonDepuisEntete(c.req.header('authorization'))
    if (!jeton) {
      const corps: ReponseErreur = {
        erreur: 'jeton_absent',
        message: 'Jeton de session absent.',
      }
      return c.json(corps, 401)
    }

    let brut: unknown
    try {
      brut = await c.req.json()
    } catch {
      const corps: ReponseErreur = { erreur: 'requete_invalide', message: 'Corps JSON illisible.' }
      return c.json(corps, 400)
    }

    try {
      const appelant = await identifierParJeton(auth, jeton, fetchAuth)
      const resultat = await travail({
        config: auth,
        cle: cleService,
        appelant,
        corps: (brut ?? {}) as Record<string, unknown>,
      })
      return c.json(resultat as Record<string, unknown>)
    } catch (erreur) {
      if (erreur instanceof ErreurAuth) {
        const corps: ReponseErreur = { erreur: 'acces_refuse', message: erreur.message }
        return c.json(corps, erreur.statut)
      }
      const corps: ReponseErreur = {
        erreur: 'erreur_serveur',
        message: erreur instanceof Error ? erreur.message : 'Échec inattendu.',
      }
      return c.json(corps, 500)
    }
  }

  // ── GET /sync/appareil ───────────────────────────────────────────────
  // L'identité de l'appareil derrière le jeton. C'est ce que le POS lit au
  // moment de l'appairage : il connaît alors le device_id à apposer sur ses
  // événements. Sans cette étape, un terminal signe avec un identifiant qui
  // n'est pas celui que son jeton désigne, et le serveur refuse toutes ses
  // ventes avec « appareil_etranger » — le jeton est bon, mais l'événement
  // prétend venir d'ailleurs.
  app.get('/sync/appareil', (c) => {
    const appareil = c.get('appareil')
    return c.json({
      deviceId: appareil.deviceId,
      restaurantId: appareil.restaurantId,
      organizationId: appareil.organizationId,
    })
  })

  // ── POST /sync/push ──────────────────────────────────────────────────
  app.post('/sync/push', async (c) => {
    const appareil = c.get('appareil')
    let corps: unknown
    try {
      corps = await c.req.json()
    } catch {
      const corps: ReponseErreur = {
        erreur: 'requete_invalide',
        message: 'Corps JSON illisible.',
      }
      return c.json(corps, 400)
    }
    try {
      return c.json(await service.push(appareil, corps as never))
    } catch (erreur) {
      return reponseErreur(c, erreur)
    }
  })

  // ── POST /sync/shifts ────────────────────────────────────────────────
  // Route ADDITIVE : un POS plus ancien ne l'appelle pas, un POS plus récent
  // encaisse normalement si elle manque. Les ventes n'en dépendent jamais.
  app.post('/sync/shifts', async (c) => {
    const appareil = c.get('appareil')
    let corps: unknown
    try {
      corps = await c.req.json()
    } catch {
      const erreur: ReponseErreur = {
        erreur: 'requete_invalide',
        message: 'Corps JSON illisible.',
      }
      return c.json(erreur, 400)
    }
    try {
      return c.json(await service.shifts(appareil, corps as never))
    } catch (erreur) {
      return reponseErreur(c, erreur)
    }
  })

  // ── GET /sync/pull ───────────────────────────────────────────────────
  app.get('/sync/pull', async (c) => {
    const appareil = c.get('appareil')
    const entier = (nom: string, defaut: number) => {
      const brut = c.req.query(nom)
      const valeur = brut === undefined ? Number.NaN : Number.parseInt(brut, 10)
      return Number.isFinite(valeur) ? valeur : defaut
    }
    try {
      return c.json(
        await service.pull(appareil, {
          protocolVersion: entier('protocolVersion', VERSION_PROTOCOLE),
          depuisCatalogue: entier('depuisCatalogue', 0),
          depuisEvenements: entier('depuisEvenements', 0),
          taillePage: entier('taillePage', 500),
        }),
      )
    } catch (erreur) {
      return reponseErreur(c, erreur)
    }
  })

  return app
}

function reponseErreur(c: ContexteKaissi, erreur: unknown) {
  if (erreur instanceof ErreurSync) {
    const corps: ReponseErreur = { erreur: erreur.code, message: erreur.message }
    return c.json(corps, erreur.statut as 400)
  }
  // Une erreur inattendue ne fuite JAMAIS sa trace vers l'appareil : elle
  // part dans les journaux du serveur, où le support saura la lire.
  console.error('[sync] erreur inattendue', erreur)
  const corps: ReponseErreur = {
    erreur: 'erreur_serveur',
    message: 'Erreur interne du serveur de synchronisation. Vos ventes locales sont intactes.',
  }
  return c.json(corps, 500)
}
