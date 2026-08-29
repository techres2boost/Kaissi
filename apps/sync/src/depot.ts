/**
 * Dépôt de synchronisation — la seule frontière d'accès aux données.
 *
 * L'interface existe pour deux raisons concrètes :
 *   • la logique du service se teste sans base ;
 *   • le jour où l'on change de fournisseur Postgres, ou si l'on bascule sur
 *     PowerSync (jalon de fin de Phase 2), c'est cette couche qu'on remplace,
 *     pas le protocole ni le POS.
 */

import type { EvenementCommande } from '@kaissi/domain'
import type { ChangementCatalogue } from './protocole.js'

export interface AppareilAuthentifie {
  readonly deviceId: string
  readonly restaurantId: string
  readonly organizationId: string
  readonly revoque: boolean
  readonly protocolVersion: number
}

export interface ResultatInsertion {
  /** Événements réellement insérés. */
  readonly inseres: readonly string[]
  /** Événements déjà présents — l'idempotence a joué. */
  readonly doublons: readonly string[]
  /** Curseur après insertion. */
  readonly curseur: number
}

export interface DepotSync {
  /**
   * Ouvre une connexion et exécute une requête triviale.
   *
   * Une API de synchronisation qui répond « ok » sans avoir jamais joint sa
   * base ne dit rien d'utile : elle promet un service qu'elle ne peut pas
   * rendre.
   */
  verifier(): Promise<void>

  /** Retrouve un appareil par l'empreinte de son jeton. */
  appareilParJeton(empreinte: string): Promise<AppareilAuthentifie | null>

  /**
   * Événements du lot que le serveur connaît déjà.
   *
   * Interrogé AVANT toute validation métier : un événement déjà accepté est
   * un doublon de retentative, pas une opération tardive. Le valider à
   * nouveau le ferait rejeter dès que la commande a changé d'état entre
   * l'envoi et la réémission — et l'appareil ne viderait jamais son outbox.
   */
  evenementsConnus(
    restaurantId: string,
    eventIds: readonly string[],
  ): Promise<Set<string>>

  /**
   * Insère un lot d'événements EN UNE TRANSACTION.
   * Les événements déjà connus sont ignorés silencieusement : c'est la
   * garantie « jamais de double encaissement ».
   */
  insererEvenements(
    appareil: AppareilAuthentifie,
    evenements: readonly EvenementCommande[],
    batchId: string,
  ): Promise<ResultatInsertion>

  /** Consigne les rejets, pour qu'ils remontent au gérant. */
  consignerRejets(
    appareil: AppareilAuthentifie,
    batchId: string,
    rejets: readonly { eventId: string; code: string; message: string }[],
  ): Promise<void>

  /** Statuts des commandes citées par un lot, pour valider les transitions. */
  statutsDesCommandes(
    restaurantId: string,
    orderIds: readonly string[],
  ): Promise<Map<string, string>>

  /** Page d'événements depuis un curseur, TOUS appareils du restaurant. */
  evenementsDepuis(
    restaurantId: string,
    depuis: number,
    limite: number,
  ): Promise<readonly EvenementCommande[]>

  /** Page de changements de référentiel depuis un curseur. */
  catalogueDepuis(
    restaurantId: string,
    depuis: number,
    limite: number,
  ): Promise<readonly ChangementCatalogue[]>

  /** Curseurs de tête, pour savoir s'il reste des pages. */
  curseursDeTete(restaurantId: string): Promise<{ catalogue: number; evenements: number }>

  /** Mémorise l'avancement d'un appareil et son battement de cœur. */
  majCurseurs(
    appareil: AppareilAuthentifie,
    curseurs: { catalogue?: number; evenements?: number },
    quoi: 'push' | 'pull',
  ): Promise<void>

  /** Reprojette une commande côté serveur depuis son journal. */
  reprojeter(restaurantId: string, orderIds: readonly string[]): Promise<void>

  fermer(): Promise<void>
}
