/**
 * Les mutations du CATALOGUE émises par une caisse.
 *
 * ── Pourquoi un type à part, et pas un `order_event` de plus ──────────────
 *
 * Un événement de commande raconte ce qui est arrivé à UNE vente, et sa règle
 * d'or est l'immuabilité : on n'efface rien, on ajoute. Un article du
 * catalogue, lui, est une ligne MUTABLE du référentiel — son prix change, son
 * nom se corrige, il s'archive.
 *
 * Les mélanger aurait fait porter à `order_events` des lignes qui n'y ont pas
 * leur place, et la reprojection d'une commande aurait dû les ignorer une par
 * une. Ce sont deux journaux, deux routes, deux tables d'arrivée.
 *
 * ── Ce qui reste commun, et qui n'est pas négociable ──────────────────────
 *
 *  • l'identifiant du produit est un UUIDv7 généré PAR L'APPAREIL (règle 2) :
 *    l'article existe et se vend avant d'avoir vu le réseau ;
 *  • `mutationId` est la clé d'idempotence (règle 5). La même mutation
 *    renvoyée cinq fois n'est appliquée qu'une fois ;
 *  • le prix est en millimes entiers (règle 1).
 *
 * ── Et ce qui change : le CONFLIT ─────────────────────────────────────────
 *
 * Deux événements additifs commutent ; deux écritures sur la même ligne, non.
 * La création ne pose pas de problème — deux caisses hors ligne créent deux
 * articles DISTINCTS (identifiants différents), au pire deux fois le même nom,
 * que le back-office fusionnera. C'est un désagrément, pas une perte.
 *
 * C'est la MODIFICATION qui trancherait, et c'est pour cela qu'elle n'est pas
 * ici : elle exigera le dernier-écrivain-gagne arbitré par
 * `(server_seq, device_id)`, comme le numéro de table. On ne l'ajoutera pas
 * « en passant ».
 */

import type { Millimes } from './monnaie.js'
import type { Uuid } from './types.js'

/** Le seul type de mutation aujourd'hui. L'union est là pour les suivants. */
export type TypeMutationCatalogue = 'catalogue.produit.cree'

export interface MutationCatalogue {
  /** Clé d'IDEMPOTENCE. UUIDv7 généré par l'appareil, jamais réutilisé. */
  readonly mutationId: Uuid
  readonly type: TypeMutationCatalogue
  readonly organizationId: Uuid
  readonly restaurantId: Uuid
  readonly deviceId: Uuid
  /**
   * QUI demande.
   *
   * L'appareil le déclare, le serveur ne le croit pas : il relit le rôle en
   * base avant d'appliquer. Un PIN trace, il ne protège pas — la garde est
   * côté serveur, ou elle n'existe pas.
   */
  readonly parEmployeId: Uuid
  readonly produitId: Uuid
  readonly nom: string
  readonly categorieId: Uuid | null
  readonly tauxTvaId: Uuid
  readonly prixBaseMillimes: Millimes
  readonly clientTs: string
  readonly protocolVersion: number
}

/** Longueur retenue côté Postgres : `check (length(btrim(name)) between 1 and 200)`. */
export const NOM_PRODUIT_MAX = 200

/** Les rôles autorisés à toucher au catalogue. Relu EN BASE par le serveur. */
export const ROLES_CATALOGUE = ['admin', 'gerant'] as const
export type RoleCatalogue = (typeof ROLES_CATALOGUE)[number]

export function peutModifierCatalogue(role: string): boolean {
  return (ROLES_CATALOGUE as readonly string[]).includes(role)
}

export interface ResultatValidation {
  readonly valide: boolean
  readonly motif?: string
}

/**
 * Valide une mutation — LE MÊME code des deux côtés.
 *
 * C'est une règle, donc elle vit ici et nulle part ailleurs. Dupliquée, elle
 * divergerait : la caisse accepterait un nom de 250 caractères que Postgres
 * refuserait, et la vente partirait dans un rejet que personne ne comprend.
 *
 * Elle ne dit RIEN des droits : un employé peut être valide et sans le rôle.
 * Les deux questions se posent séparément — sinon on finit par croire qu'un
 * formulaire correct est un formulaire autorisé.
 */
export function validerMutationCatalogue(m: MutationCatalogue): ResultatValidation {
  const nom = m.nom.trim()
  if (nom.length === 0) return { valide: false, motif: 'Le nom de l’article est vide.' }
  if (nom.length > NOM_PRODUIT_MAX) {
    return { valide: false, motif: `Le nom dépasse ${NOM_PRODUIT_MAX} caractères.` }
  }
  if (!Number.isInteger(m.prixBaseMillimes)) {
    // Un prix en dinars décimaux (14.5) au lieu de millimes entiers (14500)
    // passerait ici sans bruit et vendrait la pizza à 14 millimes.
    return { valide: false, motif: 'Le prix doit être un entier de millimes.' }
  }
  if (m.prixBaseMillimes < 0) return { valide: false, motif: 'Le prix ne peut pas être négatif.' }
  if (!m.tauxTvaId) return { valide: false, motif: 'Aucun taux de TVA n’est associé.' }
  return { valide: true }
}
