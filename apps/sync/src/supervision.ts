/**
 * Supervision — l'historique, les incidents et le journal de sécurité.
 *
 * ── Ce que `surveillance.ts` faisait déjà, et ce qui manquait ─────────────
 *
 * `Metriques` répond à « maintenant ? » : une heure en mémoire, perdue au
 * redémarrage. Une exploitation réelle pose trois autres questions :
 *
 *   • « C'était comment cette nuit ? » — il faut un HISTORIQUE, qui survive
 *     aux redémarrages ;
 *   • « Cette alerte, depuis quand ? quelqu'un s'en occupe ? » — il faut des
 *     INCIDENTS, avec un début, une fin, un responsable ;
 *   • « Quelqu'un essaie-t-il des mots de passe ? » — il faut un JOURNAL de
 *     sécurité.
 *
 * ── Le coût : une écriture par minute, quelle que soit la charge ──────────
 *
 * Chaque requête met à jour des compteurs EN MÉMOIRE (quelques additions,
 * aucune entrée-sortie). Une fois par période (`SYNC_SUPERVISION_SECONDES`,
 * 60 par défaut), `vider()` écrit UNE ligne de points, le lot d'événements
 * accumulé, et met les incidents à jour — en une transaction. Mille caisses
 * ou une seule : la même écriture. La règle d'octobre tient : on n'écrit
 * jamais une métrique par vente dans la base qu'on surveille.
 *
 * ── Ce qui n'y entre jamais ───────────────────────────────────────────────
 *
 * Aucune donnée de vente. Aucun mot de passe, aucun jeton. Les adresses IP
 * sont TRONQUÉES à leur réseau (`tronquerIp`) : assez pour voir qu'une même
 * source insiste, pas assez pour identifier un poste. Les messages d'erreur
 * sont bornés et passent par `nettoyer`, qui retire ce qui ressemble à un
 * jeton ou à une adresse e-mail.
 *
 * ── Si la base ne répond pas ──────────────────────────────────────────────
 *
 * L'écriture échoue, et c'est tout : les compteurs de la période sont
 * PERDUS plutôt que réessayés (une file qui grossit pendant une panne de
 * base finirait par manquer de mémoire au service qui porte les ventes). La
 * supervision ne doit jamais pouvoir faire tomber ce qu'elle surveille.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks'
import { centile, familleDeRoute, limiteBaseDepuisEnvironnement, type Alerte } from './surveillance.js'

export type NiveauSupervision = 'critique' | 'attention' | 'info'
export type CategorieEvenement = 'securite' | 'application' | 'synchronisation' | 'terminal'

export interface EvenementSupervision {
  readonly instant: string
  readonly categorie: CategorieEvenement
  readonly type: string
  readonly niveau: NiveauSupervision
  readonly restaurantId: string | null
  readonly deviceId: string | null
  readonly origine: string | null
  readonly message: string
  readonly detail: Record<string, unknown>
}

/** Une ligne de `kaissi.supervision_points`, telle que le collecteur l'écrit. */
export interface PointSupervision {
  readonly minute: string
  readonly instance: string
  readonly requetes: number
  readonly erreurs5xx: number
  readonly erreurs4xx: number
  readonly latenceMoyenneMs: number
  readonly pushRequetes: number
  readonly pushP50Ms: number | null
  readonly pushP95Ms: number | null
  readonly pushP99Ms: number | null
  readonly pullP95Ms: number | null
  readonly concurrenceMax: number
  readonly evenementsRecus: number
  readonly cpuPourcent: number
  readonly rssOctets: number
  readonly tasOctets: number
  readonly boucleP99Ms: number
  readonly redemarrage: boolean
  readonly base: MesuresSupervisionBase | null
  readonly echecsAuthentification: number
  readonly limitesDeDebit: number
  readonly accesRefuses: number
}

/**
 * Ce que la base dit d'elle-même, chaque minute — en lecture des
 * statistiques du serveur UNIQUEMENT, jamais un comptage de tables métier :
 * compter 24 h de ventes chaque minute coûterait plus cher que tout le reste
 * de la supervision réunie.
 */
export interface MesuresSupervisionBase {
  readonly latenceMs: number
  readonly tailleOctets: number
  readonly connexions: number
  readonly connexionsActives: number
  readonly poolTotal: number
  readonly poolEnAttente: number
  readonly cachePourcent: number | null
  readonly attentesVerrou: number
  readonly caissesVues15min: number
}

/** Ce que le collecteur attend du dépôt. */
export interface DepotSupervision {
  mesuresSupervisionBase(): Promise<MesuresSupervisionBase>
  ecrireSupervision(lot: {
    point: PointSupervision
    evenements: readonly EvenementSupervision[]
    alertes: readonly Alerte[]
    /** Une condition non revue depuis ce délai est résolue d'office. */
    resolutionApresSecondes: number
  }): Promise<void>
  purgerSupervision(): Promise<void>
}

// ── Protection des données ─────────────────────────────────────────────────

/**
 * Le RÉSEAU d'une adresse, jamais l'adresse elle-même : /24 en IPv4, les
 * trois premiers groupes en IPv6. « La même source insiste » se voit ;
 * « ce poste-là, chez ce client » ne se voit pas.
 */
export function tronquerIp(adresse: string | null | undefined): string | null {
  const a = (adresse ?? '').trim()
  if (!a || a === 'inconnue') return null
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(a)
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`
  if (a.includes(':')) {
    const groupes = a.split(':').filter((g) => g !== '').slice(0, 3)
    return groupes.length > 0 ? `${groupes.join(':')}::/48` : null
  }
  return null
}

/** « s•••@restaurant.tn » — reconnaissable par son titulaire, pas au-delà. */
export function masquerEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  const at = e.indexOf('@')
  if (at < 1) return null
  return `${e[0]}•••${e.slice(at)}`
}

/**
 * Un message d'erreur, rendu sûr à stocker : borné, sans jeton apparent, sans
 * adresse e-mail en clair. Défense en profondeur — les messages du service
 * n'en portent pas, mais un message de PostgreSQL peut citer une valeur.
 */
export function nettoyer(message: string, longueur = 300): string {
  return message
    .replace(/[A-Za-z0-9_-]{32,}/g, '‹jeton›')
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, (m) => masquerEmail(m) ?? '‹e-mail›')
    .slice(0, longueur)
}

// ── Le collecteur ──────────────────────────────────────────────────────────

/** Ce qu'une requête terminée dit à la supervision. */
export interface RequeteObservee {
  readonly chemin: string
  readonly statut: number
  readonly ms: number
  readonly origine: string
  readonly restaurantId: string | null
  readonly deviceId: string | null
  /** Le code d'erreur rendu par la route, s'il y en a un (`ReponseErreur.erreur`). */
  readonly codeErreur: string | null
  readonly messageErreur: string | null
}

interface Periode {
  debut: number
  requetes: number
  erreurs5xx: number
  erreurs4xx: number
  dureeTotaleMs: number
  push: number[]
  pull: number[]
  concurrenceMax: number
  evenementsRecus: number
  echecsAuthentification: number
  limitesDeDebit: number
  accesRefuses: number
}

/** Un refus d'authentification, gardé 15 minutes pour la détection. */
interface Refus {
  readonly instant: number
  readonly origine: string | null
}

/** Plafond d'événements gardés entre deux écritures : une attaque ne fait pas gonfler la mémoire. */
const EVENEMENTS_MAX_PAR_PERIODE = 500
/** Même plafond pour les durées gardées pour les centiles. */
const DUREES_MAX_PAR_PERIODE = 20_000
const FENETRE_REFUS_MS = 15 * 60_000

export interface OptionsSupervision {
  readonly instance?: string
  readonly intervalleMs?: number
  readonly maintenant?: () => number
  /** Les alertes de `surveillance.ts`, recalculées à chaque écriture. */
  readonly alertes?: () => Promise<readonly Alerte[]>
}

export class Supervision {
  readonly instance: string
  readonly intervalleMs: number
  private readonly maintenant: () => number
  private readonly alertesExternes: (() => Promise<readonly Alerte[]>) | null
  private periode: Periode
  private evenements: EvenementSupervision[] = []
  private evenementsIgnores = 0
  private enCours = 0
  private refus: Refus[] = []
  private premiere = true
  private minuteur: ReturnType<typeof setInterval> | null = null
  private ecritureEnCours: Promise<void> | null = null
  private derniereEcriture: { instant: string; ok: boolean; erreur: string | null } | null = null
  private dernierePurge = 0
  private dernierCpu = process.cpuUsage()
  private dernierInstantCpu = performance.now()
  private readonly boucle = monitorEventLoopDelay({ resolution: 20 })

  // Champ explicite, pas de « parameter property » : le service s'exécute
  // en source TypeScript, et le mode strip-only de Node ne les transforme pas.
  private readonly depot: DepotSupervision

  constructor(depot: DepotSupervision, options: OptionsSupervision = {}) {
    this.depot = depot
    this.instance = options.instance ?? process.env['RAILWAY_REPLICA_ID'] ?? 'principale'
    this.intervalleMs = options.intervalleMs ?? 60_000
    this.maintenant = options.maintenant ?? Date.now
    this.alertesExternes = options.alertes ?? null
    this.periode = this.nouvellePeriode()
    this.noterEvenement({
      categorie: 'application',
      type: 'demarrage',
      niveau: 'info',
      message: 'Le service de synchronisation a démarré.',
      detail: { node: process.version, instance: this.instance },
    })
  }

  private nouvellePeriode(): Periode {
    return {
      debut: this.maintenant(),
      requetes: 0,
      erreurs5xx: 0,
      erreurs4xx: 0,
      dureeTotaleMs: 0,
      push: [],
      pull: [],
      concurrenceMax: 0,
      evenementsRecus: 0,
      echecsAuthentification: 0,
      limitesDeDebit: 0,
      accesRefuses: 0,
    }
  }

  demarrer(): this {
    if (this.minuteur) return this
    this.boucle.enable()
    this.minuteur = setInterval(() => void this.vider(), this.intervalleMs)
    // Un minuteur de supervision ne retient jamais un processus qui s'arrête.
    this.minuteur.unref?.()
    return this
  }

  /** Arrête le minuteur et écrit la dernière période — à l'arrêt du service. */
  async arreter(): Promise<void> {
    if (this.minuteur) clearInterval(this.minuteur)
    this.minuteur = null
    await this.vider().catch(() => undefined)
    this.boucle.disable()
  }

  // ── Les observations, en mémoire ─────────────────────────────────────────

  /** Une requête commence : rend la fonction qui la termine. */
  debut(): () => void {
    this.enCours += 1
    if (this.enCours > this.periode.concurrenceMax) this.periode.concurrenceMax = this.enCours
    let fini = false
    return () => {
      if (fini) return
      fini = true
      this.enCours -= 1
    }
  }

  /** Une requête terminée : compteurs, et événement si elle le mérite. */
  observer(r: RequeteObservee): void {
    const p = this.periode
    const famille = familleDeRoute(r.chemin)
    p.requetes += 1
    p.dureeTotaleMs += r.ms
    if (r.statut >= 500) p.erreurs5xx += 1
    else if (r.statut >= 400) p.erreurs4xx += 1
    if (famille === 'push' && p.push.length < DUREES_MAX_PAR_PERIODE) p.push.push(r.ms)
    if (famille === 'pull' && p.pull.length < DUREES_MAX_PAR_PERIODE) p.pull.push(r.ms)

    const origine = tronquerIp(r.origine)
    const base = { restaurantId: r.restaurantId, deviceId: r.deviceId, origine }

    if (r.statut === 429) {
      p.limitesDeDebit += 1
      this.noterEvenement({
        ...base,
        categorie: 'securite',
        type: 'limite_de_debit',
        niveau: 'attention',
        message: `Trop de tentatives sur « ${famille} » : la limite de débit a refusé la requête.`,
        detail: { famille },
      })
      return
    }

    // Les refus d'IDENTIFICATION : mot de passe faux (appairage, compte),
    // jeton d'appareil inconnu ou révoqué. Un 401 sur /admin est un jeton de
    // session expiré ou un rôle insuffisant : un accès refusé, pas une
    // tentative de connexion.
    const identification =
      famille === 'appairage' || famille === 'inscription' || r.chemin.startsWith('/compte/')
    const routeDeCaisse = ['push', 'pull', 'shifts', 'pointages', 'catalogue', 'sync'].includes(famille)
    if (r.statut === 401 && (identification || routeDeCaisse)) {
      p.echecsAuthentification += 1
      this.refus.push({ instant: this.maintenant(), origine })
      this.noterEvenement({
        ...base,
        categorie: 'securite',
        type: identification ? 'echec_authentification' : 'jeton_appareil_refuse',
        niveau: 'attention',
        message: identification
          ? 'Identifiants refusés.'
          : 'Jeton d’appareil absent, inconnu ou mal formé.',
        detail: { famille, code: r.codeErreur },
      })
      return
    }
    if (r.statut === 403 && r.codeErreur === 'appareil_revoque') {
      p.accesRefuses += 1
      this.noterEvenement({
        ...base,
        categorie: 'securite',
        type: 'appareil_revoque',
        niveau: 'attention',
        message: 'Un appareil RÉVOQUÉ tente encore de se synchroniser.',
        detail: { famille },
      })
      return
    }
    if ((r.statut === 401 || r.statut === 403) && famille === 'admin') {
      p.accesRefuses += 1
      this.noterEvenement({
        ...base,
        categorie: 'securite',
        type: 'acces_refuse',
        niveau: 'info',
        message: 'Accès refusé à une route d’administration.',
        detail: { code: r.codeErreur },
      })
      return
    }
    if (famille === 'appairage' && r.statut === 200) {
      this.noterEvenement({
        ...base,
        categorie: 'terminal',
        type: 'terminal_mis_en_service',
        niveau: 'info',
        message: 'Un terminal a été mis en service (ou remis en service).',
        detail: {},
      })
      return
    }
    if (r.statut >= 500) {
      this.noterEvenement({
        ...base,
        categorie: famille === 'push' || famille === 'pull' ? 'synchronisation' : 'application',
        type: r.statut === 503 ? 'service_indisponible' : 'erreur_serveur',
        niveau: r.statut === 503 ? 'attention' : 'critique',
        message: nettoyer(r.messageErreur ?? `Réponse ${r.statut}.`),
        detail: { famille, statut: r.statut, code: r.codeErreur, ms: Math.round(r.ms) },
      })
    }
  }

  /** Des événements reçus d'une caisse (push accepté). */
  evenementsRecus(n: number): void {
    this.periode.evenementsRecus += n
  }

  /**
   * Les opérations qu'une caisse a envoyées et que le serveur a REFUSÉES.
   *
   * Un rejet ne se réessaie jamais tout seul : c'est une règle métier qui
   * remonte au gérant — et ici à l'exploitant, parce qu'une série de rejets
   * du même code est le symptôme d'une version de caisse incompatible ou de
   * deux terminaux en désaccord sur l'état d'une commande. Un événement par
   * CODE et par envoi, avec le nombre : cent rejets identiques ne font pas
   * cent lignes.
   */
  rejetsSynchronisation(
    appareil: { restaurantId: string; deviceId: string },
    rejetes: readonly { code: string }[],
  ): void {
    const parCode = new Map<string, number>()
    for (const r of rejetes) parCode.set(r.code, (parCode.get(r.code) ?? 0) + 1)
    for (const [code, n] of parCode) {
      this.noterEvenement({
        restaurantId: appareil.restaurantId,
        deviceId: appareil.deviceId,
        categorie: 'synchronisation',
        type: 'operation_rejetee',
        niveau: 'attention',
        message: `${n} opération(s) refusée(s) par le serveur — code « ${code} ».`,
        detail: { code, n },
      })
    }
  }

  /** Un événement explicite : erreur remontée par une caisse, redémarrage… */
  noterEvenement(e: Omit<EvenementSupervision, 'instant' | 'restaurantId' | 'deviceId' | 'origine'> &
    Partial<Pick<EvenementSupervision, 'restaurantId' | 'deviceId' | 'origine'>>): void {
    if (this.evenements.length >= EVENEMENTS_MAX_PAR_PERIODE) {
      this.evenementsIgnores += 1
      return
    }
    this.evenements.push({
      instant: new Date(this.maintenant()).toISOString(),
      restaurantId: e.restaurantId ?? null,
      deviceId: e.deviceId ?? null,
      origine: e.origine ?? null,
      categorie: e.categorie,
      type: e.type,
      niveau: e.niveau,
      message: nettoyer(e.message),
      detail: e.detail,
    })
  }

  // ── Les alertes propres à la supervision ─────────────────────────────────

  /**
   * Les refus d'identification des quinze dernières minutes.
   *
   * Seuils : 20 refus en 15 min, ou 10 depuis le MÊME réseau. Un humain qui
   * se trompe trois fois n'y arrive pas ; un balayage, si.
   */
  alertesSecurite(): Alerte[] {
    const depuis = this.maintenant() - FENETRE_REFUS_MS
    this.refus = this.refus.filter((r) => r.instant >= depuis)
    const alertes: Alerte[] = []
    if (this.refus.length >= 100) {
      alertes.push({
        cle: 'securite.refus_massifs',
        niveau: 'critique',
        sujet: 'Sécurité',
        message: `${this.refus.length} refus d’identification en 15 minutes : attaque probable par essai de mots de passe ou de jetons.`,
      })
    } else if (this.refus.length >= 20) {
      alertes.push({
        cle: 'securite.refus_nombreux',
        niveau: 'attention',
        sujet: 'Sécurité',
        message: `${this.refus.length} refus d’identification en 15 minutes.`,
      })
    }
    const parOrigine = new Map<string, number>()
    for (const r of this.refus) if (r.origine) parOrigine.set(r.origine, (parOrigine.get(r.origine) ?? 0) + 1)
    for (const [origine, n] of parOrigine) {
      if (n >= 10) {
        alertes.push({
          cle: `securite.source:${origine}`,
          niveau: 'attention',
          sujet: 'Sécurité',
          message: `Le réseau ${origine} a essuyé ${n} refus d’identification en 15 minutes.`,
        })
      }
    }
    return alertes
  }

  // ── L'écriture ───────────────────────────────────────────────────────────

  /** État du collecteur, pour l'écran (et pour savoir s'il écrit vraiment). */
  etat() {
    return {
      instance: this.instance,
      intervalleSecondes: Math.round(this.intervalleMs / 1000),
      requetesEnCours: this.enCours,
      evenementsEnAttente: this.evenements.length,
      evenementsIgnores: this.evenementsIgnores,
      derniereEcriture: this.derniereEcriture,
    }
  }

  /**
   * Écrit la période écoulée. Une seule écriture à la fois : si la base est
   * lente, la suivante attend au lieu de s'empiler.
   */
  async vider(): Promise<void> {
    if (this.ecritureEnCours) return this.ecritureEnCours
    this.ecritureEnCours = this.viderMaintenant().finally(() => {
      this.ecritureEnCours = null
    })
    return this.ecritureEnCours
  }

  private async viderMaintenant(): Promise<void> {
    const periode = this.periode
    const evenements = this.evenements
    const ignores = this.evenementsIgnores
    this.periode = this.nouvellePeriode()
    this.periode.concurrenceMax = this.enCours
    this.evenements = []
    this.evenementsIgnores = 0

    if (ignores > 0) {
      evenements.push({
        instant: new Date(this.maintenant()).toISOString(),
        categorie: 'application',
        type: 'evenements_ignores',
        niveau: 'attention',
        restaurantId: null,
        deviceId: null,
        origine: null,
        message: `${ignores} événement(s) de supervision non gardés : plafond de ${EVENEMENTS_MAX_PAR_PERIODE} par période atteint.`,
        detail: { ignores },
      })
    }

    // Le processus, mesuré ICI — et non emprunté à `Metriques`, dont
    // l'échantillonneur a son propre rythme et sa propre ligne de base.
    const cpu = process.cpuUsage(this.dernierCpu)
    const t = performance.now()
    const ecouleMs = Math.max(1, t - this.dernierInstantCpu)
    this.dernierCpu = process.cpuUsage()
    this.dernierInstantCpu = t
    const memoire = process.memoryUsage()
    const boucleP99 = Math.round(this.boucle.percentile(99) / 1e4) / 100
    this.boucle.reset()

    // Une base injoignable est précisément ce que la période doit dire :
    // ses colonnes restent vides, et l'alerte « base injoignable » s'ouvre.
    const base: MesuresSupervisionBase | null = await this.depot
      .mesuresSupervisionBase()
      .catch(() => null)

    const tri = (l: number[]) => [...l].sort((a, b) => a - b)
    const push = tri(periode.push)
    const pull = tri(periode.pull)
    const point: PointSupervision = {
      minute: new Date(periode.debut - (periode.debut % 1000)).toISOString(),
      instance: this.instance,
      requetes: periode.requetes,
      erreurs5xx: periode.erreurs5xx,
      erreurs4xx: periode.erreurs4xx,
      latenceMoyenneMs: periode.requetes ? Math.round(periode.dureeTotaleMs / periode.requetes) : 0,
      pushRequetes: push.length,
      pushP50Ms: push.length ? Math.round(centile(push, 50)) : null,
      pushP95Ms: push.length ? Math.round(centile(push, 95)) : null,
      pushP99Ms: push.length ? Math.round(centile(push, 99)) : null,
      pullP95Ms: pull.length ? Math.round(centile(pull, 95)) : null,
      concurrenceMax: periode.concurrenceMax,
      evenementsRecus: periode.evenementsRecus,
      cpuPourcent: Math.round(((cpu.user + cpu.system) / 1000 / ecouleMs) * 1000) / 10,
      rssOctets: memoire.rss,
      tasOctets: memoire.heapUsed,
      boucleP99Ms: boucleP99,
      redemarrage: this.premiere,
      base,
      echecsAuthentification: periode.echecsAuthentification,
      limitesDeDebit: periode.limitesDeDebit,
      accesRefuses: periode.accesRefuses,
    }

    const alertes: Alerte[] = [...this.alertesSecurite()]
    if (!base) {
      alertes.push({
        cle: 'base.injoignable',
        niveau: 'critique',
        sujet: 'Base de données',
        message: 'La supervision n’a pas pu lire les statistiques de la base.',
      })
    }
    if (base) alertes.push(...alertesBase(base, limiteBaseDepuisEnvironnement()))
    if (point.requetes >= 20 && point.erreurs5xx / point.requetes > 0.01) {
      alertes.push({
        cle: 'service.erreurs_5xx',
        niveau: 'critique',
        sujet: 'Service',
        message: `${point.erreurs5xx} erreur(s) serveur sur ${point.requetes} requêtes dans la dernière période.`,
      })
    }
    if (this.alertesExternes) {
      try {
        alertes.push(...(await this.alertesExternes()))
      } catch {
        // Une alerte qu'on n'a pas pu calculer n'en efface pas les autres.
      }
    }

    try {
      await this.depot.ecrireSupervision({
        point,
        evenements,
        alertes: dedoublonner(alertes),
        // Deux périodes sans revoir une condition : elle est résolue. Une
        // seule serait trop nerveuse — une alerte à la frontière d'un seuil
        // ouvrirait et fermerait un incident à chaque minute.
        resolutionApresSecondes: Math.round((this.intervalleMs * 2.5) / 1000),
      })
      this.premiere = false
      this.derniereEcriture = { instant: point.minute, ok: true, erreur: null }
    } catch (erreur) {
      // Perdus, pas réessayés : voir l'en-tête du fichier.
      this.derniereEcriture = {
        instant: point.minute,
        ok: false,
        erreur: nettoyer(erreur instanceof Error ? erreur.message : String(erreur)),
      }
    }

    // La purge, une fois par heure au plus : 30 jours de points, 90 jours
    // d'événements, 180 jours d'incidents résolus.
    if (this.maintenant() - this.dernierePurge > 3_600_000) {
      this.dernierePurge = this.maintenant()
      await this.depot.purgerSupervision().catch(() => undefined)
    }
  }
}

/**
 * Les seuils de la base, sur les mesures LÉGÈRES de la minute. Mêmes clés que
 * `evaluerAlertes` (surveillance.ts) : une même condition vue par les deux
 * chemins reste un seul incident.
 */
export function alertesBase(base: MesuresSupervisionBase, limiteOctets: number): Alerte[] {
  const alertes: Alerte[] = []
  if (limiteOctets > 0) {
    const part = base.tailleOctets / limiteOctets
    const mo = (o: number) => Math.round(o / (1024 * 1024))
    const message =
      `La base occupe ${mo(base.tailleOctets)} Mo sur ${mo(limiteOctets)} Mo ` +
      `(${Math.round(part * 100)} %). Les ventes ne se purgent pas : passer à l’offre ` +
      'supérieure, puis relever KAISSI_LIMITE_BASE_MO.'
    if (part >= 0.9) alertes.push({ cle: 'base.espace', niveau: 'critique', sujet: 'Espace disque', message })
    else if (part >= 0.7) alertes.push({ cle: 'base.espace', niveau: 'attention', sujet: 'Espace disque', message })
  }
  if (base.poolEnAttente > 0) {
    alertes.push({
      cle: 'base.pool_attente',
      niveau: 'attention',
      sujet: 'Connexions',
      message: `${base.poolEnAttente} requête(s) attendent une connexion libre au pool (SYNC_POOL_MAX).`,
    })
  }
  if (base.cachePourcent !== null && base.cachePourcent < 95) {
    alertes.push({
      cle: 'base.cache',
      niveau: 'attention',
      sujet: 'Base de données',
      message: `Seulement ${base.cachePourcent} % des lectures servies par le cache.`,
    })
  }
  if (base.latenceMs > 500) {
    alertes.push({
      cle: 'base.latence',
      niveau: 'attention',
      sujet: 'Base de données',
      message: `La base répond en ${base.latenceMs} ms à une requête triviale.`,
    })
  }
  return alertes
}

/** Une alerte par clé, la plus grave gardée. */
function dedoublonner(alertes: readonly Alerte[]): Alerte[] {
  const parCle = new Map<string, Alerte>()
  for (const a of alertes) {
    const deja = parCle.get(a.cle)
    if (!deja || (deja.niveau !== 'critique' && a.niveau === 'critique')) parCle.set(a.cle, a)
  }
  return [...parCle.values()]
}

/**
 * La période de collecte, `SYNC_SUPERVISION_SECONDES` — 60 par défaut, de 1
 * à 3 600. En production, on garde la minute : c'est elle que l'écran et la
 * rétention supposent. Plus court ne sert qu'aux tests et au banc de charge.
 */
export function intervalleSupervisionDepuisEnvironnement(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const s = Number(env['SYNC_SUPERVISION_SECONDES'] ?? '')
  if (!Number.isFinite(s) || s <= 0) return 60_000
  return Math.min(3_600, Math.max(1, Math.round(s))) * 1000
}
