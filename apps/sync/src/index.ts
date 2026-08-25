/**
 * API de synchronisation Kaissi — SQUELETTE de Phase 0.
 *
 * ⚠ Aucune route n'est implémentée ici : le moteur de synchronisation est la
 *   PHASE 2. Ce fichier fige le contrat pour que le POS et le serveur soient
 *   écrits contre la même définition, et pour que le jalon de bascule vers
 *   PowerSync soit décidable sur des critères clairs.
 *
 * Pourquoi un process Node dédié et pas PostgREST ni une Edge Function :
 *   • PostgREST expose des tables ; le push a besoin de validation
 *     transactionnelle, d'idempotence et de repli d'événements ;
 *   • une Edge Function redémarre à froid et ne réutilise pas ses connexions
 *     à la base — la latence du push en pâtirait.
 *
 * Le serveur REVALIDE systématiquement ce que l'appareil envoie : un
 * terminal compromis ne doit rien pouvoir forcer. Les totaux sont recalculés
 * ici avec `@kaissi/domain`, le MÊME code que celui de la tablette.
 */

import type { EvenementCommande } from '@kaissi/domain'

/** Version du protocole. Le serveur doit supporter N−2. */
export const VERSION_PROTOCOLE = 1
export const VERSIONS_SUPPORTEES = [1] as const

// ─── POST /sync/push ────────────────────────────────────────────────────────

export interface RequetePush {
  readonly protocolVersion: number
  readonly deviceId: string
  readonly batchId: string
  /** Lot issu de la table `outbox` locale, le plus ancien d'abord. */
  readonly evenements: readonly EvenementCommande[]
}

export type CodeRejet =
  | 'commande_close'
  | 'produit_inconnu'
  | 'permission_revoquee'
  | 'appareil_revoque'
  | 'protocole_non_supporte'
  | 'charge_invalide'

export interface RejetEvenement {
  readonly eventId: string
  readonly code: CodeRejet
  /** Message destiné au GÉRANT, en français, pas une trace technique. */
  readonly message: string
}

export interface ReponsePush {
  /** Événements insérés ou déjà connus (idempotence) — l'outbox peut se vider. */
  readonly acceptes: readonly string[]
  /**
   * Événements refusés. NOTIFIÉS dans l'interface, jamais avalés en silence :
   * le gérant doit voir « 2 opérations nécessitent votre attention ».
   */
  readonly rejetes: readonly RejetEvenement[]
  /** Nouveau curseur d'événements après application du lot. */
  readonly curseurEvenements: number
}

// ─── GET /sync/pull?depuisCatalogue=&depuisEvenements= ─────────────────────

export interface RequetePull {
  readonly protocolVersion: number
  readonly deviceId: string
  /** Curseur `change_log.seq`. JAMAIS un timestamp (RÈGLE 4). */
  readonly depuisCatalogue: number
  /** Curseur `order_events.server_seq`. */
  readonly depuisEvenements: number
  /**
   * Pagination OBLIGATOIRE : un appareil resté trois semaines hors ligne
   * peut avoir 40 000 événements de retard.
   */
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
}

/**
 * Contrat que devra respecter l'implémentation de Phase 2.
 * L'écrire maintenant évite qu'appareil et serveur divergent.
 */
export interface ServiceSync {
  push(requete: RequetePush): Promise<ReponsePush>
  pull(requete: RequetePull): Promise<ReponsePull>
}

/** Un protocole non supporté est refusé explicitement, jamais deviné. */
export function protocoleSupporte(version: number): boolean {
  return (VERSIONS_SUPPORTEES as readonly number[]).includes(version)
}

if (process.env['NODE_ENV'] !== 'test') {
  console.log(
    "API de synchronisation Kaissi — squelette de Phase 0.\n" +
      "Les routes /sync/push et /sync/pull seront implémentées en Phase 2 " +
      `(protocole v${VERSION_PROTOCOLE}).`,
  )
}
