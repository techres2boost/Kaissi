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
}

export function creerServeur({
  depot,
  origines,
  auth = configAuthDepuisEnvironnement(),
  fetchAuth,
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
