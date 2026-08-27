/**
 * Service de synchronisation — la logique, sans transport ni SQL.
 *
 * Le serveur REVALIDE tout ce que l'appareil envoie. Un terminal compromis
 * ne doit rien pouvoir forcer : l'interface du POS masque ce qui est
 * interdit, ce service le refuse.
 *
 * Ce qu'il fait, dans l'ordre :
 *   1. vérifie la version de protocole (N−2 accepté) ;
 *   2. valide chaque événement — appartenance, forme, transition d'état ;
 *   3. insère le reste EN UNE TRANSACTION, idempotente ;
 *   4. reprojette les commandes touchées avec `@kaissi/domain` ;
 *   5. consigne les rejets pour que le gérant les voie.
 */

import { estUuid, estFigee, transitionAutorisee, type EvenementCommande } from '@kaissi/domain'
import type { AppareilAuthentifie, DepotSync } from './depot.js'
import {
  ErreurSync,
  protocoleSupporte,
  TAILLE_LOT_MAX,
  TAILLE_PAGE_DEFAUT,
  TAILLE_PAGE_MAX,
  VERSION_PROTOCOLE,
  type CodeRejet,
  type RejetEvenement,
  type RequetePull,
  type RequetePush,
  type ReponsePull,
  type ReponsePush,
} from './protocole.js'

const TYPES_CONNUS = new Set([
  'order.opened', 'line.added', 'line.quantity_changed', 'line.voided',
  'line.note_set', 'discount.applied', 'discount.removed', 'service.set',
  'customer.attached', 'table.moved', 'order.sent', 'payment.recorded',
  'payment.voided', 'order.closed', 'order.cancelled',
])

interface Refus {
  readonly code: CodeRejet
  readonly message: string
}

/**
 * Validation de forme d'un événement.
 * Volontairement sévère : un événement mal formé qui passe ici corrompt une
 * projection, et une projection corrompue est un écart de caisse.
 */
function validerForme(
  e: EvenementCommande,
  appareil: AppareilAuthentifie,
): Refus | null {
  if (!estUuid(e.eventId) || !estUuid(e.orderId)) {
    return { code: 'charge_invalide', message: "Identifiant d'événement ou de commande invalide." }
  }
  if (e.deviceId !== appareil.deviceId) {
    // Un appareil ne signe que ses propres événements. Sans ce contrôle, un
    // terminal volé pourrait fabriquer des ventes au nom d'un autre.
    return {
      code: 'appareil_etranger',
      message: "L'événement prétend venir d'un autre appareil que celui qui l'envoie.",
    }
  }
  if (e.restaurantId !== appareil.restaurantId || e.organizationId !== appareil.organizationId) {
    return {
      code: 'appareil_etranger',
      message: "L'événement vise un établissement auquel cet appareil n'appartient pas.",
    }
  }
  if (!TYPES_CONNUS.has(e.type)) {
    return {
      code: 'type_inconnu',
      message: `Type d'événement « ${e.type} » inconnu de ce serveur.`,
    }
  }
  if (!Number.isSafeInteger(e.seqDevice) || e.seqDevice <= 0) {
    return { code: 'charge_invalide', message: 'Compteur local invalide.' }
  }
  if (typeof e.clientTs !== 'string' || Number.isNaN(Date.parse(e.clientTs))) {
    return { code: 'charge_invalide', message: 'Horodatage client illisible.' }
  }
  return null
}

/**
 * Validation métier : la commande accepte-t-elle encore cet événement ?
 *
 * Le statut connu du serveur fait foi. Un appareil hors ligne depuis deux
 * heures peut envoyer un ajout sur une commande qu'un autre terminal a déjà
 * encaissée : c'est un rejet, pas une erreur, et le gérant doit le voir.
 */
function validerTransition(
  e: EvenementCommande,
  statuts: Map<string, string>,
  statutsDuLot: Map<string, string>,
): Refus | null {
  const statut = statutsDuLot.get(e.orderId) ?? statuts.get(e.orderId)
  // Commande inconnue du serveur : c'est une ouverture, ou le premier
  // événement d'une commande créée hors ligne. Rien à valider.
  if (!statut) return null

  const verdict = transitionAutorisee(statut as never, e.type)
  if (verdict.autorisee) return null

  return {
    code: statut === 'annulee' ? 'commande_annulee' : 'commande_close',
    message: verdict.motif,
  }
}

/** Suit l'évolution du statut À L'INTÉRIEUR du lot, événement par événement. */
function appliquerAuStatut(e: EvenementCommande, statutsDuLot: Map<string, string>): void {
  switch (e.type) {
    case 'order.opened':
      if (!statutsDuLot.has(e.orderId)) statutsDuLot.set(e.orderId, 'ouverte')
      break
    case 'order.sent':
      if (!estFigee((statutsDuLot.get(e.orderId) ?? 'ouverte') as never)) {
        statutsDuLot.set(e.orderId, 'envoyee')
      }
      break
    case 'order.closed':
      statutsDuLot.set(e.orderId, 'close')
      break
    case 'order.cancelled':
      statutsDuLot.set(e.orderId, 'annulee')
      break
    default:
      break
  }
}

export class ServiceSync {
  // Champ explicite plutôt qu'une « parameter property » : le mode
  // strip-only de Node (celui qui exécute ce service en production) ne
  // transforme pas « constructor(private …) » en affectation. L'écrire à la
  // main garde le runtime dans son mode le plus stable, sans flag de
  // transformation expérimentale.
  private readonly depot: DepotSync

  constructor(depot: DepotSync) {
    this.depot = depot
  }

  async push(appareil: AppareilAuthentifie, requete: RequetePush): Promise<ReponsePush> {
    if (!protocoleSupporte(requete.protocolVersion)) {
      throw new ErreurSync(
        'protocole_non_supporte',
        `Protocole v${requete.protocolVersion} non supporté. Mettez à jour l'application.`,
        426,
      )
    }
    if (!Array.isArray(requete.evenements)) {
      throw new ErreurSync('requete_invalide', 'Lot d’événements absent.', 400)
    }
    if (requete.evenements.length > TAILLE_LOT_MAX) {
      throw new ErreurSync(
        'requete_invalide',
        `Lot de ${requete.evenements.length} événements : la limite est ${TAILLE_LOT_MAX}.`,
        413,
      )
    }

    // Un lot vide est légitime : l'appareil bat le cœur pour signaler qu'il
    // est vivant. On répond le curseur courant, sans rien écrire.
    if (requete.evenements.length === 0) {
      const tete = await this.depot.curseursDeTete(appareil.restaurantId)
      return {
        acceptes: [],
        doublons: [],
        rejetes: [],
        curseurEvenements: tete.evenements,
        protocolVersion: VERSION_PROTOCOLE,
      }
    }

    // Ordre canonique du lot : les événements d'un même appareil sont
    // appliqués dans l'ordre où il les a produits.
    const lot = [...requete.evenements].sort((a, b) => a.seqDevice - b.seqDevice)

    const orderIds = [...new Set(lot.map((e) => e.orderId))]

    /*
     * IDEMPOTENCE D'ABORD (RÈGLE 5).
     *
     * Un événement que le serveur connaît déjà est un doublon de
     * retentative — pas une opération tardive. Le repasser par la
     * validation métier le ferait rejeter dès que la commande a changé
     * d'état entre le premier envoi et la réémission : une caisse dont le
     * réseau coupe pile après un `order.closed` ne viderait alors JAMAIS
     * son outbox, et le gérant verrait des rejets fantômes à chaque cycle.
     */
    const [connus, statuts] = await Promise.all([
      this.depot.evenementsConnus(
        appareil.restaurantId,
        lot.map((e) => e.eventId),
      ),
      this.depot.statutsDesCommandes(appareil.restaurantId, orderIds),
    ])

    const statutsDuLot = new Map<string, string>()
    const dejaConnus: string[] = []
    const recevables: EvenementCommande[] = []
    const rejetes: RejetEvenement[] = []

    for (const e of lot) {
      if (connus.has(e.eventId)) {
        dejaConnus.push(e.eventId)
        // Le doublon fait tout de même avancer l'état du lot : les
        // événements suivants doivent être validés contre la réalité.
        appliquerAuStatut(e, statutsDuLot)
        continue
      }
      const refusForme = validerForme(e, appareil)
      if (refusForme) {
        rejetes.push({ eventId: e.eventId, ...refusForme })
        continue
      }
      const refusMetier = validerTransition(e, statuts, statutsDuLot)
      if (refusMetier) {
        rejetes.push({ eventId: e.eventId, ...refusMetier })
        continue
      }
      appliquerAuStatut(e, statutsDuLot)
      recevables.push(e)
    }

    const resultat =
      recevables.length > 0
        ? await this.depot.insererEvenements(appareil, recevables, requete.batchId)
        : {
            inseres: [],
            doublons: [],
            curseur: (await this.depot.curseursDeTete(appareil.restaurantId)).evenements,
          }

    if (rejetes.length > 0) {
      await this.depot.consignerRejets(appareil, requete.batchId, rejetes)
    }

    // La projection ne se recalcule que pour les commandes réellement
    // touchées : reprojeter la journée entière à chaque push écroulerait le
    // serveur en heure de pointe.
    const touchees = [...new Set(recevables.map((e) => e.orderId))]
    if (touchees.length > 0) {
      await this.depot.reprojeter(appareil.restaurantId, touchees)
    }

    await this.depot.majCurseurs(appareil, { evenements: resultat.curseur }, 'push')

    const doublons = [...dejaConnus, ...resultat.doublons]
    return {
      // Un doublon est ACCEPTÉ du point de vue de l'appareil : il peut vider
      // son outbox. C'est exactement ce que l'idempotence achète.
      acceptes: [...resultat.inseres, ...doublons],
      doublons,
      rejetes,
      curseurEvenements: resultat.curseur,
      protocolVersion: VERSION_PROTOCOLE,
    }
  }

  async pull(appareil: AppareilAuthentifie, requete: RequetePull): Promise<ReponsePull> {
    if (!protocoleSupporte(requete.protocolVersion)) {
      throw new ErreurSync(
        'protocole_non_supporte',
        `Protocole v${requete.protocolVersion} non supporté. Mettez à jour l'application.`,
        426,
      )
    }

    const taille = Math.min(
      Math.max(requete.taillePage ?? TAILLE_PAGE_DEFAUT, 1),
      TAILLE_PAGE_MAX,
    )
    const depuisCatalogue = Math.max(requete.depuisCatalogue ?? 0, 0)
    const depuisEvenements = Math.max(requete.depuisEvenements ?? 0, 0)

    const [catalogue, evenements, tete] = await Promise.all([
      this.depot.catalogueDepuis(appareil.restaurantId, depuisCatalogue, taille),
      this.depot.evenementsDepuis(appareil.restaurantId, depuisEvenements, taille),
      this.depot.curseursDeTete(appareil.restaurantId),
    ])

    const curseurCatalogue =
      catalogue.length > 0 ? catalogue[catalogue.length - 1]!.seq : depuisCatalogue
    const curseurEvenements =
      evenements.length > 0
        ? evenements[evenements.length - 1]!.serverSeq ?? depuisEvenements
        : depuisEvenements

    // `encore` compare aux curseurs de TÊTE : c'est ce qui dit à l'appareil
    // de rappeler tout de suite au lieu d'attendre le prochain cycle.
    const encore = curseurCatalogue < tete.catalogue || curseurEvenements < tete.evenements

    await this.depot.majCurseurs(
      appareil,
      { catalogue: curseurCatalogue, evenements: curseurEvenements },
      'pull',
    )

    return {
      catalogue,
      evenements,
      curseurCatalogue,
      curseurEvenements,
      encore,
      protocolVersion: VERSION_PROTOCOLE,
    }
  }
}
