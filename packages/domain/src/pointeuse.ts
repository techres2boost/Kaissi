/**
 * Pointeuse — les heures travaillées, à UN seul endroit.
 *
 * Un pointage est une arrivée et, plus tard, une sortie. Il est créé sur la
 * tablette (UUIDv7, RÈGLE 2) : on pointe en arrivant, réseau ou pas.
 *
 * ── Ce que la pointeuse prouve, et ce qu'elle ne prouve pas ───────────────
 *
 * Comme le PIN, elle TRACE : « Karim a dit être arrivé à 10 h 02 sur la
 * caisse 2 ». L'heure est celle de la TABLETTE, réglable à la main, et la
 * synchronisation ne s'en sert jamais comme curseur (RÈGLE 4). Le serveur
 * note en plus l'heure de RÉCEPTION, qui permet de repérer une horloge
 * déréglée — mais une tablette hors ligne depuis trois heures ne peut pas
 * dire mieux que son horloge.
 *
 * ⚠ Ce n'est pas un registre du temps de travail au sens du Code du
 *   travail tunisien. Si un tel registre est exigé, sa forme et sa durée de
 *   conservation viennent d'un juriste, pas d'ici.
 *
 * ── La sortie oubliée ─────────────────────────────────────────────────────
 *
 * Le cas normal d'une pointeuse, pas l'exception : un serveur part sans
 * pointer. Compter le pointage resté ouvert jusqu'à « maintenant » lui
 * attribuerait trente heures ; ne rien compter effacerait sa journée. Au-delà
 * de `DUREE_MAX_POINTAGE_MIN`, il n'est donc PAS additionné, et il est
 * SIGNALÉ — le gérant corrige l'heure de sortie au back-office. Un chiffre
 * faux qui a l'air juste est pire qu'une ligne « à vérifier ».
 */

import type { Uuid } from './types.js'

export interface Pointage {
  readonly id: Uuid
  readonly employeId: Uuid | null
  /** ISO 8601 — horloge de l'appareil. */
  readonly arriveeA: string
  readonly sortieA: string | null
}

/** Au-delà, un pointage encore ouvert est une sortie oubliée. 16 h. */
export const DUREE_MAX_POINTAGE_MIN = 16 * 60

/**
 * Durée d'un pointage clos, en minutes entières (arrondi inférieur).
 *
 * Une sortie ANTÉRIEURE à l'arrivée — horloge reculée entre les deux —
 * compte zéro, et le pointage est signalé par `etatPointage` : on ne
 * soustrait jamais des heures à quelqu'un parce qu'une tablette a changé de
 * fuseau.
 */
export function dureeMinutes(arriveeA: string, sortieA: string): number {
  const debut = Date.parse(arriveeA)
  const fin = Date.parse(sortieA)
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return 0
  return Math.max(0, Math.floor((fin - debut) / 60_000))
}

export type EtatPointage = 'en_cours' | 'clos' | 'sortie_oubliee' | 'incoherent'

export function etatPointage(p: Pointage, maintenant: Date = new Date()): EtatPointage {
  if (p.sortieA === null) {
    const ouvert = (maintenant.getTime() - Date.parse(p.arriveeA)) / 60_000
    return ouvert > DUREE_MAX_POINTAGE_MIN ? 'sortie_oubliee' : 'en_cours'
  }
  const brut = (Date.parse(p.sortieA) - Date.parse(p.arriveeA)) / 60_000
  if (!Number.isFinite(brut) || brut < 0 || brut > DUREE_MAX_POINTAGE_MIN) return 'incoherent'
  return 'clos'
}

export interface HeuresEmploye {
  readonly employeId: Uuid | null
  /** Minutes des pointages CLOS et cohérents. */
  readonly minutes: number
  readonly pointages: number
  /** Pointés en ce moment. */
  readonly enCours: number
  /** Sorties oubliées et durées incohérentes : non comptées, à corriger. */
  readonly aVerifier: number
}

/**
 * Les heures par employé. Seuls les pointages CLOS et cohérents s'additionnent ;
 * les autres sont comptés à part, pour être vus.
 *
 * La période est celle de l'ARRIVÉE : un service de 22 h à 2 h compte pour
 * le jour où il a commencé — c'est ainsi qu'un restaurant pense sa soirée.
 */
export function heuresParEmploye(
  pointages: readonly Pointage[],
  maintenant: Date = new Date(),
): HeuresEmploye[] {
  const parEmploye = new Map<string, { employeId: Uuid | null; minutes: number; pointages: number; enCours: number; aVerifier: number }>()
  for (const p of pointages) {
    const cle = p.employeId ?? '—'
    const cumul = parEmploye.get(cle) ?? { employeId: p.employeId, minutes: 0, pointages: 0, enCours: 0, aVerifier: 0 }
    cumul.pointages += 1
    const etat = etatPointage(p, maintenant)
    if (etat === 'clos') cumul.minutes += dureeMinutes(p.arriveeA, p.sortieA!)
    else if (etat === 'en_cours') cumul.enCours += 1
    else cumul.aVerifier += 1
    parEmploye.set(cle, cumul)
  }
  return [...parEmploye.values()].sort((a, b) => b.minutes - a.minutes)
}

/** « 7 h 05 » — jamais « 7,08 h », que personne ne sait lire. */
export function formaterDuree(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes))
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
