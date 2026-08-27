/**
 * Les bornes d'une journée commerciale, en instants absolus.
 *
 * Pourquoi ce calcul existe : un restaurant qui sert jusqu'à une heure du
 * matin encaisse une partie de sa soirée du vendredi APRÈS minuit. Découper
 * sur le jour calendaire couperait ce service en deux — un vendredi amputé,
 * et un samedi qui commence par des ventes que le gérant ne reconnaît pas.
 *
 * Le résultat est volontairement une paire d'instants absolus : la requête
 * filtre alors sur `closed_at`, qui est indexé, plutôt que d'appeler une
 * fonction sur chaque ligne.
 */

/** Décalage du fuseau, en minutes, à un instant donné. */
function decalageMinutes(instant: Date, fuseau: string): number {
  // `Intl` est la seule source fiable : elle connaît l'historique des
  // changements d'heure, qu'une table de décalages codée en dur perdrait.
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parties = Object.fromEntries(
    format.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>

  const local = Date.UTC(
    Number(parties['year']),
    Number(parties['month']) - 1,
    Number(parties['day']),
    Number(parties['hour']) === 24 ? 0 : Number(parties['hour']),
    Number(parties['minute']),
    Number(parties['second']),
  )
  return (local - Math.floor(instant.getTime() / 1000) * 1000) / 60_000
}

/**
 * Convertit une heure locale (« 2026-08-29 04:00 » à Tunis) en instant absolu.
 *
 * Le décalage dépend de l'instant, et l'instant dépend du décalage : on part
 * d'une estimation, puis on corrige une fois. Une seule correction suffit —
 * un fuseau ne change jamais deux fois dans la même journée.
 */
function instantDepuisLocal(annee: number, mois: number, jour: number, minutes: number, fuseau: string): Date {
  const naif = Date.UTC(annee, mois - 1, jour, 0, minutes)
  const premier = new Date(naif - decalageMinutes(new Date(naif), fuseau) * 60_000)
  return new Date(naif - decalageMinutes(premier, fuseau) * 60_000)
}

export class ErreurJournee extends Error {}

/** « 04:00 » ou « 04:00:00 » → minutes depuis minuit. */
export function minutesDeBascule(bascule: string): number {
  const trouve = /^(\d{2}):(\d{2})(:\d{2})?$/.exec(bascule.trim())
  if (!trouve) throw new ErreurJournee(`Heure de bascule illisible : « ${bascule} »`)
  const heures = Number(trouve[1])
  const minutes = Number(trouve[2])
  if (heures > 23 || minutes > 59) throw new ErreurJournee(`Heure de bascule hors plage : « ${bascule} »`)
  return heures * 60 + minutes
}

export interface BornesJournee {
  /** Premier instant inclus. */
  debut: Date
  /** Premier instant EXCLU — jamais « fin de journée à 23:59:59,999 ». */
  fin: Date
}

/**
 * Les bornes de la journée commerciale `journee` (format « AAAA-MM-JJ »).
 *
 * La borne haute est EXCLUE. Utiliser « ≤ 23:59:59 » perdrait toute vente
 * horodatée dans la dernière seconde — rare, mais silencieux.
 */
export function bornesJourneeCommerciale(
  journee: string,
  fuseau: string,
  bascule: string,
): BornesJournee {
  const trouve = /^(\d{4})-(\d{2})-(\d{2})$/.exec(journee)
  if (!trouve) throw new ErreurJournee(`Date illisible : « ${journee} » (attendu AAAA-MM-JJ)`)

  const minutes = minutesDeBascule(bascule)
  const annee = Number(trouve[1])
  const mois = Number(trouve[2])
  const jour = Number(trouve[3])

  const debut = instantDepuisLocal(annee, mois, jour, minutes, fuseau)
  const fin = instantDepuisLocal(annee, mois, jour + 1, minutes, fuseau)
  return { debut, fin }
}

/** La journée commerciale en cours, au format « AAAA-MM-JJ ». */
export function journeeCourante(fuseau: string, bascule: string, maintenant = new Date()): string {
  const decale = new Date(maintenant.getTime() - minutesDeBascule(bascule) * 60_000)
  // `en-CA` produit « AAAA-MM-JJ », qui est exactement le format attendu.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(decale)
}

/** « 2026-08-29 » → « samedi 29 août 2026 ». */
export function libelleJournee(journee: string): string {
  const [annee, mois, jour] = journee.split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(annee!, mois! - 1, jour!)))
}

/** Le jour commercial précédent ou suivant, pour la navigation. */
export function journeeDecalee(journee: string, jours: number): string {
  const [annee, mois, jour] = journee.split('-').map(Number)
  const decale = new Date(Date.UTC(annee!, mois! - 1, jour! + jours))
  return decale.toISOString().slice(0, 10)
}
