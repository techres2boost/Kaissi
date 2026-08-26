/**
 * Réduction des événements vers l'état d'une commande.
 *
 * Le POS et le serveur exécutent EXACTEMENT ce code : l'état affiché sur la
 * tablette et la projection `orders` / `order_items` en base proviennent de
 * la même fonction. C'est ce qui garantit qu'il n'y a pas deux vérités.
 *
 * Principes :
 *  - Les événements ADDITIFS (ajout de ligne, paiement) sont accumulés :
 *    ils commutent, l'ordre d'arrivée ne change pas le résultat.
 *  - Les champs SCALAIRES réellement conflictuels (table, client, service)
 *    sont arbitrés en dernier-écrivain-gagne selon l'ordre canonique
 *    (serverSeq, deviceId) — l'ancienne valeur reste visible dans le journal.
 *  - Une annulation n'efface JAMAIS rien : elle neutralise et laisse une trace.
 *  - Une double clôture hors ligne retient la PREMIÈRE par serverSeq et
 *    signale la seconde dans `exceptions` — jamais de suppression silencieuse.
 */

import { ZERO, millimes, sommer, type Millimes } from './monnaie.js'
import {
  comparerEvenements,
  dedupliquer,
  ordonnerEvenements,
  type EvenementCommande,
  type ModePaiement,
  type TypeCommande,
} from './evenements.js'
import type { LigneCalculable, Remise, Uuid } from './types.js'

export type StatutCommande = 'ouverte' | 'envoyee' | 'close' | 'annulee'

export interface LigneEtat extends LigneCalculable {
  readonly produitId: Uuid
  readonly variantId: Uuid | null
  readonly designation: string
  readonly modificateurs: { id: Uuid; nom: string; prixDeltaMillimes: Millimes }[]
  readonly stationId: Uuid | null
  readonly note: string | null
  readonly annulee: boolean
  readonly annuleeMotif: string | null
  readonly annuleePar: Uuid | null
  /** Ajoutée par quel appareil — utile pour le partage de table. */
  readonly deviceId: Uuid
  readonly ajouteePar: Uuid | null
  readonly ajouteeA: string
}

export interface PaiementEtat {
  readonly id: Uuid
  readonly methodeId: Uuid
  readonly mode: ModePaiement
  readonly montantMillimes: Millimes
  readonly recuMillimes: Millimes | null
  readonly renduMillimes: Millimes | null
  readonly reference: string | null
  readonly annule: boolean
  readonly enregistrePar: Uuid | null
  readonly enregistreA: string
}

/** Type d'anomalie détectée pendant la réduction, à remonter au gérant. */
export type TypeException =
  | 'double_cloture'
  | 'evenement_apres_cloture'
  | 'ligne_inconnue'
  | 'paiement_inconnu'
  | 'evenement_sans_ouverture'
  | 'type_inconnu'

export interface ExceptionReduction {
  readonly type: TypeException
  readonly eventId: Uuid
  readonly deviceId: Uuid
  readonly message: string
}

export interface EtatCommande {
  readonly id: Uuid
  readonly restaurantId: Uuid
  readonly organizationId: Uuid
  readonly statut: StatutCommande
  readonly type: TypeCommande
  readonly tableId: Uuid | null
  readonly couverts: number | null
  readonly numeroTicket: string | null
  readonly deviceProprietaireId: Uuid | null
  readonly ouvertePar: Uuid | null
  readonly ouverteA: string | null
  readonly envoyeeA: string | null
  readonly closeA: string | null
  readonly closePar: Uuid | null
  readonly annuleeA: string | null
  readonly annuleeMotif: string | null
  readonly clientId: Uuid | null
  readonly clientNom: string | null
  readonly lignes: readonly LigneEtat[]
  readonly paiements: readonly PaiementEtat[]
  readonly remiseGlobale: Remise | null
  readonly remiseGlobaleAutoriseePar: Uuid | null
  readonly service: { tauxBp: number; taxable: boolean; tauxTaxeId: Uuid | null } | null
  /** Dernier `serverSeq` observé — curseur de fraîcheur de la projection. */
  readonly derniereSeqServeur: number | null
  /** Nombre d'événements réduits, tous types confondus. */
  readonly nombreEvenements: number
  readonly exceptions: readonly ExceptionReduction[]
}

/**
 * État de départ, avant application des événements.
 *
 * La tenance vient du PREMIER événement du journal, pas de `order.opened` :
 * quand deux tablettes travaillent hors ligne, l'ajout de ligne de l'une
 * peut arriver avant l'ouverture de l'autre. Laisser `organization_id` vide
 * dans cet intervalle rendrait la commande improjetable — et une commande
 * improjetable est une vente invisible.
 */
function etatInitial(premier: EvenementCommande): EtatCommande {
  return {
    id: premier.orderId,
    restaurantId: premier.restaurantId,
    organizationId: premier.organizationId,
    statut: 'ouverte',
    type: 'dine_in',
    tableId: null,
    couverts: null,
    numeroTicket: null,
    deviceProprietaireId: null,
    ouvertePar: null,
    ouverteA: null,
    envoyeeA: null,
    closeA: null,
    closePar: null,
    annuleeA: null,
    annuleeMotif: null,
    clientId: null,
    clientNom: null,
    lignes: [],
    paiements: [],
    remiseGlobale: null,
    remiseGlobaleAutoriseePar: null,
    service: null,
    derniereSeqServeur: null,
    nombreEvenements: 0,
    exceptions: [],
  }
}

/**
 * Réduit un journal d'événements vers l'état courant d'une commande.
 * Fonction PURE et idempotente : rejouer deux fois le même journal
 * (doublons de retentative réseau compris) donne le même état.
 */
export function reduireEvenements(
  evenements: readonly EvenementCommande[],
): EtatCommande {
  if (evenements.length === 0) {
    throw new Error('Journal vide : impossible de reconstruire une commande.')
  }
  const ordonnes = ordonnerEvenements(dedupliquer(evenements))
  const premier = ordonnes[0]!
  const orderId = premier.orderId

  let etat = etatInitial(premier)
  const lignes = new Map<Uuid, LigneEtat>()
  const ordreLignes: Uuid[] = []
  const paiements = new Map<Uuid, PaiementEtat>()
  const ordrePaiements: Uuid[] = []
  const exceptions: ExceptionReduction[] = []
  let evenementCloture: EvenementCommande | null = null
  let ouvertureVue = false
  let orphelinSignale = false

  const signaler = (
    type: TypeException,
    e: EvenementCommande,
    message: string,
  ): void => {
    exceptions.push({ type, eventId: e.eventId, deviceId: e.deviceId, message })
  }

  for (const e of ordonnes) {
    if (e.orderId !== orderId) {
      throw new Error(
        `Journal hétérogène : l'événement ${e.eventId} appartient à la commande ${e.orderId}.`,
      )
    }
    if (e.serverSeq !== null) {
      etat = { ...etat, derniereSeqServeur: e.serverSeq }
    }

    // Après clôture ou annulation, seuls les événements administratifs
    // (annulation avec autorisation) restent recevables. Le reste est signalé.
    const figee = etat.statut === 'close' || etat.statut === 'annulee'
    if (figee && e.type !== 'order.cancelled' && e.type !== 'order.closed') {
      signaler(
        'evenement_apres_cloture',
        e,
        `Événement « ${e.type} » reçu après clôture de la commande — ignoré, à revoir.`,
      )
      continue
    }

    switch (e.type) {
      case 'order.opened': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['order.opened']
        if (ouvertureVue) {
          // Deux appareils ont ouvert la même commande : additif, on garde la
          // première ouverture (ordre canonique) et on ne signale rien —
          // ce cas est bénin, l'identifiant de commande est déjà unique.
          break
        }
        ouvertureVue = true
        etat = {
          ...etat,
          restaurantId: e.restaurantId,
          organizationId: e.organizationId,
          type: p.type,
          tableId: p.tableId ?? null,
          couverts: p.couverts ?? null,
          numeroTicket: p.numeroTicket ?? null,
          deviceProprietaireId: e.deviceId,
          ouvertePar: p.ouvertePar,
          ouverteA: e.clientTs,
          statut: 'ouverte',
        }
        break
      }

      case 'line.added': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['line.added']
        if (lignes.has(p.ligneId)) break // idempotent
        lignes.set(p.ligneId, {
          id: p.ligneId,
          produitId: p.produitId,
          variantId: p.variantId ?? null,
          designation: p.designation,
          quantite: p.quantite,
          prixBaseMillimes: p.prixBaseMillimes,
          modificateursMillimes: p.modificateursMillimes,
          modificateurs: p.modificateurs ?? [],
          tauxTaxeId: p.tauxTaxeId,
          stationId: p.stationId ?? null,
          note: p.note ?? null,
          annulee: false,
          annuleeMotif: null,
          annuleePar: null,
          deviceId: e.deviceId,
          ajouteePar: e.acteurId ?? null,
          ajouteeA: e.clientTs,
        })
        ordreLignes.push(p.ligneId)
        break
      }

      case 'line.quantity_changed': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['line.quantity_changed']
        const ligne = lignes.get(p.ligneId)
        if (!ligne) {
          signaler('ligne_inconnue', e, `Quantité modifiée sur une ligne absente : ${p.ligneId}`)
          break
        }
        lignes.set(p.ligneId, { ...ligne, quantite: p.quantite })
        break
      }

      case 'line.voided': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['line.voided']
        const ligne = lignes.get(p.ligneId)
        if (!ligne) {
          signaler('ligne_inconnue', e, `Annulation d'une ligne absente : ${p.ligneId}`)
          break
        }
        // L'annulation neutralise, elle n'efface pas : la ligne reste visible.
        lignes.set(p.ligneId, {
          ...ligne,
          annulee: true,
          annuleeMotif: p.motif ?? null,
          annuleePar: p.autorisePar ?? e.acteurId ?? null,
        })
        break
      }

      case 'line.note_set': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['line.note_set']
        const ligne = lignes.get(p.ligneId)
        if (!ligne) {
          signaler('ligne_inconnue', e, `Note posée sur une ligne absente : ${p.ligneId}`)
          break
        }
        lignes.set(p.ligneId, { ...ligne, note: p.note })
        break
      }

      case 'discount.applied': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['discount.applied']
        if (p.ligneId) {
          const ligne = lignes.get(p.ligneId)
          if (!ligne) {
            signaler('ligne_inconnue', e, `Remise sur une ligne absente : ${p.ligneId}`)
            break
          }
          lignes.set(p.ligneId, { ...ligne, remise: p.remise })
        } else {
          // Champ scalaire : dernier-écrivain-gagne dans l'ordre canonique.
          etat = {
            ...etat,
            remiseGlobale: p.remise,
            remiseGlobaleAutoriseePar: p.autorisePar ?? e.acteurId ?? null,
          }
        }
        break
      }

      case 'discount.removed': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['discount.removed']
        if (p.ligneId) {
          const ligne = lignes.get(p.ligneId)
          if (!ligne) {
            signaler('ligne_inconnue', e, `Retrait de remise sur une ligne absente : ${p.ligneId}`)
            break
          }
          const { remise: _ignoree, ...sansRemise } = ligne
          lignes.set(p.ligneId, sansRemise as LigneEtat)
        } else {
          etat = { ...etat, remiseGlobale: null, remiseGlobaleAutoriseePar: null }
        }
        break
      }

      case 'service.set': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['service.set']
        etat = {
          ...etat,
          service: {
            tauxBp: p.tauxBp,
            taxable: p.taxable,
            tauxTaxeId: p.tauxTaxeId ?? null,
          },
        }
        break
      }

      case 'customer.attached': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['customer.attached']
        etat = { ...etat, clientId: p.clientId, clientNom: p.nom ?? null }
        break
      }

      case 'table.moved': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['table.moved']
        etat = { ...etat, tableId: p.tableId }
        break
      }

      case 'order.sent': {
        etat = {
          ...etat,
          statut: etat.statut === 'ouverte' ? 'envoyee' : etat.statut,
          envoyeeA: etat.envoyeeA ?? e.clientTs,
        }
        break
      }

      case 'payment.recorded': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['payment.recorded']
        if (paiements.has(p.paiementId)) break // idempotent
        paiements.set(p.paiementId, {
          id: p.paiementId,
          methodeId: p.methodeId,
          mode: p.mode,
          montantMillimes: p.montantMillimes,
          recuMillimes: p.recuMillimes ?? null,
          renduMillimes: p.renduMillimes ?? null,
          reference: p.reference ?? null,
          annule: false,
          enregistrePar: e.acteurId ?? null,
          enregistreA: e.clientTs,
        })
        ordrePaiements.push(p.paiementId)
        break
      }

      case 'payment.voided': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['payment.voided']
        const paiement = paiements.get(p.paiementId)
        if (!paiement) {
          signaler('paiement_inconnu', e, `Annulation d'un paiement absent : ${p.paiementId}`)
          break
        }
        paiements.set(p.paiementId, { ...paiement, annule: true })
        break
      }

      case 'order.closed': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['order.closed']
        if (evenementCloture) {
          // DOUBLE CLÔTURE : deux appareils ont clôturé la même commande hors
          // ligne. La première (ordre canonique) fait foi ; la seconde est
          // consignée en écart à revoir, jamais supprimée en silence.
          if (e.eventId !== evenementCloture.eventId) {
            signaler(
              'double_cloture',
              e,
              `Commande déjà clôturée par l'appareil ${evenementCloture.deviceId} ` +
                `(événement ${evenementCloture.eventId}). Clôture concurrente à arbitrer.`,
            )
          }
          break
        }
        evenementCloture = e
        etat = {
          ...etat,
          statut: 'close',
          closeA: e.clientTs,
          closePar: p.closePar,
        }
        break
      }

      case 'order.cancelled': {
        const p = e.payload as import('./evenements.js').ChargesUtiles['order.cancelled']
        etat = {
          ...etat,
          statut: 'annulee',
          annuleeA: e.clientTs,
          annuleeMotif: p.motif,
        }
        break
      }

      default: {
        // Protocole versionné : un appareil à jour peut recevoir un type
        // inconnu d'un appareil plus récent. On l'ignore SANS planter,
        // mais on le signale — la commande est potentiellement incomplète.
        signaler(
          'type_inconnu',
          e,
          `Type d'événement inconnu « ${(e as EvenementCommande).type} ». ` +
            `Mise à jour de l'application requise.`,
        )
      }
    }

    // Un journal qui commence par autre chose qu'une ouverture est possible
    // (pull partiel, pagination) : on le signale UNE seule fois sans bloquer.
    if (!ouvertureVue && !orphelinSignale && e.type !== 'order.opened') {
      orphelinSignale = true
      signaler(
        'evenement_sans_ouverture',
        e,
        `Événement « ${e.type} » reçu avant l'ouverture de la commande.`,
      )
    }
  }

  return {
    ...etat,
    lignes: ordreLignes.map((id) => lignes.get(id)!),
    paiements: ordrePaiements.map((id) => paiements.get(id)!),
    nombreEvenements: ordonnes.length,
    exceptions,
  }
}

/** Somme des paiements non annulés — l'entrée de `calculerRendu`. */
export function totalVerse(etat: EtatCommande): Millimes {
  return sommer(
    etat.paiements.filter((p) => !p.annule).map((p) => p.montantMillimes),
  )
}

/** Nombre d'articles actifs (somme des quantités des lignes non annulées). */
export function nombreArticles(etat: EtatCommande): number {
  return etat.lignes
    .filter((l) => !l.annulee)
    .reduce((total, l) => total + l.quantite, 0)
}

/**
 * Applique un nouvel événement à un état déjà réduit, sans rejouer tout le
 * journal. Utilisé par le POS pour la mise à jour optimiste de l'interface.
 * ⚠ Ne fonctionne que pour un événement postérieur à tous ceux déjà réduits ;
 * sinon, rejouer le journal complet avec `reduireEvenements`.
 */
export function appliquerEvenement(
  journal: readonly EvenementCommande[],
  nouveau: EvenementCommande,
): { journal: EvenementCommande[]; etat: EtatCommande } {
  const complet = [...journal, nouveau].sort(comparerEvenements)
  return { journal: complet, etat: reduireEvenements(complet) }
}

/** Vérifie qu'un montant est bien un entier de millimes (garde-fou de sérialisation). */
export function normaliserMontant(valeur: unknown): Millimes {
  if (typeof valeur !== 'number') {
    throw new Error(`Montant non numérique dans un événement : ${String(valeur)}`)
  }
  return millimes(valeur)
}

export { ZERO }
