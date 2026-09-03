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

export interface EtablissementEnrolable {
  readonly restaurantId: string
  readonly organizationId: string
  readonly nom: string
  readonly role: string
}

export interface DemandeEnrolement {
  readonly restaurantId: string
  readonly libelle: string
  /** Laissé vide : le serveur attribue le prochain préfixe libre. */
  readonly prefixe?: string
  /**
   * Identifiant STABLE de l'installation du POS, tiré par le terminal à son
   * premier démarrage et conservé dans sa base locale.
   *
   * C'est lui qui rend l'appairage IDEMPOTENT : sans lui, chaque mise en
   * service crée un appareil de plus, les événements déjà en attente dans
   * l'outbox portent l'ancien `device_id` et sont refusés pour toujours en
   * « appareil_etranger » — des ventes qui n'arrivent jamais.
   *
   * Absent : on retombe sur l'ancien comportement (appareil neuf), pour les
   * outils en ligne de commande et les terminaux antérieurs à la 0021.
   */
  readonly installationId?: string
}

export interface AppareilEnrole {
  readonly deviceId: string
  readonly restaurantId: string
  readonly organizationId: string
  readonly nomEtablissement: string
  readonly prefixe: string
  /** En CLAIR. Ne sera plus jamais lisible ensuite. */
  readonly jeton: string
  /**
   * `true` si le terminal a RETROUVÉ son identité au lieu d'en recevoir une
   * neuve. Le POS le dit à l'écran : « ce terminal était déjà connu ».
   */
  readonly reprise: boolean
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

  /**
   * Établissements où cet utilisateur a le droit d'enrôler un terminal.
   *
   * Seuls `admin` et `gerant` : un caissier ne décide pas quelle tablette
   * rejoint la caisse de l'établissement.
   */
  etablissementsEnrolables(userId: string): Promise<EtablissementEnrolable[]>

  /**
   * Crée un appareil et rend son jeton EN CLAIR — la seule et unique fois
   * où il existe hors de l'appareil. La base n'en garde que l'empreinte.
   */
  enrolerAppareil(demande: DemandeEnrolement): Promise<AppareilEnrole>

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

  /**
   * Commandes dont les événements sont arrivés mais dont la projection
   * manque, parmi les `fenetre` derniers événements reçus, au plus `plafond`.
   *
   * Sert au balayage d'auto-réparation du démarrage (`reparation.ts`). La
   * fenêtre porte sur `server_seq` — le curseur du protocole, indexé et
   * indépendant de toute horloge — jamais sur une durée.
   */
  projectionsOrphelines(
    fenetre: number,
    plafond: number,
  ): Promise<{ restaurantId: string; orderId: string }[]>

  fermer(): Promise<void>
}
