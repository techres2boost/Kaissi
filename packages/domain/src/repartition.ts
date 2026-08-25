/**
 * Répartition au prorata.
 *
 * C'est l'étape 4 de l'ordre de calcul figé (voir `totaux.ts`) et l'une des
 * deux sources d'écart les plus fréquentes en production : sans répartition
 * de la remise globale sur les lignes, la base taxable PAR TAUX est fausse
 * et la TVA aussi.
 *
 * Règle Kaissi, en deux temps :
 *   1. chaque part est le PLANCHER du prorata exact — jamais plus que dû ;
 *   2. l'écart résiduel est reversé en partant de la DERNIÈRE ligne et en
 *      remontant, sans jamais faire dépasser une part au-delà de son poids.
 *
 * Le garde-fou du point 2 n'est pas théorique : sur un ticket qui mêle un
 * plat à 3,333 TND et un supplément à 0,001 TND, mettre tout le résidu sur
 * la dernière ligne rendrait sa base NÉGATIVE et casserait la TVA du groupe.
 * La remontée est déterministe, donc identique sur la tablette et le serveur.
 */

import { millimes, type Millimes } from './monnaie.js'

export interface RepartitionResultat {
  /** Une part par poids fourni, dans le même ordre. Toujours 0 ≤ part ≤ poids. */
  readonly parts: readonly Millimes[]
  /** Écart d'arrondi total reversé après le calcul des planchers. */
  readonly ecartResiduel: Millimes
  /** Dernière ligne de poids non nul — la cible naturelle du résidu, ou -1. */
  readonly indexAbsorbeur: number
  /** Indices ayant réellement absorbé une part du résidu, en ordre croissant. */
  readonly indicesAbsorbeurs: readonly number[]
}

export class ErreurRepartition extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurRepartition'
  }
}

/**
 * Répartit `montant` sur `poids` au prorata.
 *
 * - `montant` doit être ≥ 0 et ≤ Σ poids (utiliser `bornerRemise` avant).
 * - La somme des parts vaut EXACTEMENT `montant`.
 * - Chaque part est bornée par son poids : aucune ligne ne peut devenir négative.
 * - Un poids nul reçoit toujours 0 : une ligne offerte n'absorbe pas de remise.
 */
export function repartirAuProrata(
  montant: Millimes,
  poids: readonly Millimes[],
): RepartitionResultat {
  if (montant < 0) {
    throw new ErreurRepartition(`Montant à répartir négatif : ${montant}`)
  }
  if (poids.some((p) => p < 0)) {
    throw new ErreurRepartition('Poids négatif dans une répartition au prorata')
  }

  const total = poids.reduce<number>((somme, p) => somme + p, 0)
  const parts: number[] = new Array(poids.length).fill(0)
  const vide: RepartitionResultat = {
    parts: parts.map((p) => millimes(p)),
    ecartResiduel: millimes(0),
    indexAbsorbeur: -1,
    indicesAbsorbeurs: [],
  }

  if (montant === 0 || total === 0) return vide

  if (montant > total) {
    throw new ErreurRepartition(
      `Montant à répartir (${montant}) supérieur à la somme des poids (${total}). ` +
        `Borner avec bornerRemise() avant d'appeler repartirAuProrata().`,
    )
  }

  // ── Temps 1 : plancher du prorata exact ───────────────────────────────────
  let distribue = 0
  let indexAbsorbeur = -1
  for (let i = 0; i < poids.length; i += 1) {
    const p = poids[i] ?? 0
    if (p === 0) continue
    const part = Math.floor((montant * p) / total)
    parts[i] = part
    distribue += part
    indexAbsorbeur = i // dernière ligne de poids non nul
  }

  // ── Temps 2 : reversement du résidu, de la dernière ligne vers la première ─
  const ecartResiduel = montant - distribue
  let reste = ecartResiduel
  const indicesAbsorbeurs: number[] = []
  for (let i = poids.length - 1; i >= 0 && reste > 0; i -= 1) {
    const p = poids[i] ?? 0
    if (p === 0) continue
    const capacite = p - (parts[i] ?? 0)
    if (capacite <= 0) continue
    const verse = Math.min(reste, capacite)
    parts[i] = (parts[i] ?? 0) + verse
    reste -= verse
    indicesAbsorbeurs.unshift(i)
  }

  // Ne peut pas arriver : Σ capacités = total − distribué ≥ résidu.
  if (reste !== 0) {
    throw new ErreurRepartition(
      `Résidu de répartition non absorbable : ${reste} millime(s) restant(s).`,
    )
  }

  return {
    parts: parts.map((p) => millimes(p)),
    ecartResiduel: millimes(ecartResiduel),
    indexAbsorbeur,
    indicesAbsorbeurs,
  }
}

/**
 * Borne une remise pour qu'elle ne dépasse jamais la base sur laquelle elle
 * s'applique. Une remise supérieure au montant dû donnerait un total négatif :
 * on la plafonne et on signale le dépassement à l'appelant, qui doit l'afficher.
 */
export function bornerRemise(
  remise: Millimes,
  base: Millimes,
): { remise: Millimes; plafonnee: boolean } {
  if (remise < 0) throw new ErreurRepartition(`Remise négative : ${remise}`)
  if (remise > base) return { remise: base, plafonnee: true }
  return { remise, plafonnee: false }
}
