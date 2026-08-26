/**
 * Machine d'état d'une commande.
 *
 * Le journal d'événements accepte tout ce qui arrive — c'est sa nature, et
 * c'est ce qui permet à deux tablettes hors ligne de ne jamais se bloquer.
 * La machine d'état, elle, dit ce que l'INTERFACE doit proposer et ce que le
 * serveur doit refuser à la réconciliation.
 *
 * Distinction essentielle : une transition refusée ici n'efface jamais un
 * événement déjà écrit. Elle empêche d'en produire un nouveau, et si l'un
 * arrive quand même (appareil désynchronisé), il ressort dans `exceptions`.
 */

import type { TypeEvenement } from './evenements.js'
import type { StatutCommande } from './reduction.js'

/** Transitions autorisées, par statut de départ. */
const TRANSITIONS: Readonly<Record<StatutCommande, readonly TypeEvenement[]>> = {
  ouverte: [
    'line.added',
    'line.quantity_changed',
    'line.voided',
    'line.note_set',
    'discount.applied',
    'discount.removed',
    'service.set',
    'customer.attached',
    'table.moved',
    'order.sent',
    'payment.recorded',
    'payment.voided',
    'order.closed',
    'order.cancelled',
  ],

  // Envoyée en cuisine : on peut encore ajouter (une tournée de plus), mais
  // retirer une ligne déjà partie en cuisine devient une opération tracée.
  envoyee: [
    'line.added',
    'line.quantity_changed',
    'line.voided',
    'line.note_set',
    'discount.applied',
    'discount.removed',
    'service.set',
    'customer.attached',
    'table.moved',
    'order.sent',
    'payment.recorded',
    'payment.voided',
    'order.closed',
    'order.cancelled',
  ],

  // Close : plus rien, sauf une annulation autorisée par un manager.
  close: ['order.cancelled'],

  // Annulée : terminal. Le journal reste, l'état ne bouge plus.
  annulee: [],
}

export interface TransitionRefusee {
  readonly autorisee: false
  readonly motif: string
  /** `true` si un manager peut tout de même l'autoriser. */
  readonly escaladePossible: boolean
}

export type ResultatTransition = { readonly autorisee: true } | TransitionRefusee

const AUTORISEE: ResultatTransition = { autorisee: true }

export function transitionAutorisee(
  statut: StatutCommande,
  evenement: TypeEvenement,
): ResultatTransition {
  if (TRANSITIONS[statut].includes(evenement)) return AUTORISEE

  if (statut === 'close') {
    return {
      autorisee: false,
      escaladePossible: evenement === 'order.cancelled',
      motif:
        'La commande est clôturée. Seule une annulation autorisée par un ' +
        'responsable peut encore la modifier.',
    }
  }
  if (statut === 'annulee') {
    return {
      autorisee: false,
      escaladePossible: false,
      motif: "La commande est annulée : son historique est figé.",
    }
  }
  return {
    autorisee: false,
    escaladePossible: false,
    motif: `Opération « ${evenement} » impossible sur une commande ${statut}.`,
  }
}

/** Une commande figée n'accepte plus d'opération de caisse ordinaire. */
export function estFigee(statut: StatutCommande): boolean {
  return statut === 'close' || statut === 'annulee'
}

/** Une commande modifiable est ouverte ou envoyée en cuisine. */
export function estModifiable(statut: StatutCommande): boolean {
  return !estFigee(statut)
}

/** Libellé français du statut, pour l'interface et les rapports. */
export function libelleStatut(statut: StatutCommande): string {
  switch (statut) {
    case 'ouverte':
      return 'Ouverte'
    case 'envoyee':
      return 'En cuisine'
    case 'close':
      return 'Encaissée'
    case 'annulee':
      return 'Annulée'
  }
}

/**
 * Lignes qui n'ont pas encore été envoyées en cuisine.
 * Un KOT ne réimprime jamais ce qui est déjà parti : la cuisine préparerait
 * le plat en double.
 */
export function lignesAEnvoyer<T extends { id: string; annulee?: boolean }>(
  lignes: readonly T[],
  dejaEnvoyees: ReadonlySet<string>,
): T[] {
  return lignes.filter((l) => !l.annulee && !dejaEnvoyees.has(l.id))
}
