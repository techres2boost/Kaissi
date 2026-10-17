/**
 * La langue du back-office — ce que le serveur et le navigateur partagent.
 *
 * ── Un réglage de la PERSONNE, porté par un cookie ────────────────────────
 *
 * La caisse garde sa langue dans l'appareil (`localStorage`) : c'est une
 * tablette, tenue par qui est au comptoir. Le back-office, lui, est rendu
 * par le SERVEUR — il doit connaître la langue avant d'écrire la première
 * ligne de HTML, sans quoi la page s'afficherait en français puis
 * basculerait en arabe et de gauche à droite sous les yeux du gérant. Un
 * cookie est la seule mémoire du navigateur que le serveur lit avec la
 * requête.
 *
 * Le cookie n'a rien de secret ni d'authentifiant : une valeur inconnue
 * retombe sur le français, et c'est tout ce qu'elle peut faire.
 */

import { libelleModePaiement } from '@kaissi/domain'
import {
  aTraduire,
  estLangue,
  formaterDate,
  LANGUE_PAR_DEFAUT,
  locale,
  traduire,
  traduireMessage,
  type Langue,
  type Valeurs,
} from '@kaissi/i18n'

export const COOKIE_LANGUE = 'kaissi_langue'

export function langueDuCookie(valeur: string | undefined | null): Langue {
  return estLangue(valeur) ? valeur : LANGUE_PAR_DEFAUT
}

/**
 * Un `t()` lié à la langue de la page, avec ses outils.
 *
 * Une seule variable par composant, `t`, plutôt que quatre : `t('…')`
 * traduit une phrase, `t.m(message)` un message déjà assemblé ailleurs (une
 * erreur renvoyée par une action serveur), `t.date(…)` une date.
 */
export interface Traduction {
  (texte: string, valeurs?: Valeurs): string
  readonly langue: Langue
  /** `fr-FR` ou `ar-TN` — pour un `Intl` qui écrit des mois ou des jours. */
  readonly locale: 'fr-FR' | 'ar-TN'
  /** Un message DÉJÀ ASSEMBLÉ en français — reconnu par son modèle. */
  m(message: string): string
  /** Date ou heure, dans la langue, toujours sur 24 h. */
  date(date: Date | string | number, options: Intl.DateTimeFormatOptions): string
  /** Le mode de paiement, traduit dans le contexte `paiement`. */
  paiement(mode: string): string
  /** Le rôle d'un membre, lisible. */
  role(role: string): string
  /**
   * Un libellé de DONNÉE : traduit seulement s'il a été écrit par Kaissi
   * (« Sans catégorie »), jamais s'il l'a été par le restaurateur. Une
   * catégorie que le gérant a nommée « Desserts » reste « Desserts ».
   */
  donnee(libelle: string): string
}

/**
 * Les libellés que Kaissi écrit LUI-MÊME dans des données — une ligne de
 * rapport sans catégorie, une remise sans motif. Ils se traduisent ; le
 * reste d'une colonne de noms appartient au restaurateur.
 */
export const LIBELLES_SYSTEME: ReadonlySet<string> = new Set([
  aTraduire('Sans catégorie'),
  aTraduire('Sans motif'),
  aTraduire('Catégorie archivée'),
  aTraduire('Produit archivé'),
])

const ROLES: Readonly<Record<string, string>> = {
  admin: 'role|Administrateur',
  gerant: 'role|Gérant',
  caissier: 'role|Caissier',
  serveur: 'role|Serveur',
  cuisine: 'role|Cuisine',
  bar: 'role|Bar',
}

const cache = new Map<Langue, Traduction>()

export function creerTraduction(langue: Langue): Traduction {
  const deja = cache.get(langue)
  if (deja) return deja
  const t = ((texte: string, valeurs?: Valeurs) => traduire(langue, texte, valeurs)) as Traduction
  Object.assign(t, {
    langue,
    locale: locale(langue),
    m: (message: string) => traduireMessage(langue, message),
    date: (date: Date | string | number, options: Intl.DateTimeFormatOptions) =>
      formaterDate(langue, date, options),
    paiement: (mode: string) => traduire(langue, `paiement|${libelleModePaiement(mode)}`),
    role: (role: string) => (ROLES[role] ? traduire(langue, ROLES[role]) : role),
    donnee: (libelle: string) => (LIBELLES_SYSTEME.has(libelle) ? traduire(langue, libelle) : libelle),
  })
  cache.set(langue, t)
  return t
}
