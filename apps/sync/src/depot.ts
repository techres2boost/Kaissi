/**
 * Dépôt de synchronisation — la seule frontière d'accès aux données.
 *
 * L'interface existe pour deux raisons concrètes :
 *   • la logique du service se teste sans base ;
 *   • le jour où l'on change de fournisseur Postgres, ou si l'on bascule sur
 *     PowerSync (jalon de fin de Phase 2), c'est cette couche qu'on remplace,
 *     pas le protocole ni le POS.
 */

import type { EvenementCommande, MutationCatalogue } from '@kaissi/domain'
import type { ChangementCatalogue, ShiftSynchronise } from './protocole.js'
import type { SondeMigration } from './schema-requis.js'
import type { MesuresBase } from './surveillance.js'

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
  /**
   * `actif` | `ferme` | `suspendu` (migrations 0002 et 0038).
   *
   * Rendu plutôt que filtré en SQL, et c'est délibéré : un établissement
   * fermé disparaît de la liste PROPOSÉE, mais un gérant qui le désigne
   * explicitement doit lire sa VRAIE raison. Le filtrer ici ferait répondre
   * « ce compte n'est pas gérant de cet établissement » — ce qui est faux,
   * et envoie chercher un problème de droits qui n'existe pas.
   */
  readonly statut: string
  /**
   * L'employé — `kaissi.users.id`, donc l'identifiant que la caisse connaît —
   * derrière le compte qui vient de s'authentifier.
   *
   * ⚠ Ce n'est PAS l'identifiant Supabase Auth : depuis la 0017 les deux
   *   identités sont distinctes (un serveur en salle a une ligne `users` sans
   *   compte de connexion). Renvoyer l'un pour l'autre ferait chercher à la
   *   caisse un employé qui n'existe pas chez elle.
   */
  readonly employeId: string
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

/** Un envoi en cuisine NOUVEAU, à annoncer aux postes de préparation (0047). */
/** Durées de conservation du registre d'idempotence, en jours. */
export interface RetentionRegistre {
  readonly evenementsJours: number
  readonly catalogueJours: number
  readonly rejetsJours: number
}

export interface EnvoiCuisine {
  readonly restaurantId: string
  readonly orderId: string
  readonly numero: string | null
  readonly table: string | null
  readonly type: string
  /** Un envoi précédent existait : ce sont des plats AJOUTÉS. */
  readonly ajout: boolean
  /** Les seules lignes de CET envoi. */
  readonly lignes: readonly { designation: string; quantite: number; stationId: string | null }[]
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
   * Les migrations dont ce code dépend et que la base n'a pas
   * (`schema-requis.ts`). Facultative : un dépôt de test n'a pas de schéma.
   */
  migrationsManquantes?(): Promise<SondeMigration[]>

  /** Les mesures de l'écran Surveillance (`surveillance.ts`). Facultative. */
  mesuresBase?(): Promise<MesuresBase>

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

  /**
   * Le rôle d'un employé DANS CET ÉTABLISSEMENT, relu en base.
   *
   * `null` si l'employé n'y a aucune appartenance, ou si elle est révoquée.
   *
   * C'est ici que se joue la seule garde qui vaille sur le catalogue :
   * l'appareil DÉCLARE qui demande, le serveur ne le croit pas. Un PIN à
   * quatre chiffres trace, il ne protège pas — et une caisse volée porte un
   * jeton valide.
   */
  roleDeLEmploye(restaurantId: string, employeId: string): Promise<string | null>

  /**
   * Applique un lot de CRÉATIONS de catalogue (article, catégorie, réduction,
   * groupe de modificateurs), et rend les mutations réellement écrites.
   *
   * L'idempotence est celle de `sync_mutations` : la même mutation renvoyée
   * cinq fois n'insère qu'une fois. Les entités acceptées redescendent ensuite
   * par `change_log`, comme n'importe quel changement de prix — les
   * déclencheurs existent depuis les 0005/0030/0037, il n'y a aucune voie
   * nouvelle.
   */
  appliquerMutationsCatalogue(
    appareil: AppareilAuthentifie,
    mutations: readonly MutationCatalogue[],
  ): Promise<readonly string[]>

  /** Consigne des rejets de CATALOGUE dans le registre d'idempotence. */
  consignerRejetsCatalogue(
    appareil: AppareilAuthentifie,
    rejets: readonly { eventId: string; code: string; message: string }[],
  ): Promise<void>

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

  /**
   * Reprojette une commande côté serveur depuis son journal.
   *
   * Rend les envois en cuisine NOUVEAUX que cette reprojection a fait
   * apparaître (0046/0047) — ceux dont le rang dépasse celui que la
   * projection connaissait. Un renvoi du même lot n'en rend aucun : la
   * cuisine n'est jamais notifiée deux fois pour le même envoi.
   */
  reprojeter(
    restaurantId: string,
    orderIds: readonly string[],
  ): Promise<readonly EnvoiCuisine[] | void>

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
   * Rôle de cet utilisateur dans cet établissement, ou `null`.
   *
   * Le service parle à la base avec un rôle privilégié : RLS ne le filtre
   * pas. C'est donc CETTE lecture qui décide, explicitement, si l'appelant a
   * le droit d'ouvrir un accès — jamais une confiance faite au client.
   */
  roleDansEtablissement(authUserId: string, restaurantId: string): Promise<string | null>

  /**
   * Les établissements où cet utilisateur est ADMINISTRATEUR, avec leur
   * organisation.
   *
   * Sert à répondre à « puis-je créer un restaurant, et dans quelle
   * organisation ». Un administrateur distribue les pouvoirs ; ouvrir un
   * établissement en fait partie. Un gérant EXPLOITE le sien, il n'en ouvre
   * pas un second.
   */
  etablissementsAdministres(
    authUserId: string,
  ): Promise<{ restaurantId: string; organizationId: string; nom: string }[]>

  /**
   * Crée un établissement, son référentiel de départ, et l'appartenance de
   * son créateur — le tout dans UNE transaction.
   *
   * Les trois ensemble, et pas l'un après l'autre : un restaurant sans taux
   * de TVA ni mode de paiement ne peut RIEN encaisser, et un restaurant sans
   * appartenance n'est visible de personne — pas même de celui qui vient de
   * le créer, puisque RLS ne rend que ce à quoi on appartient. Une création à
   * moitié faite serait donc irrattrapable depuis l'interface.
   */
  creerEtablissement(demande: {
    organizationId: string
    nom: string
    timezone: string
    bascule: string
    /** L'établissement dont on recopie taux de taxe, paiements et postes. */
    modeleRestaurantId: string | null
    /** Le créateur, qui en devient administrateur. */
    authUserId: string
  }): Promise<{ restaurantId: string; reglagesCopies: number }>

  /**
   * Ce qui EMPÊCHE de supprimer un établissement, compté avant d'essayer.
   *
   * Les tables transactionnelles le référencent en `on delete restrict`
   * (migration 0004, et `audit_events` depuis la 0006) : la base refuse déjà
   * la suppression d'un établissement qui a vendu, et c'est la bonne place
   * pour cette règle — détruire des écritures comptables ne doit pas
   * dépendre de la vigilance d'un `where` écrit à la main.
   *
   * Ce qui manquait n'était donc pas la règle, mais le fait de la DIRE avant
   * le clic. Sans ce compte, l'administrateur recevait « update or delete on
   * table "restaurants" violates foreign key constraint » : un message qui ne
   * nomme ni ce qui bloque, ni quoi faire à la place.
   */
  obstaclesSuppression(restaurantId: string): Promise<{
    ventes: number
    services: number
    evenements: number
    appareils: number
    /** Le journal d'audit — lui aussi en `restrict`, et lui aussi définitif. */
    audit: number
  }>

  /** Ferme ou rouvre un établissement (migration 0038). */
  changerStatutEtablissement(
    restaurantId: string,
    statut: 'actif' | 'ferme',
  ): Promise<void>

  /**
   * Supprime un établissement VIERGE.
   *
   * Ne force rien : les contraintes `on delete restrict` restent la dernière
   * ligne de défense. Si elles se déclenchent, c'est que le compte préalable
   * a raté quelque chose — et l'erreur doit remonter telle quelle plutôt
   * qu'être contournée.
   */
  supprimerEtablissement(restaurantId: string): Promise<void>

  /**
   * Ouvre une organisation ENTIÈRE pour un compte qui n'a encore rien.
   *
   * Distinct de `creerEtablissement`, qui suppose une organisation, un
   * établissement modèle et une ligne `kaissi.users` déjà là. Ici, rien
   * n'existe : c'est le premier geste d'un restaurateur qui installe la
   * caisse et crée son compte depuis la tablette.
   */
  creerInscription(demande: {
    /** L'identité Supabase Auth, créée juste avant par GoTrue. */
    authUserId: string
    email: string
    nomGerant: string
    nomRestaurant: string
    timezone: string
    bascule: string
    /** Hachage Argon2id du PIN choisi à l'inscription — la caisse s'ouvre avec. */
    pinHash?: string | null
  }): Promise<{ organizationId: string; restaurantId: string; employeId: string }>

  /** Compte d'authentification portant cette adresse, s'il existe. */
  compteParEmail(email: string): Promise<{ id: string; email: string } | null>

  /** Compte d'authentification d'un employé, s'il en a un. */
  compteDeLEmploye(
    employeId: string,
    restaurantId: string,
  ): Promise<{ authUserId: string; email: string } | null>

  /**
   * Relie un compte d'authentification à un établissement.
   *
   * Rejouable : la même demande deux fois met le rôle à jour et lève une
   * éventuelle révocation, au lieu d'échouer sur la clé d'unicité. C'est la
   * logique de `pnpm sync:acces`, portée dans le service pour que personne
   * n'ait plus besoin d'un terminal.
   */
  rattacherAcces(demande: {
    restaurantId: string
    authUserId: string
    email: string
    nom: string
    role: string
  }): Promise<{ employeId: string; cree: boolean }>

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
   * Allège le registre d'idempotence (`sync_mutations`) de ce qui n'y
   * protège plus rien. Rend le nombre de lignes retirées.
   *
   * ── Ce qu'on retire, et pourquoi c'est sans risque ─────────────────────
   *
   *   • les accusés d'ÉVÉNEMENTS DE COMMANDE (accepte, doublon) : leur
   *     idempotence est portée par la clé primaire de `order_events`, qui
   *     ne se purge jamais (`evenementsConnus` la lit, pas ce registre). La
   *     ligne de `sync_mutations` n'est plus qu'un reçu ;
   *   • les créations de CATALOGUE acceptées, après bien plus longtemps : ici
   *     le registre EST la garantie, et il doit survivre à la plus longue
   *     déconnexion plausible d'une caisse ;
   *   • les REJETS, après six mois : ils sont remontés au gérant.
   *
   * ── Ce qu'on ne retire JAMAIS ──────────────────────────────────────────
   *
   * Une vente. `order_events`, `orders`, `payments`, `audit_events` : ce sont
   * des pièces comptables, et la source de vérité. ⚠ Leur durée de
   * conservation légale est une question d'expert-comptable.
   */
  purgerRegistreSynchronisation?(retention: RetentionRegistre): Promise<number>

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
  /**
   * Les produits qui méritent une alerte non encore ouverte.
   *
   * Le `filtre` sert à poser la MÊME question sur une poignée de produits :
   * « la vente qui vient d'arriver donne-t-elle lieu à une alerte ? ». Une
   * seule requête pour les deux usages — deux prédicats divergeraient.
   */
  produitsEnAlerte(
    plafond: number,
    filtre?: { readonly restaurantId: string; readonly produits: readonly string[] },
  ): Promise<readonly ProduitEnAlerte[]>

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

  /**
   * Les navigateurs abonnés aux arrivées en préparation (0047) dont le POSTE
   * est concerné : celui de l'appartenance, et tous si elle n'en a pas.
   */
  abonnementsPreparation?(
    restaurantId: string,
    stationIds: readonly string[],
  ): Promise<readonly AbonnementPush[]>

  /**
   * Change la formule de l'organisation qui possède cet établissement.
   * `null` si l'établissement n'existe pas. Réservé à l'ÉDITEUR : la route
   * l'a vérifié avant d'appeler, la base n'a aucune politique d'écriture
   * sur `subscriptions` (migration 0040).
   */
  changerFormule(
    restaurantId: string,
    plan: 'gratuit' | 'pro',
    note: string,
  ): Promise<{ organizationId: string } | null>

  /** Même geste, par ORGANISATION : l'éditeur n'est membre d'aucun restaurant client. */
  changerFormuleOrganisation(
    organizationId: string,
    plan: 'gratuit' | 'pro',
    note: string,
  ): Promise<boolean>

  /**
   * Tous les clients et leur formule — pour l'écran de l'ÉDITEUR. Lu avec
   * le rôle privilégié du service : la route l'a réservé aux éditeurs avant
   * d'appeler, et c'est la seule lecture transversale à tous les clients.
   */
  listerClients(): Promise<
    readonly {
      organizationId: string
      nom: string
      plan: string
      depuis: string | null
      note: string | null
      etablissements: readonly { nom: string; ferme: boolean }[]
    }[]
  >

  /** Retire un canal que le navigateur a révoqué (404 ou 410). */
  supprimerAbonnement(endpoint: string): Promise<void>

  /**
   * L'abonnement de CE navigateur, s'il appartient bien à ce compte et à cet
   * établissement — pour la notification de test. Le filtre sur le compte
   * n'est pas décoratif : sans lui, un membre pourrait faire sonner le
   * téléphone d'un collègue en connaissant son `endpoint`.
   */
  abonnementDuCompte(
    authUserId: string,
    restaurantId: string,
    endpoint: string,
  ): Promise<AbonnementPush | null>

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
