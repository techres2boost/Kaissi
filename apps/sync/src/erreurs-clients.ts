/**
 * Les erreurs vues CHEZ LE CLIENT — sur la caisse et dans le back-office.
 *
 * ── Le trou que cela bouche ───────────────────────────────────────────────
 *
 * Le service voyait ses propres erreurs ; une caisse qui plantait sur un
 * écran, un back-office qui affichait « Cette page n'a pas pu s'afficher »
 * ne laissaient aucune trace ailleurs que dans la mémoire du restaurateur.
 * Ces erreurs entrent désormais au journal de supervision (catégorie
 * « terminal » pour la caisse, « application » pour le back-office).
 *
 * ── Pourquoi pas Sentry ───────────────────────────────────────────────────
 *
 * Un tiers de plus qui reçoit des piles d'appel de la caisse, un compte, un
 * quota, un domaine à admettre dans la garde du mode avion. Le besoin, ici,
 * est de SAVOIR qu'une erreur se produit, où et combien de fois ; le journal
 * existe déjà, et il est déjà nettoyé, plafonné, purgé.
 *
 * ── Ce que cela ne coûte pas ──────────────────────────────────────────────
 *
 * La caisse DÉDUPLIQUE avant d'envoyer (une signature par erreur, avec un
 * compte), et n'envoie que s'il y a quelque chose : zéro requête pour une
 * caisse qui va bien. Ce qui arrive ici entre dans le lot de la période —
 * aucune écriture de plus. Et tout est borné : vingt erreurs par envoi, un
 * message de 300 caractères, une pile de 1 500, passés par `nettoyer`.
 */

import { ErreurSync } from './protocole.js'

export interface ErreurClient {
  /** Empreinte stable de l'erreur, calculée par la caisse (dédoublonnage). */
  readonly signature: string
  readonly type: 'erreur' | 'promesse' | 'rendu'
  readonly message: string
  readonly pile: string | null
  /** L'écran où elle s'est produite (« Caisse », « Encaissement »…). */
  readonly ecran: string | null
  /** La version de l'application. */
  readonly version: string | null
  /** Combien de fois depuis le dernier envoi. */
  readonly nombre: number
  readonly premiere: string | null
  readonly derniere: string | null
}

export const ERREURS_PAR_ENVOI = 20

const texte = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : null

const date = (v: unknown): string | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null

/**
 * Lit le corps de `POST /sync/erreurs`. Une entrée illisible est IGNORÉE,
 * pas refusée : rejeter tout le lot pour une ligne mal formée ferait renvoyer
 * les dix-neuf autres à chaque cycle.
 */
export function lireErreursClients(corps: unknown): ErreurClient[] {
  const liste = (corps as { erreurs?: unknown } | null)?.erreurs
  if (!Array.isArray(liste)) {
    throw new ErreurSync('requete_invalide', 'Le corps doit porter une liste « erreurs ».')
  }
  if (liste.length > ERREURS_PAR_ENVOI) {
    throw new ErreurSync('requete_invalide', `Au plus ${ERREURS_PAR_ENVOI} erreurs par envoi.`)
  }
  const lues: ErreurClient[] = []
  for (const brute of liste) {
    const e = brute as Record<string, unknown>
    const signature = texte(e['signature'], 64)
    const message = texte(e['message'], 300)
    if (!signature || !/^[a-z0-9_-]+$/i.test(signature) || !message) continue
    const type = e['type'] === 'promesse' || e['type'] === 'rendu' ? e['type'] : 'erreur'
    const nombre = Number(e['nombre'])
    lues.push({
      signature,
      type,
      message,
      pile: texte(e['pile'], 1_500),
      ecran: texte(e['ecran'], 60),
      version: texte(e['version'], 30),
      nombre: Number.isInteger(nombre) && nombre > 0 ? Math.min(nombre, 1_000_000) : 1,
      premiere: date(e['premiere']),
      derniere: date(e['derniere']),
    })
  }
  return lues
}
