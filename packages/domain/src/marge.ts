/**
 * Coûts, marges et indicateurs de vente — PURS, comme le reste du domaine.
 *
 * ── Pourquoi ici, et pas dans une requête SQL ─────────────────────────────
 *
 * RÈGLE 7 : l'argent se calcule à UN SEUL endroit. Une marge additionnée en
 * SQL dans le back-office et recalculée ailleurs finirait par diverger, et
 * personne ne saurait laquelle croire. Ces fonctions sont donc importées par
 * le back-office comme `calculerTotaux` l'est par la caisse.
 *
 * ── Le coût est la SEULE exception au tout-entier ─────────────────────────
 *
 * Un prix de vente est un entier de millimes. Un coût unitaire, non : le coût
 * d'un gramme de mozzarella est inférieur au millime (`numeric(18,6)` en
 * base). Arrondir chaque ligne ferait dériver le total de plusieurs dinars
 * sur un service. On accumule donc les coûts EXACTS, et on n'arrondit qu'au
 * total — ce que `totaliserCouts` impose par sa signature.
 */

import {
  arrondirCommercial,
  millimes,
  type Millimes,
} from './monnaie.js'

/**
 * Coût EXACT d'une ligne, non arrondi.
 *
 * Rend `0` quand le coût unitaire n'est pas renseigné : un produit sans coût
 * saisi ne vaut pas « coût nul » au sens comptable, mais le rapport doit
 * rester lisible. C'est `lignesSansCout` qui signale l'angle mort, plutôt
 * qu'un total faux présenté comme juste.
 */
export function coutLigneExact(
  coutUnitaire: number | null | undefined,
  quantite: number,
): number {
  if (coutUnitaire === null || coutUnitaire === undefined) return 0
  if (!Number.isFinite(coutUnitaire) || !Number.isFinite(quantite)) return 0
  return coutUnitaire * quantite
}

/** Somme de coûts exacts, arrondie UNE fois — jamais ligne par ligne. */
export function totaliserCouts(coutsExacts: readonly number[]): Millimes {
  const somme = coutsExacts.reduce((total, c) => total + c, 0)
  return millimes(arrondirCommercial(somme))
}

export interface Marge {
  /** Chiffre d'affaires retenu comme base (hors taxes exclusives). */
  readonly caMillimes: Millimes
  readonly coutMillimes: Millimes
  /** CA − coût. PEUT être négatif : vendre à perte doit se voir. */
  readonly margeMillimes: Millimes
  /**
   * Marge rapportée au CA, en points de base. 33,33 % → 3333.
   *
   * Sur le CA et non sur le coût : c'est la convention des logiciels de
   * caisse (Loyverse compris), et celle que le restaurateur compare d'un
   * mois sur l'autre. `null` quand le CA est nul — un pourcentage d'une
   * base nulle n'existe pas, et afficher « 0 % » ferait croire à une marge
   * nulle plutôt qu'à une absence de vente.
   */
  readonly margeBp: number | null
}

/**
 * Marge d'un agrégat quelconque : un produit, une catégorie, une journée.
 *
 * Le CA attendu est la base APRÈS remises et HORS taxes exclusives — c'est
 * la seule grandeur comparable au coût d'achat, qui est lui aussi hors taxe.
 * Mélanger un CA TTC et un coût HT gonflerait la marge d'un point de TVA.
 */
export function calculerMarge(caMillimes: Millimes, coutMillimes: Millimes): Marge {
  const marge = millimes(caMillimes - coutMillimes)
  return {
    caMillimes,
    coutMillimes,
    margeMillimes: marge,
    margeBp: caMillimes === 0 ? null : arrondirCommercial((marge / caMillimes) * 10000),
  }
}

/**
 * Panier moyen. `null` sans ticket : diviser par zéro donnerait « Infinity »
 * à l'écran, et « 0,000 » ferait croire à des ventes vides.
 */
export function panierMoyen(
  caMillimes: Millimes,
  nombreTickets: number,
): Millimes | null {
  if (nombreTickets <= 0) return null
  return millimes(arrondirCommercial(caMillimes / nombreTickets))
}

/**
 * Marge unitaire d'un produit, telle que le gérant la saisit au catalogue.
 * Burger à 15 000 millimes, coût 10 000 → marge 5 000, soit 33,33 %.
 */
export function margeProduit(
  prixVenteMillimes: Millimes,
  coutUnitaire: number | null | undefined,
): Marge {
  const cout = totaliserCouts([coutLigneExact(coutUnitaire, 1)])
  return calculerMarge(prixVenteMillimes, cout)
}
