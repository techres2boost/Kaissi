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
import type { ChangementCatalogue, ShiftSynchronise } from './protocole.js'

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

/**
 * Un produit qui vient de franchir un seuil de stock.
 *
 * Le type vit ICI plutôt que dans `alertes.ts` : c'est une forme rendue par
 * le dépôt, et la frontière d'accès aux données est ce fichier.
 */
export interface ProduitEnAlerte {
  readonly restaurantId: string
  readonly organizationId: string
  readonly productId: string
  readonly nom: string
  /** `rupture` : quantité ≤ 0. `faible` : au seuil `min_qty` ou en dessous. */
  readonly niveau: 'rupture' | 'faible'
  readonly qty: number
  readonly seuil: number | null
}

/** L'abonnement d'un NAVIGATEUR aux notifications (migration 0028). */
export interface AbonnementPush {
  readonly id: string
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
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

  /**
   * Écrit les services de caisse remontés par un terminal.
   *
   * Upsert sur l'identifiant, généré par la tablette : renvoyer le même shift
   * n'en crée pas un second. Rend les identifiants réellement écrits.
   */
  enregistrerShifts(
    appareil: AppareilAuthentifie,
    shifts: readonly ShiftSynchronise[],
  ): Promise<readonly string[]>

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

  /**
   * Retire du journal de catalogue les marqueurs « prêt » devenus inutiles.
   *
   * Ils y descendent par le même canal que le catalogue (0029), et c'est ce
   * qui rend la fonction gratuite en protocole — mais un « prêt » est
   * VOLUMINEUX comparé à un changement de prix : plusieurs centaines par
   * jour et par établissement, contre quelques-uns par semaine.
   *
   * Sans purge, un terminal neuf rejouerait des années de plats servis avant
   * d'atteindre le catalogue courant. Un marqueur de plus de quelques jours
   * n'apprend plus rien à personne : une tablette restée hors ligne aussi
   * longtemps n'a que faire d'un plateau prêt la semaine dernière.
   *
   * Ne touche QUE `kitchen_ready` : purger le catalogue ferait manquer un
   * changement de prix à un appareil en retard, ce qui est tout autre chose.
   */
  purgerJournalPrets(jours: number): Promise<number>

  /**
   * Produits en alerte pour lesquels rien n'a ENCORE été annoncé.
   *
   * Une alerte ouverte de niveau égal ou supérieur masque le produit : sans
   * cela, le balayage réenverrait la même alerte toutes les demi-heures, et
   * une alerte répétée est une alerte qu'on coupe. Une aggravation, elle,
   * passe : un produit signalé « faible » qui tombe à zéro doit le dire.
   *
   * Le plafond borne UN passage. Un premier inventaire peut mettre deux
   * cents références sous le seuil d'un coup ; les suivantes attendent le
   * balayage d'après, et le back-office les montre toutes de toute façon.
   */
  produitsEnAlerte(plafond: number): Promise<readonly ProduitEnAlerte[]>

  /**
   * Clôt les alertes dont le motif a disparu, et rend leur nombre.
   *
   * C'est cette clôture qui AUTORISE la suivante : sans elle, un produit
   * alerté une fois ne le serait plus jamais.
   */
  cloreAlertesResolues(): Promise<number>

  /** Journalise une alerte annoncée, et les canaux par lesquels elle est partie. */
  enregistrerAlerte(produit: ProduitEnAlerte, canaux: string): Promise<void>

  /** Canaux de notification actifs pour un établissement. */
  abonnementsPush(restaurantId: string): Promise<readonly AbonnementPush[]>

  /** Retire un canal que le navigateur a révoqué (404 ou 410). */
  supprimerAbonnement(endpoint: string): Promise<void>

  /**
   * Adresses de l'encadrement — `admin` et `gerant` seuls.
   *
   * Un caissier n'a pas à recevoir les alertes de stock : il ne commande pas
   * les réapprovisionnements, et une alerte qui ne s'adresse à personne se
   * range dans les indésirables.
   */
  emailsGestionnaires(restaurantId: string): Promise<readonly string[]>

  fermer(): Promise<void>
}
