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
  service_rate_bp: number
  stamp_duty_millimes: Millimes
  status: string
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
  position: number
  archived_at: Horodatage | null
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
      tax_rates: Table<TauxTaxe>
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
    }
    Enums: Aucun
    CompositeTypes: Aucun
  }
}
