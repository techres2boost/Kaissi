/**
 * La langue de CETTE caisse — français ou arabe.
 *
 * ── Un réglage par terminal ───────────────────────────────────────────────
 *
 * Deux tablettes du même restaurant peuvent parler deux langues : celle du
 * comptoir est tenue par une caissière qui lit l'arabe, celle du gérant reste
 * en français. La langue est donc un réglage de l'APPAREIL, pas de
 * l'établissement — comme sur un téléphone.
 *
 * Elle est lue UNE fois, au démarrage, de façon SYNCHRONE : la toute
 * première image de l'écran doit déjà être dans la bonne langue et dans le
 * bon sens. La base SQLite est asynchrone ; `localStorage` ne l'est pas, et
 * il vit dans le même stockage que la WebView. Changer de langue recharge
 * l'application — le bundle est local, cela prend une seconde et ne coûte
 * aucun réseau.
 *
 * `t` est donc une fonction ordinaire, pas un hook : elle s'appelle partout,
 * y compris dans un message d'erreur levé loin de React.
 */

import { libelleModePaiement } from '@kaissi/domain'
import {
  direction,
  estLangue,
  formaterDate,
  LANGUE_PAR_DEFAUT,
  traduire,
  traduireMessage,
  type Langue,
  type Valeurs,
} from '@kaissi/i18n'

const CLE = 'kaissi.langue'

function lireLangue(): Langue {
  try {
    const valeur = window.localStorage.getItem(CLE)
    return estLangue(valeur) ? valeur : LANGUE_PAR_DEFAUT
  } catch {
    // Stockage refusé (mode privé, aperçu) : la caisse doit quand même s'ouvrir.
    return LANGUE_PAR_DEFAUT
  }
}

export const langue: Langue = typeof window === 'undefined' ? LANGUE_PAR_DEFAUT : lireLangue()

/** Traduit une phrase française de l'interface. */
export function t(texte: string, valeurs?: Valeurs): string {
  return traduire(langue, texte, valeurs)
}

/**
 * Traduit un message DÉJÀ ASSEMBLÉ ailleurs — une erreur du domaine, de la
 * base locale ou du serveur de synchronisation.
 */
export function tm(message: string): string {
  return traduireMessage(langue, message)
}

/**
 * Le mode de paiement, dans la langue du terminal.
 *
 * Le libellé français vient du DOMAINE (`libelleModePaiement`) ; on le
 * traduit dans le contexte `paiement`, parce que « Carte » et « En ligne »
 * y veulent dire autre chose que dans le reste de l'écran.
 */
export function libellePaiement(mode: string): string {
  return t(`paiement|${libelleModePaiement(mode)}`)
}

/**
 * Le rôle d'un employé, lisible.
 *
 * Le code (`gerant`, `caissier`) s'affichait tel quel sur l'écran de prise
 * de poste — même en français. Un libellé par rôle, traduit dans le
 * contexte `role`.
 */
const ROLES: Readonly<Record<string, string>> = {
  admin: 'role|Administrateur',
  gerant: 'role|Gérant',
  caissier: 'role|Caissier',
  serveur: 'role|Serveur',
  cuisine: 'role|Cuisine',
  bar: 'role|Bar',
}

export function libelleRole(role: string): string {
  const cle = ROLES[role]
  return cle ? t(cle) : role
}

/** Date ou heure, dans la langue du terminal, toujours sur 24 h. */
export function dateLocale(date: Date | string | number, options: Intl.DateTimeFormatOptions): string {
  return formaterDate(langue, date, options)
}

/** Pose `lang` et `dir` sur la page — avant le premier rendu. */
export function appliquerLangue(): void {
  document.documentElement.lang = langue
  document.documentElement.dir = direction(langue)
}

/** Change la langue de ce terminal, puis recharge l'application. */
export function changerLangue(nouvelle: Langue): void {
  if (nouvelle === langue) return
  try {
    window.localStorage.setItem(CLE, nouvelle)
  } catch {
    return
  }
  window.location.reload()
}
