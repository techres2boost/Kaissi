/**
 * Alertes de stock — la rupture va CHERCHER le gérant.
 *
 * ── Pourquoi le service, et pas un déclencheur en base ────────────────────
 *
 * Box passe par un déclencheur Postgres qui appelle une Edge Function via
 * `pg_net`. C'est la bonne réponse quand l'événement est ponctuel — une
 * commande qui change de statut. Ici, l'événement n'existe pas : le stock est
 * CALCULÉ à la lecture (comptage de référence + mouvements − ventes, migration
 * 0019). Il n'y a aucune ligne qui « passe à zéro », donc rien à déclencher.
 *
 * Le service de synchronisation, lui, tourne déjà en continu et balaie déjà
 * périodiquement. Y greffer les alertes évite une Edge Function, un
 * déclencheur, `pg_net`, et un second runtime à maintenir.
 *
 * ── Le journal des alertes est ce qui rend le mécanisme utilisable ────────
 *
 * Sans lui, chaque balayage réenverrait la même alerte toutes les demi-heures
 * jusqu'à la réception. Une alerte répétée n'est pas une alerte plus forte :
 * c'est une alerte qu'on coupe — et on coupe alors aussi les vraies.
 *
 * Une alerte est donc envoyée UNE fois, puis close quand le produit repasse
 * au-dessus du seuil. C'est cette clôture qui autorise la suivante.
 *
 * ── Dégradation : chaque canal est facultatif, séparément ─────────────────
 *
 * Pas de clés VAPID → pas de notification, l'e-mail part quand même.
 * Pas de fournisseur d'e-mail → pas d'e-mail, la notification part quand
 * même. Aucun des deux → le journal est tout de même tenu, et les alertes
 * s'affichent au back-office. Une caisse ne tombe jamais parce qu'un
 * fournisseur tiers est mal configuré.
 */

import webpush from 'web-push'
import type { AbonnementPush, DepotSync, ProduitEnAlerte } from './depot.js'

/**
 * Nombre d'alertes ouvertes en UN passage.
 *
 * Un premier inventaire peut mettre deux cents références sous le seuil d'un
 * coup. Sans plafond, le gérant recevrait deux cents lignes d'un coup — donc
 * couperait les notifications, et manquerait ensuite les vraies. Le reste
 * attend le balayage suivant, et le back-office les montre toutes.
 */
const PLAFOND_PAR_PASSAGE = 20

export interface ConfigVapid {
  readonly clePublique: string
  readonly clePrivee: string
  /** `mailto:` exigé par la spécification — l'opérateur du service. */
  readonly sujet: string
}

export interface ConfigEmail {
  readonly cle: string
  readonly expediteur: string
}

export interface OptionsAlertes {
  readonly vapid?: ConfigVapid | null
  readonly email?: ConfigEmail | null
  readonly fetchImpl?: typeof fetch
  readonly journaliser?: (message: string) => void
}

/**
 * Lit la configuration VAPID.
 *
 * Absente : les notifications sont simplement indisponibles. On ne fait pas
 * tomber un service de caisse parce qu'une variable manque.
 */
export function configVapidDepuisEnvironnement(
  env: NodeJS.ProcessEnv = process.env,
): ConfigVapid | null {
  const clePublique = env['VAPID_PUBLIC_KEY']?.trim()
  const clePrivee = env['VAPID_PRIVATE_KEY']?.trim()
  if (!clePublique || !clePrivee) return null
  return {
    clePublique,
    clePrivee,
    // `mailto:` est EXIGÉ par la spécification Web Push : les services de
    // notification refusent un sujet qui n'en est pas un, et le message
    // d'erreur ne le dit pas.
    sujet: env['VAPID_SUBJECT']?.trim() || 'mailto:contact@res2boost.com',
  }
}

export function configEmailDepuisEnvironnement(
  env: NodeJS.ProcessEnv = process.env,
): ConfigEmail | null {
  const cle = env['RESEND_API_KEY']?.trim()
  if (!cle) return null
  return {
    cle,
    expediteur: env['ALERTES_EXPEDITEUR']?.trim() || 'Kaissi <alertes@res2boost.com>',
  }
}

/** Le texte d'UN produit — « Ojja merguez : il n'en reste plus ». */
function ligneProduit(p: ProduitEnAlerte): string {
  if (p.niveau === 'rupture') {
    return p.qty < 0
      ? // Un stock négatif n'est pas une erreur d'affichage : c'est le signal
        // qu'une réception manque, ou que le comptage de référence est faux.
        // La borner à zéro ferait paraître juste un stock faux.
        `${p.nom} : ${p.qty} — une réception n’a pas été saisie, ou le comptage de référence est faux.`
      : `${p.nom} : il n’en reste plus, le produit est sorti de la carte.`
  }
  return `${p.nom} : il en reste ${p.qty}${p.seuil === null ? '' : `, seuil ${p.seuil}`}.`
}

/**
 * Le message d'un établissement, pour TOUS ses produits d'un passage.
 *
 * Une notification par produit ferait vingt vibrations à la suite le jour
 * d'un inventaire. Groupées, elles font une notification qu'on lit.
 */
export function messageAlerte(produits: readonly ProduitEnAlerte[]): {
  titre: string
  corps: string
} {
  const ruptures = produits.filter((p) => p.niveau === 'rupture').length
  if (produits.length === 1) {
    const p = produits[0]!
    return {
      titre: p.niveau === 'rupture' ? `Rupture — ${p.nom}` : `Stock faible — ${p.nom}`,
      corps: ligneProduit(p),
    }
  }
  const titre =
    ruptures > 0
      ? `${ruptures} rupture${ruptures > 1 ? 's' : ''} de stock`
      : `${produits.length} produits sous le seuil`
  return { titre, corps: produits.map(ligneProduit).join('\n') }
}

/**
 * Envoie une notification à un canal.
 *
 * Rend `'expire'` quand le navigateur a révoqué l'abonnement (404 ou 410) :
 * l'appelant supprime alors la ligne. Sans cela, chaque balayage retenterait
 * indéfiniment un canal mort, et le journal se remplirait d'échecs qui ne
 * disent rien.
 */
async function envoyerPush(
  abonnement: AbonnementPush,
  charge: unknown,
): Promise<'envoye' | 'expire' | 'echec'> {
  try {
    await webpush.sendNotification(
      {
        endpoint: abonnement.endpoint,
        keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
      },
      JSON.stringify(charge),
    )
    return 'envoye'
  } catch (erreur) {
    const statut = (erreur as { statusCode?: number }).statusCode
    if (statut === 404 || statut === 410) return 'expire'
    return 'echec'
  }
}

/** Envoie l'e-mail par l'API HTTP de Resend — aucune dépendance SMTP. */
async function envoyerEmail(
  config: ConfigEmail,
  destinataires: readonly string[],
  sujet: string,
  texte: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (destinataires.length === 0) return false
  try {
    const reponse = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.cle}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.expediteur,
        to: destinataires,
        subject: sujet,
        text: texte,
      }),
      // Un fournisseur d'e-mail lent ne doit pas retenir le balayage : les
      // ventes qui attendent une reprojection passent avant les alertes.
      signal: AbortSignal.timeout(10_000),
    })
    return reponse.ok
  } catch {
    return false
  }
}

/** L'adresse de l'écran Stock, quand le back-office est déclaré. */
function lienStock(restaurantId: string): string {
  const base = (process.env['URL_BACKOFFICE'] ?? '').replace(/\/+$/, '')
  return `${base}/${restaurantId}/stock`
}

export interface ResultatAlertes {
  readonly ouvertes: number
  readonly closes: number
  readonly pushEnvoyes: number
  readonly emailsEnvoyes: number
  readonly erreur?: string
}

/**
 * Un tour d'alertes : ouvre les nouvelles, ferme celles qui n'ont plus lieu.
 *
 * Ne lance jamais — l'appelant est un minuteur, et un minuteur ne doit pas
 * mourir parce qu'un fournisseur tiers a répondu 500.
 */
export async function balayerAlertesStock(
  depot: DepotSync,
  options: OptionsAlertes = {},
): Promise<ResultatAlertes> {
  const vapid = options.vapid ?? configVapidDepuisEnvironnement()
  const email = options.email ?? configEmailDepuisEnvironnement()
  const fetchImpl = options.fetchImpl ?? fetch
  const dire = options.journaliser ?? ((m: string) => console.log(m))

  if (vapid) {
    webpush.setVapidDetails(vapid.sujet, vapid.clePublique, vapid.clePrivee)
  }

  try {
    // On FERME d'abord. Un produit réapprovisionné pendant qu'on parle ne
    // doit pas déclencher une alerte que le tour suivant refermerait.
    const closes = await depot.cloreAlertesResolues()

    const nouvelles = await depot.produitsEnAlerte(PLAFOND_PAR_PASSAGE)
    let pushEnvoyes = 0
    let emailsEnvoyes = 0

    /*
     * Groupé par ÉTABLISSEMENT, et pas produit par produit.
     *
     * Les destinataires sont les mêmes pour tout un établissement : envoyer
     * une notification par produit ferait vingt vibrations à la suite le jour
     * d'un inventaire, et le gérant couperait les notifications — donc aussi
     * les vraies. C'est une seule notification, et un seul e-mail.
     */
    const parEtablissement = new Map<string, ProduitEnAlerte[]>()
    for (const p of nouvelles) {
      const liste = parEtablissement.get(p.restaurantId)
      if (liste) liste.push(p)
      else parEtablissement.set(p.restaurantId, [p])
    }

    for (const [restaurantId, produits] of parEtablissement) {
      const { titre, corps } = messageAlerte(produits)
      const canaux: string[] = []

      if (vapid) {
        const abonnements = await depot.abonnementsPush(restaurantId)
        let partis = 0
        for (const a of abonnements) {
          const issue = await envoyerPush(a, {
            titre,
            corps,
            // L'écran Stock, et pas l'accueil : une notification qui ouvre
            // une page où il faut encore chercher ne sert à rien.
            url: `/${restaurantId}/stock`,
          })
          if (issue === 'envoye') partis += 1
          if (issue === 'expire') await depot.supprimerAbonnement(a.endpoint)
        }
        pushEnvoyes += partis
        if (partis > 0) canaux.push('push')
      }

      if (email) {
        const destinataires = await depot.emailsGestionnaires(restaurantId)
        const envoye = await envoyerEmail(
          email,
          destinataires,
          titre,
          `${corps}\n\nVoir le stock : ${lienStock(restaurantId)}\n\n— Kaissi`,
          fetchImpl,
        )
        if (envoye) {
          emailsEnvoyes += 1
          canaux.push('email')
        }
      }

      /*
       * L'alerte est journalisée MÊME si aucun canal n'a abouti.
       *
       * C'est délibéré, et ce n'est pas évident : on pourrait vouloir
       * réessayer au tour suivant. Mais un service mal configuré retenterait
       * alors toutes les demi-heures, indéfiniment, pour chaque produit. Le
       * journal dit ce qui a été TENTÉ et par quels canaux ; le back-office
       * montre l'alerte de toute façon, et c'est lui qui fait foi.
       */
      for (const p of produits) {
        await depot.enregistrerAlerte(p, canaux.join(','))
      }
    }

    if (nouvelles.length > 0 || closes > 0) {
      dire(
        `  🔔 ${nouvelles.length} alerte(s) de stock ouverte(s), ${closes} close(s)` +
          ` — ${pushEnvoyes} notification(s), ${emailsEnvoyes} e-mail(s).` +
          (!vapid ? '\n     VAPID non configuré : aucune notification envoyée.' : '') +
          (!email ? '\n     RESEND_API_KEY absente : aucun e-mail envoyé.' : ''),
      )
    }

    return { ouvertes: nouvelles.length, closes, pushEnvoyes, emailsEnvoyes }
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur)
    dire(
      `  ⚠ Le balayage des alertes de stock a échoué : ${message}` +
        '\n    Aucune donnée perdue — le stock reste juste au back-office.',
    )
    return { ouvertes: 0, closes: 0, pushEnvoyes: 0, emailsEnvoyes: 0, erreur: message }
  }
}

/** Intervalle par défaut entre deux balayages d'alertes, en minutes. */
export const INTERVALLE_ALERTES_MINUTES = 15

export interface OptionsPlanificationAlertes extends OptionsAlertes {
  /** 0 ou négatif : aucun balayage périodique, seulement celui du démarrage. */
  readonly intervalleMinutes?: number
}

/**
 * Lance le balayage des alertes au démarrage, puis le répète.
 *
 * Un quart d'heure : plus court que la réparation des projections, parce
 * qu'une rupture non annoncée se paie tout de suite — on continue de vendre
 * un plat qu'on n'a plus — alors qu'une projection manquante se rattrape.
 * Plus long qu'une minute, parce qu'aucun gérant ne réapprovisionne en
 * soixante secondes : ce serait de la charge sans effet.
 *
 * Le minuteur est `unref()` : il n'empêche jamais le process de s'arrêter,
 * sinon un SIGTERM d'hébergeur attendrait le prochain tour et le
 * redéploiement paraîtrait bloqué.
 */
export function planifierAlertesStock(
  depot: DepotSync,
  options: OptionsPlanificationAlertes = {},
): () => void {
  const minutes = options.intervalleMinutes ?? INTERVALLE_ALERTES_MINUTES

  // Un seul balayage à la fois : deux tours qui se chevauchent enverraient
  // la même alerte deux fois — l'un lisant avant que l'autre n'ait
  // journalisé.
  let enCours = false
  const tour = async () => {
    if (enCours) return
    enCours = true
    try {
      await balayerAlertesStock(depot, options)
    } finally {
      enCours = false
    }
  }

  void tour()

  if (minutes <= 0) return () => {}

  const minuteur = setInterval(() => void tour(), minutes * 60_000)
  minuteur.unref()
  return () => clearInterval(minuteur)
}
