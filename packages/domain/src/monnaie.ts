/**
 * Monnaie — le dinar tunisien a TROIS décimales.
 *
 * Tout montant est un entier de millimes (1 TND = 1000 millimes).
 * 24,500 TND  →  24500 millimes.
 *
 * RÈGLE ABSOLUE : aucun nombre à virgule flottante ne représente jamais
 * de l'argent, nulle part dans le code. Les fonctions de ce module sont
 * les seules autorisées à convertir depuis / vers une représentation
 * décimale, et uniquement aux frontières (saisie utilisateur, affichage).
 */

/** Marque de type : un entier de millimes, jamais un montant décimal. */
export type Millimes = number & { readonly __marque: 'Millimes' }

/** Points de base entiers : 19 % = 1900, 13 % = 1300, 7 % = 700. */
export type PointsDeBase = number & { readonly __marque: 'PointsDeBase' }

/** Zéro millime — constante pratique et typée. */
export const ZERO: Millimes = 0 as Millimes

/** Nombre de millimes dans une unité de dinar. */
export const MILLIMES_PAR_DINAR = 1000

/** Dénominateur des points de base (100 % = 10000 bp). */
export const BASE_POINTS = 10000

export class ErreurMonnaie extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurMonnaie'
  }
}

/**
 * Construit un montant en millimes à partir d'un entier.
 * Rejette tout ce qui n'est pas un entier sûr : c'est le garde-fou
 * qui empêche un flottant de se glisser dans une chaîne de calcul.
 */
export function millimes(valeur: number): Millimes {
  if (!Number.isSafeInteger(valeur)) {
    throw new ErreurMonnaie(
      `Montant invalide : ${valeur}. Un montant doit être un entier de millimes.`,
    )
  }
  return valeur as Millimes
}

/** Construit un taux en points de base à partir d'un entier (19 % → 1900). */
export function pointsDeBase(valeur: number): PointsDeBase {
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    throw new ErreurMonnaie(
      `Taux invalide : ${valeur}. Un taux s'exprime en points de base entiers (19 % = 1900).`,
    )
  }
  return valeur as PointsDeBase
}

/** 19 → 1900. Aide à la saisie d'un pourcentage entier en configuration. */
export function pourcentEnPointsDeBase(pourcent: number): PointsDeBase {
  return pointsDeBase(arrondirCommercial(pourcent * 100))
}

/**
 * Convertit une saisie décimale en millimes.
 * Utilisable UNIQUEMENT à la frontière d'entrée (formulaire, import CSV).
 * `"24,500"`, `"24.5"`, `24.5` → 24500.
 */
export function depuisDecimal(valeur: string | number, decimales = 3): Millimes {
  const texte = typeof valeur === 'number' ? valeur.toString() : valeur.trim().replace(',', '.')
  if (texte === '') return ZERO
  if (!/^-?\d*(\.\d*)?$/.test(texte)) {
    throw new ErreurMonnaie(`Montant décimal illisible : « ${valeur} »`)
  }
  const negatif = texte.startsWith('-')
  const absolu = negatif ? texte.slice(1) : texte
  const [entiere = '0', fraction = ''] = absolu.split('.')
  // On complète / tronque la partie fractionnaire à la précision de la devise,
  // en arrondissant sur le premier chiffre excédentaire (arrondi commercial).
  const fractionComplete = fraction.padEnd(decimales + 1, '0')
  const conserve = fractionComplete.slice(0, decimales)
  const chiffreSuivant = Number(fractionComplete[decimales] ?? '0')
  let total = Number(entiere || '0') * 10 ** decimales + Number(conserve || '0')
  if (chiffreSuivant >= 5) total += 1
  return millimes(negatif ? -total : total)
}

/** Convertit des millimes en chaîne décimale brute : 24500 → "24.500". */
export function versDecimal(montant: Millimes, decimales = 3): string {
  const negatif = montant < 0
  const absolu = Math.abs(montant)
  const facteur = 10 ** decimales
  const entiere = Math.floor(absolu / facteur)
  const fraction = (absolu % facteur).toString().padStart(decimales, '0')
  return `${negatif ? '-' : ''}${entiere}.${fraction}`
}

/**
 * Formate un montant pour l'affichage en français tunisien : 24500 → "24,500 TND".
 * Fonction pure : pas d'Intl (comportement variable selon l'appareil Android).
 */
export function formaterTND(montant: Millimes, options: { symbole?: boolean } = {}): string {
  const { symbole = true } = options
  const negatif = montant < 0
  const absolu = Math.abs(montant)
  const entiere = Math.floor(absolu / MILLIMES_PAR_DINAR)
  const fraction = (absolu % MILLIMES_PAR_DINAR).toString().padStart(3, '0')
  // Séparateur de milliers : espace FINE insécable (U+202F), usage francophone.
  // Échappée explicitement : ce caractère est invisible dans un éditeur.
  const entiereGroupee = entiere.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')
  const corps = `${negatif ? '-' : ''}${entiereGroupee},${fraction}`
  return symbole ? `${corps} TND` : corps
}

/** Addition sûre : conserve la marque de type et vérifie le débordement. */
export function additionner(...montants: Millimes[]): Millimes {
  return millimes(montants.reduce<number>((total, m) => total + m, 0))
}

/** Soustraction sûre. */
export function soustraire(a: Millimes, b: Millimes): Millimes {
  return millimes(a - b)
}

/** Multiplication par une quantité ENTIÈRE — le seul produit autorisé sans arrondi. */
export function multiplier(montant: Millimes, quantite: number): Millimes {
  if (!Number.isSafeInteger(quantite)) {
    throw new ErreurMonnaie(
      `Quantité non entière : ${quantite}. Utiliser appliquerRatio() pour un facteur fractionnaire.`,
    )
  }
  return millimes(montant * quantite)
}

/** Valeur absolue. */
export function valeurAbsolue(montant: Millimes): Millimes {
  return millimes(Math.abs(montant))
}

/** Borne un montant dans [min, max]. */
export function borner(montant: Millimes, min: Millimes, max: Millimes): Millimes {
  return millimes(Math.min(Math.max(montant, min), max))
}

/**
 * Arrondi commercial déterministe : demi vers le HAUT en valeur absolue
 * (« half away from zero »). C'est la règle retenue pour tout Kaissi :
 * elle est identique sur l'appareil et sur le serveur, et ne dépend
 * d'aucune particularité de l'IEEE-754 comme `Math.round` sur les négatifs.
 *
 *   2,5 → 3   |   -2,5 → -3   |   2,4 → 2
 */
export function arrondirCommercial(valeur: number): number {
  if (!Number.isFinite(valeur)) {
    throw new ErreurMonnaie(`Valeur non finie à arrondir : ${valeur}`)
  }
  return valeur < 0 ? -Math.round(-valeur) : Math.round(valeur)
}

/**
 * Applique un ratio exprimé en points de base à un montant, avec arrondi
 * commercial. `appliquerPointsDeBase(24500, 1900)` → TVA de 19 % = 4655.
 *
 * Le calcul passe par des entiers jusqu'au dernier moment : `montant * bp`
 * reste exact tant qu'il tient dans Number.MAX_SAFE_INTEGER, soit
 * ~900 milliards de millimes à 10000 bp. Très largement suffisant.
 */
export function appliquerPointsDeBase(montant: Millimes, taux: PointsDeBase): Millimes {
  const produit = montant * taux
  if (!Number.isSafeInteger(produit)) {
    throw new ErreurMonnaie(
      `Débordement de précision : ${montant} × ${taux} dépasse l'entier sûr.`,
    )
  }
  return millimes(arrondirCommercial(produit / BASE_POINTS))
}

/**
 * Extrait la part de taxe d'un montant TTC dont le taux est INCLUS.
 * base_ht = arrondi(ttc × 10000 / (10000 + bp)), taxe = ttc − base_ht.
 * On calcule la base puis on déduit la taxe : ainsi base + taxe = ttc, toujours.
 */
export function extraireTaxeIncluse(
  montantTTC: Millimes,
  taux: PointsDeBase,
): { baseHT: Millimes; taxe: Millimes } {
  const baseHT = millimes(
    arrondirCommercial((montantTTC * BASE_POINTS) / (BASE_POINTS + taux)),
  )
  return { baseHT, taxe: soustraire(montantTTC, baseHT) }
}

/** Applique un ratio fractionnaire (quantité décimale de stock, par exemple). */
export function appliquerRatio(
  montant: Millimes,
  numerateur: number,
  denominateur: number,
): Millimes {
  if (denominateur === 0) throw new ErreurMonnaie('Division par zéro dans appliquerRatio()')
  return millimes(arrondirCommercial((montant * numerateur) / denominateur))
}

/** Somme d'une liste de millimes. */
export function sommer(montants: readonly Millimes[]): Millimes {
  return millimes(montants.reduce<number>((total, m) => total + m, 0))
}
