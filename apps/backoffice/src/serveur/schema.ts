/**
 * Le contrat de base, réduit à ce que le back-office touche.
 *
 * Pourquoi écrit à la main plutôt que généré : le générateur de Supabase ne
 * sort que le schéma `public`, qui est ici volontairement vide — tout vit
 * dans `kaissi`. Le déclarer explicitement a d'ailleurs une vertu : ce
 * fichier dit, noir sur blanc, de quelles colonnes le back-office dépend.
 * Une colonne renommée dans une migration casse la compilation au lieu de
 * casser la production.
 *
 * ⚠ Toute migration qui touche l'une de ces colonnes doit passer ici.
 */

/** Millimes : entiers. Le type ne peut pas l'imposer, le nom le rappelle. */
type Millimes = number
type Uuid = string
type Horodatage = string

/**
 * Alias de type et NON `interface` : TypeScript n'accorde d'index implicite
 * qu'aux alias. Une `interface` ne satisfait donc pas le `Record<string,
 * unknown>` qu'exige postgrest-js, et toute requête se résout alors en
 * `never` — sans le moindre message expliquant pourquoi.
 */
type Table<Ligne, Relations extends readonly Relation[] = []> = {
  Row: Ligne
  Insert: Partial<Ligne>
  Update: Partial<Ligne>
  Relationships: Relations
}

/**
 * Une clé étrangère, telle que PostgREST la connaît.
 *
 * Sans cette déclaration, une requête imbriquée (`users(full_name)`) échoue à
 * la COMPILATION avec « could not find the relation between … » — ce qui est
 * en réalité une bonne nouvelle : la même faute passerait sinon inaperçue
 * jusqu'à l'exécution, où elle rendrait une colonne vide.
 */
type Relation = {
  foreignKeyName: string
  columns: readonly string[]
  isOneToOne: boolean
  referencedRelation: string
  referencedColumns: readonly string[]
}

type VersUtilisateur<Nom extends string> = {
  foreignKeyName: Nom
  columns: ['user_id']
  isOneToOne: false
  referencedRelation: 'users'
  referencedColumns: ['id']
}

export type Restaurant = {
  id: Uuid
  organization_id: Uuid
  name: string
  timezone: string
  /** Heure locale de bascule de la journée commerciale, « 04:00:00 ». */
  business_day_start: string
  /*
   * ── Les options de RESTAURATION ─────────────────────────────────────────
   *
   * Présentes depuis la 0002, et lues par AUCUN calcul jusqu'à la 0036 :
   * `packages/domain` savait les appliquer (étapes 7 et 8 de `totaux.ts`),
   * mais ni la caisse ni le serveur ne les lui passaient.
   *
   * `service_tax_rate_id` vient de la 0036 : sans lui, `service_taxable` à
   * vrai ne taxait rien du tout — le domaine ne calcule la taxe du service
   * que s'il connaît le taux.
   *
   * ⚠ Aucune valeur par défaut ici n'est une règle fiscale. Le timbre et le
   *   caractère taxable du service restent à valider par un expert-comptable.
   */
  service_rate_bp: number
  service_taxable: boolean
  service_tax_rate_id: Uuid | null
  stamp_duty_millimes: Millimes
  /**
   * `actif` | `ferme` | `suspendu`. Lu par personne jusqu'à la 0038 — le
   * basculer n'aurait rien changé.
   */
  status: string
  /** Quand l'établissement a été fermé (0038). Nul tant qu'il est actif. */
  closed_at: Horodatage | null
  /*
   * ── L'en-tête et le pied du REÇU ────────────────────────────────────────
   *
   * Déclarés ici depuis que l'écran « Paramètres → Reçu » les modifie. Les
   * trois premiers existaient en base depuis la 0002 ; `receipt_footer` vient
   * de la 0035, qui pose aussi le déclencheur `change_log` sans lequel rien
   * de tout cela n'atteignait la caisse.
   *
   * ⚠ `fiscal_id` : le champ existe, son format et son obligation ne sont
   *   affirmés nulle part dans ce dépôt.
   */
  address: string | null
  phone: string | null
  fiscal_id: string | null
  receipt_footer: string | null
}

export type Utilisateur = {
  id: Uuid
  organization_id: Uuid
  /** Compte Supabase Auth, FACULTATIF : un serveur en salle n'en a pas. */
  auth_user_id: Uuid | null
  /** Facultatif depuis la 0017 : inventer un e-mail produirait une donnée fausse. */
  email: string | null
  full_name: string
  phone: string | null
  /** Hachage Argon2id — jamais le PIN. */
  pin_hash: string | null
  status: string
  archived_at: Horodatage | null
  updated_at: Horodatage
}

export type Appartenance = {
  id: Uuid
  organization_id: Uuid
  user_id: Uuid
  restaurant_id: Uuid
  role: string
  /** Poste tenu par un rôle de préparation (migration 0025). */
  station_id: Uuid | null
  permissions: Record<string, unknown> | null
  revoked_at: Horodatage | null
  updated_at: Horodatage
}

export type Categorie = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  name: string
  position: number
  color: string | null
  /**
   * Poste de préparation de TOUS les produits de la catégorie (0025).
   * `products.station_id` ne sert plus que de repli pour l'existant.
   */
  station_id: Uuid | null
  archived_at: Horodatage | null
  /**
   * Colonne bien présente en base (0003), mais absente de ce type jusqu'ici.
   * `categories` n'a PAS de déclencheur `touche_updated_at` : l'horodatage
   * doit être posé explicitement à chaque écriture, ce qui suppose de
   * pouvoir l'écrire.
   */
  updated_at: Horodatage
}

export type Station = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  name: string
  /**
   * L'imprimante du poste — adresse IP ou nom d'hôte, et port TCP.
   *
   * Déclarées ici depuis que l'écran « Imprimantes cuisine » les modifie.
   * `printer_host` à `null` est un état légitime : le poste existe pour
   * l'écran de préparation, et n'imprime rien. `printer_port` est NOT NULL en
   * base avec 9100 par défaut (0003), d'où l'absence de `| null`.
   */
  printer_host: string | null
  printer_port: number
  position: number
  updated_at: Horodatage
  archived_at: Horodatage | null
}

/**
 * Une réduction du référentiel (migration 0030).
 *
 * `value_bp` OU `amount_millimes`, jamais les deux : la contrainte de base
 * l'impose, parce qu'une ligne qui porterait les deux laisserait la caisse
 * choisir — et deux caisses choisiraient différemment.
 */
export type Reduction = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  name: string
  /** `'pourcentage'` ou `'montant'`. */
  kind: string
  /** Points de base ENTIERS : 10 % = 1000. Nul pour un montant fixe. */
  value_bp: number | null
  amount_millimes: Millimes | null
  position: number
  updated_at: Horodatage
  archived_at: Horodatage | null
}

/**
 * Une fiche client (migration 0031).
 *
 * Un carnet d'adresses, pas un programme de fidélité : de quoi rappeler
 * quelqu'un pour une commande à emporter, ou reconnaître un habitué. Ni les
 * visites ni le total dépensé ne sont ici — ils se calculent, et vivent dans
 * la vue `clients_visites`.
 */
export type Client = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  name: string
  phone: string | null
  email: string | null
  note: string | null
  created_at: Horodatage
  updated_at: Horodatage
  archived_at: Horodatage | null
}

/**
 * Ce que les commandes disent d'un client — CALCULÉ, jamais compté.
 *
 * Un compteur incrémenté par déclencheur devrait défaire exactement ce qu'il
 * a fait à chaque reprojection, y compris quand une commande passe
 * « annulée ». Il dériverait en silence, et personne ne saurait depuis quand.
 */
export type ClientVisites = {
  customer_id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  premiere_visite: Horodatage | null
  derniere_visite: Horodatage | null
  visites: number
  depense_millimes: Millimes
}

/**
 * Un GROUPE de modificateurs — « Cuisson », « Suppléments ».
 *
 * Existe depuis la migration 0003 ; déclaré ici depuis que l'écran
 * « Articles → Modificateurs » le modifie. Avant lui, ces trois tables
 * n'avaient AUCUNE porte : un restaurateur qui voulait proposer
 * « + Fromage 1,500 » devait passer par une console SQL.
 */
export type GroupeModificateurs = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  name: string
  /** Combien de choix AU MOINS. Zéro = facultatif. */
  min_select: number
  /** Combien AU PLUS. Zéro = sans limite (contrainte de la 0003). */
  max_select: number
  /**
   * Se DÉDUIT de `min_select > 0` : exiger au moins un choix EST le sens de
   * « obligatoire ». Deux réglages pour une seule idée finissent par se
   * contredire — un groupe « obligatoire » avec un minimum à zéro ne veut
   * plus rien dire. La colonne reste, la caisse la lit.
   */
  is_required: boolean
  position: number
  updated_at: Horodatage
  archived_at: Horodatage | null
}

/**
 * Un CHOIX dans un groupe — « Fromage +1,500 », « Bien cuit +0 ».
 *
 * `price_delta_millimes` peut être NÉGATIF : « sans fromage −0,500 » est un
 * usage réel, et le schéma ne pose aucune contrainte de positivité. Il entre
 * dans l'étape 1 de `totaux.ts` : `prixBase + Σ modificateurs`.
 */
export type Modificateur = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  modifier_group_id: Uuid
  name: string
  price_delta_millimes: Millimes
  position: number
  is_available: boolean
  updated_at: Horodatage
  archived_at: Horodatage | null
}

/**
 * Le lien ARTICLE ↔ GROUPE.
 *
 * ⚑ Pas de colonne `id`, et ce n'est pas un oubli : son identité est le
 *   COUPLE (`primary key (product_id, modifier_group_id)`). C'est pour cela
 *   que la migration 0037 lui donne un déclencheur dédié qui journalise
 *   l'ENSEMBLE des groupes d'un produit — le déclencheur générique du
 *   référentiel écrit `ligne.id`, et échouerait ici à chaque écriture.
 *
 *   Cette table n'a jamais descendu jusqu'à la 0037. La caisse joint dessus
 *   pour lire ses modificateurs : absente, la jointure ne rend rien, et aucun
 *   produit ne proposait de supplément sur un terminal appairé.
 */
export type ProduitModificateur = {
  organization_id: Uuid
  restaurant_id: Uuid
  product_id: Uuid
  modifier_group_id: Uuid
  position: number
}

export type TauxTaxe = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  name: string
  /** Points de base entiers : 19 % = 1900. Jamais 0.19. */
  rate_bp: number
  is_included: boolean
  is_default: boolean
  archived_at: Horodatage | null
}

export type Produit = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  category_id: Uuid | null
  station_id: Uuid | null
  tax_rate_id: Uuid
  name: string
  description: string | null
  base_price_millimes: Millimes
  /**
   * Coût d'achat unitaire — SEULE exception au tout-entier (numeric(18,6)).
   * Exprimé dans la même unité que le prix : des millimes, mais
   * fractionnaires. Un burger acheté 10 TND vaut 10000.
   * `null` = coût non renseigné, ce que les rapports signalent au lieu de
   * le confondre avec un coût nul.
   */
  cost_per_unit: number | null
  track_stock: boolean
  position: number
  is_available: boolean
  /**
   * Pourquoi le produit est hors carte : `'manuel'` (décision du gérant, que
   * l'automatisme ne défera jamais) ou `'stock'` (rupture automatique, levée
   * dès que le stock repasse au-dessus de zéro). `null` s'il est en vente.
   */
  unavailable_reason: string | null
  archived_at: Horodatage | null
  updated_at: Horodatage
}

/**
 * Une ligne de la ventilation de TVA, telle que le projecteur l'écrit dans
 * `orders.tax_breakdown`.
 *
 * ⚑ Les noms de champs sont ceux de `VentilationTaxe` de `@kaissi/domain` —
 * c'est ce type-là qui est sérialisé tel quel par la reprojection (serveur
 * comme POS). En particulier la base s'appelle `baseHtMillimes`, PAS
 * `baseMillimes` : ce dernier n'existe que dans la vue d'impression du
 * ticket (`packages/domain/src/ticket.ts`), qui renomme le champ. Les
 * confondre rendait `undefined`, et `millimes(undefined)` fait tomber la
 * page entière.
 */
export type LigneVentilation = {
  tauxTaxeId: string
  nom: string
  tauxBp: number
  incluse: boolean
  baseHtMillimes: Millimes
  taxeMillimes: Millimes
}

export type Commande = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  table_id: Uuid | null
  /** L'employé qui a OUVERT la commande, et celui qui l'a ENCAISSÉE. */
  opened_by: Uuid | null
  closed_by: Uuid | null
  status: string
  /** `dine_in` | `takeaway` | `delivery`. */
  type: string
  ticket_number: string | null
  subtotal_millimes: Millimes
  discount_millimes: Millimes
  tax_millimes: Millimes
  service_millimes: Millimes
  stamp_duty_millimes: Millimes
  total_millimes: Millimes
  tax_breakdown: LigneVentilation[]
  covers: number | null
  /**
   * La réduction appliquée à la commande, et son nom AU MOMENT de la vente
   * (0030). Le libellé est recopié, jamais joint : renommer une réduction ne
   * doit pas réécrire ce qui a été accordé l'an dernier.
   */
  discount_id: Uuid | null
  discount_label: string | null
  /**
   * Le client rattaché à la commande, et son nom AU MOMENT de la vente
   * (0031). Même raison que pour la réduction : corriger une fiche l'an
   * prochain ne doit pas réécrire un reçu déjà remis.
   */
  customer_id: Uuid | null
  customer_name: string | null
  opened_at: Horodatage
  /** Horodatage du premier envoi en cuisine. Alimente l'écran de cuisine. */
  sent_at: Horodatage | null
  closed_at: Horodatage | null
}

/**
 * Une ligne de commande, telle que l'écran de cuisine la lit.
 *
 * Réduite à ce qui sert à PRÉPARER un plat : ni prix, ni taxe, ni remise. La
 * cuisine n'a aucune raison de voir des montants, et les colonnes non
 * déclarées ici ne peuvent pas être demandées par erreur.
 */
export type LigneCommande = {
  id: Uuid
  restaurant_id: Uuid
  order_id: Uuid
  product_id: Uuid | null
  station_id: Uuid | null
  designation: string
  qty: number
  /** Brut = (prix + modificateurs) × quantité, AVANT toute remise. */
  line_gross_millimes: Millimes
  line_discount_millimes: Millimes
  global_discount_share_millimes: Millimes
  /**
   * Base APRÈS remises et HORS taxe exclusive. C'est LA grandeur comparable
   * au coût d'achat : mélanger un CA TTC et un coût HT gonflerait la marge
   * d'un point de TVA.
   */
  line_total_millimes: Millimes
  line_tax_millimes: Millimes
  /** La réduction appliquée à CETTE ligne, et son nom figé (0030). */
  discount_id: Uuid | null
  discount_label: string | null
  modifiers: { nom?: string; prixDeltaMillimes?: number }[]
  note: string | null
  position: number
  voided_at: Horodatage | null
}

export type Remboursement = {
  id: Uuid
  restaurant_id: Uuid
  payment_id: Uuid
  amount_millimes: Millimes
  reason: string
  created_at: Horodatage
}

/** Comptage de référence du stock (0019). Le stock RÉEL est dans la vue. */
export type StockItem = {
  product_id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  qty_reference: number
  counted_at: Horodatage
  min_qty: number | null
  /**
   * Retirer automatiquement le produit de la carte quand son stock atteint
   * zéro. À couper pour un produit dont le comptage n'est qu'indicatif.
   */
  auto_rupture: boolean
  updated_at: Horodatage
}

/**
 * L'abonnement d'un NAVIGATEUR aux notifications (migration 0028).
 *
 * Ni `p256dh` ni `auth` ne sont des secrets de compte : ce sont les clés de
 * chiffrement de CE canal, fournies par le navigateur. RLS les réserve tout
 * de même à leur propriétaire — un caissier n'a pas à lire le canal du
 * gérant.
 */
export type AbonnementPush = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  user_id: Uuid
  endpoint: string
  p256dh: string
  auth: string
  alertes_stock: boolean
  created_at: Horodatage
  updated_at: Horodatage
}

export type MouvementStock = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  product_id: Uuid
  /** Signé : +12 pour une réception, −3 pour une casse. */
  qty_delta: number
  reason: string
  note: string | null
  /** Nom du fournisseur, facultatif et libre (0026). */
  supplier: string | null
  created_by: Uuid | null
  created_at: Horodatage
}

/**
 * Vue en LECTURE SEULE : référence + mouvements manuels − ventes depuis le
 * comptage. Calculée à la lecture, donc insensible aux reprojections.
 */
export type StockActuel = {
  product_id: Uuid
  restaurant_id: Uuid
  qty_reference: number
  counted_at: Horodatage
  min_qty: number | null
  qty_mouvements: number
  qty_vendue: number
  qty_on_hand: number
}

export type TableSalle = {
  id: Uuid
  restaurant_id: Uuid
  label: string
  archived_at: Horodatage | null
}

/**
 * Marqueur « commande prête », posé depuis l'écran de cuisine (0018).
 * N'appartient PAS au journal de la commande : voir la migration.
 */
export type CuisinePrete = {
  order_id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  ready_at: Horodatage
  ready_by: Uuid | null
  /**
   * Retrait d'un « prêt » posé par erreur (0029). La ligne RESTE marquée
   * plutôt que supprimée : une suppression ne descendrait pas jusqu'à la
   * tablette du serveur, dont le badge resterait allumé.
   */
  cleared_at: Horodatage | null
  cleared_by: Uuid | null
}

export type Paiement = {
  id: Uuid
  restaurant_id: Uuid
  order_id: Uuid
  type: string
  amount_millimes: Millimes
  /** Ce que le client a TENDU, et ce qu'on lui a rendu. */
  received_millimes: Millimes
  change_millimes: Millimes
  /**
   * Le SERVICE de caisse pendant lequel l'encaissement a eu lieu (0004).
   *
   * C'est lui qui permet de rattacher une recette à une période SANS
   * découper par fenêtre de temps — un découpage horaire rangerait une vente
   * du bout de nuit dans le service suivant.
   */
  shift_id: Uuid | null
  voided_at: Horodatage | null
  created_at: Horodatage
}

export type EvenementJournal = {
  event_id: Uuid
  order_id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  device_id: Uuid
  seq_device: number
  /** Curseur SERVEUR, attribué à l'arrivée. L'ordre qui fait foi (RÈGLE 4). */
  server_seq: number
  type: string
  payload: Record<string, unknown>
  actor_user_id: Uuid | null
  client_ts: Horodatage
}

export type MethodePaiement = {
  id: Uuid
  organization_id: Uuid
  restaurant_id: Uuid
  name: string
  /** `cash` | `card` | `online` | `other`. */
  type: string
  /**
   * Le tiroir-caisse s'ouvre à la validation de ce paiement.
   *
   * Déclaré ici depuis que l'écran « Modes de paiement » le modifie : ce
   * fichier dit noir sur blanc de quelles colonnes le back-office dépend, et
   * une colonne renommée doit casser la compilation plutôt que la production.
   */
  opens_drawer: boolean
  /** Ordre d'affichage à l'encaissement. Déduit, jamais saisi. */
  position: number
  is_active: boolean
  archived_at: Horodatage | null
}

export type Shift = {
  id: Uuid
  restaurant_id: Uuid
  opened_at: Horodatage
  closed_at: Horodatage | null
  opening_float_millimes: Millimes
  counted_millimes: Millimes | null
  expected_millimes: Millimes | null
  /** Compté − attendu. PEUT être négatif : c'est tout son intérêt. */
  variance_millimes: Millimes | null
  closing_note: string | null
  /**
   * Qui a COMPTÉ la caisse (0027) — distinct de `user_id`, qui l'a ouverte.
   * Nul pour les services clos avant la migration, et pour ceux en cours.
   */
  closed_by: Uuid | null
}

/**
 * `{ [_ in never]: never }` et non `Record<string, never>` : c'est la forme
 * que produit le générateur de Supabase, et la seule que ses types
 * utilitaires savent traverser. Avec `Record`, toute requête se résout en
 * `never` — sans message expliquant pourquoi.
 */
type Aucun = { [_ in never]: never }

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.17' }
  kaissi: {
    Tables: {
      restaurants: Table<Restaurant>
      users: Table<Utilisateur>
      memberships: Table<
        Appartenance,
        [
          VersUtilisateur<'memberships_user_id_fkey'>,
          {
            foreignKeyName: 'memberships_restaurant_id_fkey'
            columns: ['restaurant_id']
            isOneToOne: false
            referencedRelation: 'restaurants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'memberships_station_id_fkey'
            columns: ['station_id']
            isOneToOne: false
            referencedRelation: 'stations'
            referencedColumns: ['id']
          },
        ]
      >
      categories: Table<Categorie>
      stations: Table<Station>
      modifier_groups: Table<GroupeModificateurs>
      modifiers: Table<Modificateur>
      product_modifiers: Table<ProduitModificateur>
      tax_rates: Table<TauxTaxe>
      discounts: Table<Reduction>
      customers: Table<Client>
      clients_visites: Table<ClientVisites>
      products: Table<Produit>
      orders: Table<Commande>
      order_items: Table<LigneCommande>
      tables: Table<TableSalle>
      kitchen_ready: Table<CuisinePrete>
      payments: Table<Paiement>
      refunds: Table<Remboursement>
      stock_items: Table<StockItem>
      stock_movements: Table<MouvementStock>
      stock_actuel: Table<StockActuel>
      push_subscriptions: Table<AbonnementPush>
      /**
       * Le JOURNAL — lu pour reconstruire un ticket à l'identique du POS.
       * En insertion seule côté base : le back-office n'y écrit jamais.
       */
      order_events: Table<EvenementJournal>
      payment_methods: Table<MethodePaiement>
      shifts: Table<
        Shift,
        [
          VersUtilisateur<'shifts_user_id_fkey'>,
          {
            foreignKeyName: 'shifts_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      >
    }
    Views: Aucun
    Functions: {
      /**
       * Aligne `products.is_available` sur le stock calculé (migration 0023).
       *
       * Le back-office l'appelle après tout geste qui change une quantité —
       * mouvement, recomptage, activation ou arrêt du suivi. Le service de
       * synchronisation l'appelle, lui, après chaque reprojection de vente.
       */
      appliquer_rupture_auto: {
        Args: { p_restaurant: string; p_produits?: string[] | null }
        Returns: number
      }

      /**
       * Agrège les ventes d'une période SANS remonter la ligne à ligne
       * (migration 0033). Ne fait que des sommes d'entiers déjà décidés par
       * la projection : les coûts en sortent NON arrondis, et marges et
       * pourcentages restent dans `packages/domain`.
       *
       * `Returns: Json` et non un type détaillé : la forme est décrite —
       * et vérifiée — dans `agregats.ts`, qui est le seul appelant. La
       * décrire ici aussi la ferait exister à deux endroits.
       */
      rapport_ventes: {
        Args: {
          p_restaurant: string
          p_debut: string
          p_fin: string
          p_timezone?: string
          /** Intervalle PostgreSQL, « 04:00:00 ». */
          p_bascule?: string
          p_employe?: string | null
          p_heure_debut?: number
          p_heure_fin?: number
        }
        Returns: unknown
      }
    }
    Enums: Aucun
    CompositeTypes: Aucun
  }
}
