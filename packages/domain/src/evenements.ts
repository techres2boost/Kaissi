/**
 * Journal d'événements d'une commande — la SOURCE DE VÉRITÉ.
 *
 * Une commande n'est pas une ligne qu'on modifie : c'est une suite
 * d'événements immuables. Les événements additifs commutent, donc deux
 * tablettes hors ligne qui ajoutent chacune un article à la table 12
 * produisent une commande à trois articles, sans le moindre conflit.
 *
 * `order_events` est APPEND-ONLY côté Postgres comme côté SQLite :
 * jamais d'UPDATE, jamais de DELETE. Une annulation est un événement de plus.
 */

import type { Millimes } from './monnaie.js'
import type { Remise, Uuid } from './types.js'

/** Version du protocole de sérialisation des événements. */
export const VERSION_PROTOCOLE = 1

export type TypeEvenement =
  | 'order.opened'
  | 'line.added'
  | 'line.quantity_changed'
  | 'line.voided'
  | 'line.note_set'
  | 'discount.applied'
  | 'discount.removed'
  | 'service.set'
  | 'customer.attached'
  | 'table.moved'
  | 'order.sent'
  | 'payment.recorded'
  | 'payment.voided'
  | 'order.closed'
  | 'order.cancelled'

export type TypeCommande = 'dine_in' | 'takeaway' | 'delivery'
export type ModePaiement = 'cash' | 'card' | 'online' | 'other'

/** Charges utiles typées, une par type d'événement. */
export interface ChargesUtiles {
  'order.opened': {
    type: TypeCommande
    tableId?: Uuid | null
    ouvertePar: Uuid
    numeroTicket?: string
    couverts?: number
  }
  'line.added': {
    ligneId: Uuid
    produitId: Uuid
    variantId?: Uuid | null
    designation: string
    quantite: number
    prixBaseMillimes: Millimes
    modificateursMillimes: Millimes
    modificateurs?: { id: Uuid; nom: string; prixDeltaMillimes: Millimes }[]
    tauxTaxeId: Uuid
    stationId?: Uuid | null
    note?: string
  }
  'line.quantity_changed': { ligneId: Uuid; quantite: number; motif?: string }
  'line.voided': { ligneId: Uuid; motif?: string; autorisePar?: Uuid }
  'line.note_set': { ligneId: Uuid; note: string }
  'discount.applied': {
    /** Absent → remise globale. Présent → remise de ligne. */
    ligneId?: Uuid | null
    remise: Remise
    autorisePar?: Uuid
  }
  'discount.removed': { ligneId?: Uuid | null }
  'service.set': { tauxBp: number; taxable: boolean; tauxTaxeId?: Uuid | null }
  'customer.attached': { clientId: Uuid; nom?: string; telephone?: string }
  'table.moved': { tableId: Uuid | null; motif?: string }
  'order.sent': { stationIds?: Uuid[] }
  'payment.recorded': {
    paiementId: Uuid
    methodeId: Uuid
    mode: ModePaiement
    montantMillimes: Millimes
    recuMillimes?: Millimes
    renduMillimes?: Millimes
    reference?: string
  }
  'payment.voided': { paiementId: Uuid; motif?: string; autorisePar?: Uuid }
  'order.closed': { totalMillimes: Millimes; closePar: Uuid }
  'order.cancelled': { motif: string; autorisePar: Uuid }
}

/** Enveloppe commune à tous les événements. */
export interface EvenementCommande<T extends TypeEvenement = TypeEvenement> {
  /** UUIDv7 généré par l'APPAREIL — c'est la clé d'idempotence. */
  readonly eventId: Uuid
  readonly orderId: Uuid
  readonly restaurantId: Uuid
  readonly organizationId: Uuid
  readonly deviceId: Uuid
  /** Compteur local monotone : ordre intra-appareil, jamais réutilisé. */
  readonly seqDevice: number
  /** Horloge de l'appareil — informative, JAMAIS un curseur de synchronisation. */
  readonly clientTs: string
  /**
   * Attribué par le serveur à l'arrivée : c'est LE seul ordre global fiable.
   * `null` tant que l'événement n'a pas été poussé.
   */
  readonly serverSeq: number | null
  readonly type: T
  readonly payload: ChargesUtiles[T]
  /** Employé qui a réalisé l'action (PIN local), distinct de l'appareil. */
  readonly acteurId?: Uuid | null
}

/**
 * Ordre canonique d'application des événements.
 *
 * 1. Les événements confirmés par le serveur passent d'abord, triés par
 *    `serverSeq` — l'ordre global fiable.
 * 2. Les événements encore locaux passent ensuite, triés par
 *    (clientTs, deviceId, seqDevice) — déterministe et stable.
 *
 * Le tri n'est PAS chronologique par horloge d'appareil : les horloges des
 * tablettes dérivent, sont réglées à la main et changent de fuseau.
 */
export function ordonnerEvenements(
  evenements: readonly EvenementCommande[],
): EvenementCommande[] {
  return [...evenements].sort(comparerEvenements)
}

export function comparerEvenements(a: EvenementCommande, b: EvenementCommande): number {
  const aSync = a.serverSeq !== null
  const bSync = b.serverSeq !== null
  if (aSync && bSync) return a.serverSeq! - b.serverSeq!
  if (aSync !== bSync) return aSync ? -1 : 1
  if (a.clientTs !== b.clientTs) return a.clientTs < b.clientTs ? -1 : 1
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  if (a.seqDevice !== b.seqDevice) return a.seqDevice - b.seqDevice
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0
}

/** Déduplique par `eventId` — l'idempotence côté client. */
export function dedupliquer(
  evenements: readonly EvenementCommande[],
): EvenementCommande[] {
  const vus = new Set<Uuid>()
  const resultat: EvenementCommande[] = []
  for (const e of evenements) {
    if (vus.has(e.eventId)) continue
    vus.add(e.eventId)
    resultat.push(e)
  }
  return resultat
}

/** Constructeur d'événement — factorise l'enveloppe côté POS. */
export interface ContexteEvenement {
  orderId: Uuid
  restaurantId: Uuid
  organizationId: Uuid
  deviceId: Uuid
  acteurId?: Uuid | null
}

export function creerEvenement<T extends TypeEvenement>(
  contexte: ContexteEvenement,
  type: T,
  payload: ChargesUtiles[T],
  options: { eventId: Uuid; seqDevice: number; clientTs?: string },
): EvenementCommande<T> {
  return {
    eventId: options.eventId,
    orderId: contexte.orderId,
    restaurantId: contexte.restaurantId,
    organizationId: contexte.organizationId,
    deviceId: contexte.deviceId,
    seqDevice: options.seqDevice,
    clientTs: options.clientTs ?? new Date().toISOString(),
    serverSeq: null,
    type,
    payload,
    acteurId: contexte.acteurId ?? null,
  }
}
