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
import type { EtatCommande, StatutCommande } from './reduction.js'

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

  // Close : plus rien, sauf une annulation autorisée par un manager — et le
  // remboursement, qui ne modifie pas la vente : il s'y ajoute.
  close: ['order.cancelled', 'refund.recorded'],

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

/**
 * Une commande VIDE : ouverte, mais rien n'y a jamais été saisi ni payé.
 *
 * C'est la seule qu'on puisse libérer sans l'accord d'un gérant (table
 * ouverte par erreur) : il n'y a ni plat préparé, ni argent à protéger.
 * Une ligne RETIRÉE compte comme saisie — un plat retiré après son envoi en
 * cuisine a pu être servi, et c'est exactement le geste qu'un gérant doit
 * voir. Un paiement ANNULÉ compte aussi : de l'argent a transité.
 */
export function estCommandeVide(
  etat: Pick<EtatCommande, 'statut' | 'lignes' | 'paiements'>,
): boolean {
  return estModifiable(etat.statut) && etat.lignes.length === 0 && etat.paiements.length === 0
}


/**
 * La ligne qu'un nouvel ajout doit COMPLÉTER plutôt que doubler.
 *
 * Toucher deux fois « Ojja merguez » doit donner « 2 × Ojja merguez », comme
 * le bouton « + » — et non deux lignes identiques que le caissier relit, que
 * la cuisine reçoit en double, et qu'il faut retirer une par une.
 *
 * On ne complète qu'une ligne en tout point IDENTIQUE, et seulement si rien
 * ne s'y oppose :
 *
 *  • même produit, même variante, même prix, même taux ;
 *  • aucune option, aucune note, aucune remise de ligne — « bien cuit » et
 *    « à point » sont deux plats, et une remise de 2 dinars ne s'étend pas
 *    en silence à une deuxième unité ;
 *  • PAS ENCORE ENVOYÉE en cuisine : `kitchen_sends` ne renvoie jamais une
 *    ligne déjà partie, la cuisine ne verrait donc jamais l'unité ajoutée ;
 *  • ajoutée par CET appareil. Le changement de quantité est un
 *    « dernier-écrivain-gagne » : deux tablettes hors ligne qui complètent la
 *    même ligne en perdraient une unité. Une ligne neuve, elle, commute —
 *    deux caisses qui ajoutent chacune un plat donnent deux plats.
 *
 * Un article à prix libre (`produitId` nul) ne se complète jamais : deux
 * « divers » à 3 dinars ne sont pas forcément la même chose.
 */
export function ligneACompleter<
  T extends {
    id: string
    produitId: string | null
    variantId: string | null
    prixBaseMillimes: number
    modificateursMillimes: number
    tauxTaxeId: string
    modificateurs: readonly unknown[]
    note: string | null
    remise?: unknown
    annulee: boolean
    deviceId: string
  },
>(
  lignes: readonly T[],
  ajout: {
    produitId: string | null
    variantId?: string | null
    prixBaseMillimes: number
    modificateursMillimes: number
    tauxTaxeId: string
    modificateurs?: readonly unknown[]
    note?: string | null
  },
  contexte: { deviceId: string; dejaEnvoyees: ReadonlySet<string> },
): T | null {
  if (ajout.produitId === null) return null
  if ((ajout.modificateurs?.length ?? 0) > 0 || (ajout.note ?? '').trim() !== '') return null
  const trouvee = lignes.find(
    (l) =>
      !l.annulee &&
      !contexte.dejaEnvoyees.has(l.id) &&
      l.deviceId === contexte.deviceId &&
      l.produitId === ajout.produitId &&
      (l.variantId ?? null) === (ajout.variantId ?? null) &&
      l.prixBaseMillimes === ajout.prixBaseMillimes &&
      l.modificateursMillimes === ajout.modificateursMillimes &&
      l.tauxTaxeId === ajout.tauxTaxeId &&
      l.modificateurs.length === 0 &&
      (l.note ?? '').trim() === '' &&
      l.remise === undefined,
  )
  return trouvee ?? null
}
