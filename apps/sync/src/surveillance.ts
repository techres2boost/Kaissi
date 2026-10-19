/**
 * Surveillance du service — ce qu'il faut regarder pour savoir que demain,
 * la caisse ne tombera pas.
 *
 * ── Pourquoi DANS le service, et pas seulement chez l'hébergeur ───────────
 *
 * Railway montre le CPU et la mémoire du conteneur. Il ne sait pas qu'une
 * vente sur cent répond 500, que les ventes d'hier soir n'ont pas de
 * projection, qu'une migration manque, ni qu'une caisse ne parle plus depuis
 * deux jours. Ce sont pourtant les chiffres qui disent « le restaurant est en
 * panne » — et ils n'existent qu'ici.
 *
 * ── Ce que ce module garde, et ce qu'il ne garde pas ──────────────────────
 *
 * Tout est EN MÉMOIRE, sur la dernière heure, et disparaît au redémarrage.
 * C'est voulu : écrire une métrique par requête dans la base qu'on surveille
 * ajouterait une écriture à chaque vente pour savoir si les ventes vont bien.
 * L'historique long reste chez l'hébergeur ; ceci répond à « maintenant ? ».
 *
 * Aucune donnée de vente n'y entre : des routes, des statuts, des durées.
 * Les messages d'erreur gardés sont ceux des journaux, déjà nettoyés.
 */

import os from 'node:os'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

/** Familles de routes : on ne garde jamais un chemin libre (un UUID par vente). */
export function familleDeRoute(chemin: string): string {
  if (chemin.startsWith('/sync/push')) return 'push'
  if (chemin.startsWith('/sync/pull')) return 'pull'
  if (chemin.startsWith('/sync/shifts')) return 'shifts'
  if (chemin.startsWith('/sync/catalogue')) return 'catalogue'
  if (chemin.startsWith('/sync/')) return 'sync'
  if (chemin.startsWith('/appairage')) return 'appairage'
  if (chemin.startsWith('/inscription')) return 'inscription'
  if (chemin.startsWith('/admin/')) return 'admin'
  if (chemin === '/sante') return 'sante'
  return 'autre'
}

const MINUTES_GARDEES = 60
/** Les durées individuelles gardées par famille, pour les percentiles. */
const ECHANTILLONS_PAR_FAMILLE = 2_000
const ERREURS_GARDEES = 30
/** Un point de mesure du processus toutes les dix secondes → une heure. */
const INTERVALLE_PROCESSUS_MS = 10_000
const POINTS_PROCESSUS = 360

interface Minute {
  readonly debut: number
  total: number
  erreurs5xx: number
  erreurs4xx: number
  dureeTotaleMs: number
}

interface Echantillon {
  readonly instant: number
  readonly ms: number
  readonly statut: number
}

export interface PointProcessus {
  readonly instant: string
  /** Part d'UN cœur occupé par ce processus (100 = un cœur plein). */
  readonly cpuPourcent: number
  readonly rssOctets: number
  readonly tasOctets: number
  /** Retard de la boucle d'événements, 99e centile, en millisecondes. */
  readonly boucleP99Ms: number
}

export interface ErreurRecente {
  readonly instant: string
  readonly famille: string
  readonly statut: number
  readonly message: string
}

export interface StatsFamille {
  readonly famille: string
  readonly requetes: number
  readonly erreurs5xx: number
  readonly erreurs4xx: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
  readonly maxMs: number
}

/** Le centile `p` (0–100) d'une liste DÉJÀ triée — rang le plus proche. */
export function centile(tries: readonly number[], p: number): number {
  if (tries.length === 0) return 0
  const rang = Math.min(tries.length - 1, Math.max(0, Math.ceil((p / 100) * tries.length) - 1))
  return tries[rang]!
}

export class Metriques {
  private readonly minutes: Minute[] = []
  private readonly echantillons = new Map<string, Echantillon[]>()
  private readonly erreurs: ErreurRecente[] = []
  private readonly points: PointProcessus[] = []
  private readonly demarrage = Date.now()
  private readonly boucle = monitorEventLoopDelay({ resolution: 20 })
  private dernierCpu = process.cpuUsage()
  private dernierInstant = performance.now()
  private minuteur: ReturnType<typeof setInterval> | null = null

  // Champ explicite, pas de « parameter property » : le service s'exécute
  // en source TypeScript, et le mode strip-only de Node ne les transforme pas.
  private readonly maintenant: () => number

  constructor(maintenant: () => number = Date.now) {
    this.maintenant = maintenant
  }

  /**
   * Démarre l'échantillonnage du processus. `unref` : un minuteur de
   * surveillance ne doit jamais retenir un processus qui s'arrête — ni un
   * test qui se termine.
   */
  demarrer(): this {
    if (this.minuteur) return this
    this.boucle.enable()
    this.minuteur = setInterval(() => this.echantillonnerProcessus(), INTERVALLE_PROCESSUS_MS)
    this.minuteur.unref?.()
    return this
  }

  arreter(): void {
    if (this.minuteur) clearInterval(this.minuteur)
    this.minuteur = null
    this.boucle.disable()
  }

  /** Appelé par le middleware, une fois par requête. */
  enregistrer(chemin: string, statut: number, ms: number): void {
    const instant = this.maintenant()
    const debut = instant - (instant % 60_000)
    let minute = this.minutes[this.minutes.length - 1]
    if (!minute || minute.debut !== debut) {
      minute = { debut, total: 0, erreurs5xx: 0, erreurs4xx: 0, dureeTotaleMs: 0 }
      this.minutes.push(minute)
      while (this.minutes.length > MINUTES_GARDEES) this.minutes.shift()
    }
    minute.total += 1
    minute.dureeTotaleMs += ms
    if (statut >= 500) minute.erreurs5xx += 1
    else if (statut >= 400) minute.erreurs4xx += 1

    const famille = familleDeRoute(chemin)
    let liste = this.echantillons.get(famille)
    if (!liste) this.echantillons.set(famille, (liste = []))
    liste.push({ instant, ms, statut })
    if (liste.length > ECHANTILLONS_PAR_FAMILLE) liste.splice(0, liste.length - ECHANTILLONS_PAR_FAMILLE)
  }

  /** Une erreur serveur, avec son message — les 30 dernières. */
  noterErreur(chemin: string, statut: number, message: string): void {
    this.erreurs.push({
      instant: new Date(this.maintenant()).toISOString(),
      famille: familleDeRoute(chemin),
      statut,
      message: message.slice(0, 300),
    })
    while (this.erreurs.length > ERREURS_GARDEES) this.erreurs.shift()
  }

  /** Public pour les tests : un point de mesure tout de suite. */
  echantillonnerProcessus(): PointProcessus {
    const cpu = process.cpuUsage(this.dernierCpu)
    const instant = performance.now()
    const ecouleMs = Math.max(1, instant - this.dernierInstant)
    this.dernierCpu = process.cpuUsage()
    this.dernierInstant = instant
    const memoire = process.memoryUsage()
    const point: PointProcessus = {
      instant: new Date(this.maintenant()).toISOString(),
      // µs de CPU (utilisateur + système) rapportées aux ms écoulées.
      cpuPourcent: Math.round(((cpu.user + cpu.system) / 1000 / ecouleMs) * 1000) / 10,
      rssOctets: memoire.rss,
      tasOctets: memoire.heapUsed,
      boucleP99Ms: Math.round(this.boucle.percentile(99) / 1e4) / 100,
    }
    this.boucle.reset()
    this.points.push(point)
    while (this.points.length > POINTS_PROCESSUS) this.points.shift()
    return point
  }

  /** Les familles sur une fenêtre, en minutes. */
  statsFamilles(fenetreMinutes = 15): StatsFamille[] {
    const depuis = this.maintenant() - fenetreMinutes * 60_000
    const stats: StatsFamille[] = []
    for (const [famille, liste] of this.echantillons) {
      const recents = liste.filter((e) => e.instant >= depuis)
      if (recents.length === 0) continue
      const durees = recents.map((e) => e.ms).sort((a, b) => a - b)
      stats.push({
        famille,
        requetes: recents.length,
        erreurs5xx: recents.filter((e) => e.statut >= 500).length,
        erreurs4xx: recents.filter((e) => e.statut >= 400 && e.statut < 500).length,
        p50Ms: Math.round(centile(durees, 50)),
        p95Ms: Math.round(centile(durees, 95)),
        p99Ms: Math.round(centile(durees, 99)),
        maxMs: Math.round(durees[durees.length - 1]!),
      })
    }
    return stats.sort((a, b) => b.requetes - a.requetes)
  }

  instantane() {
    const memoire = process.memoryUsage()
    return {
      demarreLe: new Date(this.demarrage).toISOString(),
      dureeVieSecondes: Math.round((this.maintenant() - this.demarrage) / 1000),
      processus: {
        node: process.version,
        coeurs: os.cpus().length,
        chargeSysteme: os.loadavg().map((v) => Math.round(v * 100) / 100),
        memoireSystemeOctets: os.totalmem(),
        memoireLibreOctets: os.freemem(),
        rssOctets: memoire.rss,
        tasOctets: memoire.heapUsed,
        tasTotalOctets: memoire.heapTotal,
        historique: [...this.points],
      },
      requetes: {
        parMinute: this.minutes.map((m) => ({
          minute: new Date(m.debut).toISOString(),
          total: m.total,
          erreurs5xx: m.erreurs5xx,
          erreurs4xx: m.erreurs4xx,
          dureeMoyenneMs: m.total ? Math.round(m.dureeTotaleMs / m.total) : 0,
        })),
        familles15min: this.statsFamilles(15),
      },
      erreursRecentes: [...this.erreurs].reverse(),
    }
  }
}

export type InstantaneMetriques = ReturnType<Metriques['instantane']>

export interface MesuresBase {
  readonly latenceMs: number
  readonly tailleOctets: number
  readonly connexions: number
  readonly connexionsActives: number
  readonly connexionsMax: number
  readonly attentesVerrou: number
  readonly requetePlusLongueSecondes: number
  /** Part des lectures servies par le cache, 0–100. Null : aucune lecture. */
  readonly cachePourcent: number | null
  readonly validations: number
  readonly annulations: number
  readonly interblocages: number
  readonly tables: readonly { nom: string; tailleOctets: number; lignesEstimees: number }[]
  readonly pool: { total: number; libres: number; enAttente: number; max: number }
  readonly metier: {
    evenements1h: number
    evenements24h: number
    commandes1h: number
    rejets24h: number
    caisses: number
    caissesVues15min: number
    caissesMuettes24h: number
    projectionsManquantes: number
  }
}

export interface Alerte {
  readonly niveau: 'critique' | 'attention'
  readonly sujet: string
  readonly message: string
}

/**
 * Les SEUILS — ce qui transforme cent chiffres en trois phrases.
 *
 * Un écran de métriques sans seuils est un écran qu'on ne regarde plus au
 * bout d'une semaine : personne ne sait si 61 % de cache est grave. Chaque
 * seuil dit ce qu'il protège ; les valeurs sont prudentes et se règlent ici.
 */
/**
 * Le plafond de taille de la base, en octets — `KAISSI_LIMITE_BASE_MO`.
 *
 * 500 Mo par défaut : celui de l'offre gratuite de Supabase au moment où
 * ces lignes sont écrites (à revérifier sur leur page de tarifs, et à
 * relever dans l'environnement dès le passage à une offre payante). La base
 * ne se purge pas de ses ventes — ce sont des pièces comptables — donc ce
 * plafond se voit venir des semaines à l'avance, ou se découvre le jour où
 * Supabase passe la base en lecture seule. Vendredi soir, en plein service.
 * `0` : aucune alerte.
 */
export function limiteBaseDepuisEnvironnement(env: NodeJS.ProcessEnv = process.env): number {
  const mo = Number(env['KAISSI_LIMITE_BASE_MO'] ?? 500)
  return Number.isFinite(mo) && mo > 0 ? mo * 1024 * 1024 : 0
}

export function evaluerAlertes(
  m: InstantaneMetriques,
  base: MesuresBase | null,
  migrationsManquantes: readonly string[],
  limiteBaseOctets: number = limiteBaseDepuisEnvironnement(),
): Alerte[] {
  const alertes: Alerte[] = []
  const critique = (sujet: string, message: string) => alertes.push({ niveau: 'critique', sujet, message })
  const attention = (sujet: string, message: string) => alertes.push({ niveau: 'attention', sujet, message })

  if (migrationsManquantes.length > 0) {
    critique(
      'Base de données',
      `Migration(s) manquante(s) : ${migrationsManquantes.join(', ')}. Les ventes poussées échouent ` +
        'jusqu’à ce qu’elles soient appliquées (Supabase → SQL Editor).',
    )
  }
  if (!base) {
    critique('Base de données', 'Mesures de la base illisibles : base injoignable ou trop lente.')
  }

  const push = m.requetes.familles15min.find((f) => f.famille === 'push')
  if (push && push.requetes >= 5) {
    const taux = push.erreurs5xx / push.requetes
    if (taux > 0.01) {
      critique(
        'Ventes',
        `${Math.round(taux * 100)} % des envois de ventes échouent (15 dernières minutes). ` +
          'Les caisses gardent ces ventes et réessaient, mais rien n’arrive au back-office.',
      )
    }
    if (push.p95Ms > 2_000) {
      attention('Ventes', `Envoi des ventes lent : 95 % sous ${push.p95Ms} ms (seuil 2 000 ms).`)
    }
  }

  const dernier = m.processus.historique[m.processus.historique.length - 1]
  if (dernier) {
    if (dernier.cpuPourcent > 80) {
      attention('Processeur', `Le service occupe ${dernier.cpuPourcent} % d’un cœur.`)
    }
    if (dernier.boucleP99Ms > 200) {
      critique(
        'Réactivité',
        `La boucle d’événements prend jusqu’à ${dernier.boucleP99Ms} ms de retard : ` +
          'chaque requête attend derrière un calcul.',
      )
    }
  }

  if (base) {
    if (limiteBaseOctets > 0) {
      const part = base.tailleOctets / limiteBaseOctets
      const mo = (o: number) => Math.round(o / (1024 * 1024))
      const texte =
        `La base occupe ${mo(base.tailleOctets)} Mo sur ${mo(limiteBaseOctets)} Mo ` +
        `(${Math.round(part * 100)} %). Les ventes ne se purgent pas : passer à l’offre ` +
        'supérieure, puis relever KAISSI_LIMITE_BASE_MO.'
      if (part >= 0.9) critique('Espace disque', texte)
      else if (part >= 0.7) attention('Espace disque', texte)
    }
    if (base.pool.enAttente > 0) {
      attention('Connexions', `${base.pool.enAttente} requête(s) attendent une connexion libre au pool.`)
    }
    if (base.connexionsMax > 0 && base.connexions / base.connexionsMax > 0.8) {
      critique(
        'Connexions',
        `${base.connexions} connexions sur ${base.connexionsMax} autorisées par PostgreSQL.`,
      )
    }
    if (base.cachePourcent !== null && base.cachePourcent < 95) {
      attention(
        'Base de données',
        `Seulement ${base.cachePourcent} % des lectures servies par le cache : la base manque de mémoire, ` +
          'ou une requête lit des tables entières.',
      )
    }
    if (base.requetePlusLongueSecondes > 10) {
      attention('Base de données', `Une requête tourne depuis ${Math.round(base.requetePlusLongueSecondes)} s.`)
    }
    if (base.latenceMs > 500) {
      attention('Base de données', `La base répond en ${base.latenceMs} ms à une requête triviale.`)
    }
    if (base.metier.projectionsManquantes > 0) {
      attention(
        'Ventes',
        `${base.metier.projectionsManquantes} vente(s) reçue(s) sans projection : invisibles au ` +
          'back-office jusqu’au prochain balayage de réparation (30 min).',
      )
    }
    if (base.metier.rejets24h > 0) {
      attention('Ventes', `${base.metier.rejets24h} opération(s) rejetée(s) en 24 h — à voir avec le gérant.`)
    }
    if (base.metier.caissesMuettes24h > 0) {
      attention(
        'Caisses',
        `${base.metier.caissesMuettes24h} caisse(s) active(s) n’ont pas parlé au serveur depuis 24 h.`,
      )
    }
  }
  return alertes
}
