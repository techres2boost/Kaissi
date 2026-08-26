/**
 * Protocole de synchronisation — le contrat entre l'appareil et le serveur.
 *
 * Écrit d'abord, implémenté ensuite, des deux côtés : c'est ce qui empêche
 * le POS et le serveur de diverger. Les deux importent CE fichier.
 *
 * RÈGLE 4 — le curseur est un entier SERVEUR (`order_events.server_seq`,
 * `change_log.seq`), jamais un horodatage. Les horloges des tablettes
 * dérivent, sont réglées à la main et changent de fuseau ; un curseur
 * temporel perdrait des événements sans qu'on sache lesquels.
 *
 * RÈGLE 5 — l'idempotence tient à `event_id`. Le même lot renvoyé cinq fois
 * (réseau instable, retentative) n'est appliqué qu'une seule fois.
 */

import type { EvenementCommande } from '@kaissi/domain'

/** Version courante du protocole. */
export const VERSION_PROTOCOLE = 1

/**
 * Le serveur doit accepter N, N−1 et N−2.
 * Sans cela, une mise à jour du serveur casserait les appareils restés
 * hors ligne — exactement la population qu'on ne peut pas joindre.
 */
export const VERSIONS_SUPPORTEES: readonly number[] = [1]

export function protocoleSupporte(version: number): boolean {
  return VERSIONS_SUPPORTEES.includes(version)
}

/** Pagination du pull. Un appareil resté trois semaines hors ligne peut
 *  avoir des dizaines de milliers d'événements de retard. */
export const TAILLE_PAGE_DEFAUT = 500
export const TAILLE_PAGE_MAX = 2000

/** Taille maximale d'un lot poussé, pour borner la durée d'une transaction. */
export const TAILLE_LOT_MAX = 500

// ─── Identité de l'appelant ─────────────────────────────────────────────────

export interface ContexteAppareil {
  readonly deviceId: string
  readonly restaurantId: string
  readonly organizationId: string
  readonly protocolVersion: number
}

// ─── POST /sync/push ────────────────────────────────────────────────────────

export interface RequetePush {
  readonly protocolVersion: number
  readonly batchId: string
  /** Lot issu de l'outbox locale, le plus ancien d'abord. */
  readonly evenements: readonly EvenementCommande[]
}

/**
 * Codes de rejet. Chacun est une règle métier, PAS une erreur technique :
 * un rejet ne se réessaie jamais tout seul, il remonte au gérant.
 */
export type CodeRejet =
  | 'commande_close'
  | 'commande_annulee'
  | 'produit_inconnu'
  | 'appareil_etranger'
  | 'charge_invalide'
  | 'type_inconnu'
  | 'lot_trop_grand'

export interface RejetEvenement {
  readonly eventId: string
  readonly code: CodeRejet
  /** Message destiné au GÉRANT, en français. Pas une trace technique. */
  readonly message: string
}

export interface ReponsePush {
  /**
   * Événements insérés OU déjà connus. Dans les deux cas l'appareil peut
   * vider son outbox : c'est là toute la valeur de l'idempotence.
   */
  readonly acceptes: readonly string[]
  /** Événements déjà présents — comptés à part pour l'observabilité. */
  readonly doublons: readonly string[]
  readonly rejetes: readonly RejetEvenement[]
  /** Curseur d'événements après application du lot. */
  readonly curseurEvenements: number
  readonly protocolVersion: number
}

// ─── GET /sync/pull ─────────────────────────────────────────────────────────

export interface RequetePull {
  readonly protocolVersion: number
  /** Dernier `change_log.seq` connu de l'appareil. */
  readonly depuisCatalogue: number
  /** Dernier `order_events.server_seq` connu de l'appareil. */
  readonly depuisEvenements: number
  readonly taillePage?: number
}

export interface ChangementCatalogue {
  readonly seq: number
  readonly entite: string
  readonly entiteId: string
  readonly operation: 'insert' | 'update' | 'delete'
  readonly donnees: Record<string, unknown> | null
}

export interface ReponsePull {
  readonly catalogue: readonly ChangementCatalogue[]
  readonly evenements: readonly EvenementCommande[]
  readonly curseurCatalogue: number
  readonly curseurEvenements: number
  /** `true` s'il reste des pages : l'appareil doit rappeler immédiatement. */
  readonly encore: boolean
  readonly protocolVersion: number
}

// ─── Erreurs de transport ───────────────────────────────────────────────────

export type CodeErreur =
  | 'jeton_absent'
  | 'jeton_invalide'
  | 'appareil_revoque'
  | 'protocole_non_supporte'
  | 'requete_invalide'
  | 'erreur_serveur'

export interface ReponseErreur {
  readonly erreur: CodeErreur
  readonly message: string
}

export class ErreurSync extends Error {
  constructor(
    readonly code: CodeErreur,
    message: string,
    readonly statut = 400,
  ) {
    super(message)
    this.name = 'ErreurSync'
  }
}
