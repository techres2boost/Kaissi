/**
 * Lecture des formulaires du back-office.
 *
 * Pourquoi un module à part, pur et testé : c'est ICI que l'argent entre dans
 * le système. Un gérant tape « 24,5 » dans un champ ; si cette chaîne devient
 * un flottant JavaScript avant d'atteindre la base, la règle 1 est déjà
 * violée et personne ne le verra avant le premier écart de caisse.
 *
 * Tout montant passe donc par `depuisDecimal` de @kaissi/domain — la même
 * fonction que la tablette — et rien d'autre.
 */

import { depuisDecimal, ErreurMonnaie, millimes, type Millimes } from '@kaissi/domain'

/** Erreur destinée à être RÉAFFICHÉE à l'utilisateur, dans son champ. */
export class ErreurSaisie extends Error {
  constructor(
    readonly champ: string,
    message: string,
  ) {
    super(message)
    this.name = 'ErreurSaisie'
  }
}

function brut(donnees: FormData, champ: string): string {
  const valeur = donnees.get(champ)
  return typeof valeur === 'string' ? valeur.trim() : ''
}

/** Texte obligatoire, borné — les CHECK du schéma bornent déjà, on double. */
export function texteObligatoire(
  donnees: FormData,
  champ: string,
  libelle: string,
  max = 200,
): string {
  const valeur = brut(donnees, champ)
  if (valeur === '') throw new ErreurSaisie(champ, `${libelle} est obligatoire.`)
  if (valeur.length > max) {
    throw new ErreurSaisie(champ, `${libelle} ne peut pas dépasser ${max} caractères.`)
  }
  return valeur
}

export function texteFacultatif(donnees: FormData, champ: string): string | null {
  const valeur = brut(donnees, champ)
  return valeur === '' ? null : valeur
}

/**
 * Un montant saisi en dinars devient des millimes entiers.
 *
 * « 24,5 » et « 24.500 » donnent tous deux 24500. Le dinar a TROIS décimales :
 * une bibliothèque qui suppose deux transformerait 24,5 en 2450.
 */
export function montantMillimes(
  donnees: FormData,
  champ: string,
  libelle: string,
  options: { autoriseNegatif?: boolean } = {},
): Millimes {
  const valeur = brut(donnees, champ)
  if (valeur === '') throw new ErreurSaisie(champ, `${libelle} est obligatoire.`)

  let montant: Millimes
  try {
    montant = depuisDecimal(valeur)
  } catch (erreur) {
    if (erreur instanceof ErreurMonnaie) {
      throw new ErreurSaisie(champ, `${libelle} : « ${valeur} » n'est pas un montant valide.`)
    }
    throw erreur
  }

  if (!options.autoriseNegatif && montant < 0) {
    throw new ErreurSaisie(champ, `${libelle} ne peut pas être négatif.`)
  }
  return montant
}

/**
 * Un identifiant venant d'une liste déroulante.
 *
 * Vérifié contre les valeurs RÉELLEMENT proposées, jamais contre une simple
 * expression rationnelle : le navigateur n'est pas une source de vérité, et
 * un identifiant d'un autre établissement serait de toute façon rejeté par
 * RLS — mais avec un message que l'utilisateur ne pourrait pas comprendre.
 */
export function choix<T extends string>(
  donnees: FormData,
  champ: string,
  libelle: string,
  autorises: readonly T[],
): T {
  const valeur = brut(donnees, champ)
  if (!autorises.includes(valeur as T)) {
    throw new ErreurSaisie(champ, `${libelle} : choix invalide.`)
  }
  return valeur as T
}

export function choixFacultatif<T extends string>(
  donnees: FormData,
  champ: string,
  libelle: string,
  autorises: readonly T[],
): T | null {
  if (brut(donnees, champ) === '') return null
  return choix(donnees, champ, libelle, autorises)
}

/** Une case à cocher absente du FormData vaut « décochée ». */
export function caseCochee(donnees: FormData, champ: string): boolean {
  return donnees.get(champ) !== null
}

/** Un entier de position, borné pour éviter un tri absurde. */
export function position(donnees: FormData, champ: string): number {
  const valeur = brut(donnees, champ)
  if (valeur === '') return 0
  const nombre = Number(valeur)
  if (!Number.isInteger(nombre) || nombre < 0 || nombre > 9999) {
    throw new ErreurSaisie(champ, 'La position doit être un entier entre 0 et 9999.')
  }
  return nombre
}

/** Rend les millimes tels qu'un champ de saisie doit les afficher : « 24.500 ». */
export function pourChampMontant(montantMillimes: number): string {
  const absolu = Math.abs(montantMillimes)
  const entiere = Math.floor(absolu / 1000)
  const fraction = (absolu % 1000).toString().padStart(3, '0')
  return `${montantMillimes < 0 ? '-' : ''}${entiere}.${fraction}`
}

/** Zéro millime, pour les valeurs par défaut. */
export const AUCUN_MONTANT = millimes(0)
