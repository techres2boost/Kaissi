/**
 * Dépôt catalogue — LECTURE LOCALE UNIQUEMENT.
 *
 * L'écran de caisse lit ici, et nulle part ailleurs. Aucun appel réseau sur
 * le chemin de la caisse : ajouter un article doit rester sous les 50 ms,
 * et l'application doit fonctionner en mode avion.
 */

import type { AdaptateurSqlite } from '../adaptateur.js'

export interface CategorieLocale {
  id: string
  nom: string
  position: number
  couleur: string | null
}

export interface ProduitLocal {
  id: string
  categorieId: string | null
  stationId: string | null
  tauxTaxeId: string
  nom: string
  description: string | null
  prixBaseMillimes: number
  couleur: string | null
  position: number
  disponible: boolean
  /**
   * Pourquoi le produit est hors carte, quand il l'est.
   *
   * `'stock'` — retiré automatiquement par le serveur, stock suivi à zéro.
   * `'manuel'` — décision du gérant : « on n'en fait plus ce soir ».
   * `null` — en vente, ou motif inconnu d'un serveur antérieur.
   *
   * La caisse ne s'en sert QUE pour choisir sa phrase. Elle n'en tire aucune
   * règle : c'est `disponible` qui décide, et lui seul.
   */
  motifRetrait: 'stock' | 'manuel' | null
}

export interface TauxTaxeLocal {
  id: string
  nom: string
  tauxBp: number
  incluse: boolean
  parDefaut: boolean
}

export interface VarianteLocale {
  id: string
  produitId: string
  nom: string
  prixDeltaMillimes: number
  position: number
}

export interface ModificateurLocal {
  id: string
  groupeId: string
  groupeNom: string
  nom: string
  prixDeltaMillimes: number
  obligatoire: boolean
  minSelect: number
  maxSelect: number
}

export interface TableLocale {
  id: string
  label: string
  places: number
  zoneNom: string | null
}

export interface MethodePaiementLocale {
  id: string
  nom: string
  type: 'cash' | 'card' | 'online' | 'other'
  ouvreTiroir: boolean
  position: number
}

export function depotCatalogue(db: AdaptateurSqlite) {
  return {
    async categories(): Promise<CategorieLocale[]> {
      const lignes = await db.lire<{
        id: string
        name: string
        position: number
        color: string | null
      }>(
        `SELECT id, name, position, color FROM categories
         WHERE archived_at IS NULL ORDER BY position, name`,
      )
      return lignes.map((l) => ({
        id: l.id,
        nom: l.name,
        position: l.position,
        couleur: l.color,
      }))
    },

    async produits(categorieId?: string): Promise<ProduitLocal[]> {
      const filtre = categorieId ? 'AND category_id = ?' : ''
      const lignes = await db.lire<{
        id: string
        category_id: string | null
        station_id: string | null
        tax_rate_id: string
        name: string
        description: string | null
        base_price_millimes: number
        color: string | null
        position: number
        is_available: number
        unavailable_reason: string | null
      }>(
        `SELECT id, category_id, station_id, tax_rate_id, name, description,
                base_price_millimes, color, position, is_available,
                unavailable_reason
         FROM products
         WHERE archived_at IS NULL ${filtre}
         ORDER BY position, name`,
        categorieId ? [categorieId] : [],
      )
      return lignes.map((l) => ({
        id: l.id,
        categorieId: l.category_id,
        stationId: l.station_id,
        tauxTaxeId: l.tax_rate_id,
        nom: l.name,
        description: l.description,
        prixBaseMillimes: l.base_price_millimes,
        couleur: l.color,
        position: l.position,
        disponible: l.is_available === 1,
        motifRetrait:
          l.unavailable_reason === 'stock' || l.unavailable_reason === 'manuel'
            ? l.unavailable_reason
            : null,
      }))
    },

    async tauxTaxes(): Promise<TauxTaxeLocal[]> {
      const lignes = await db.lire<{
        id: string
        name: string
        rate_bp: number
        is_included: number
        is_default: number
      }>(
        `SELECT id, name, rate_bp, is_included, is_default FROM tax_rates
         WHERE archived_at IS NULL ORDER BY rate_bp DESC`,
      )
      return lignes.map((l) => ({
        id: l.id,
        nom: l.name,
        tauxBp: l.rate_bp,
        incluse: l.is_included === 1,
        parDefaut: l.is_default === 1,
      }))
    },

    async variantes(produitId: string): Promise<VarianteLocale[]> {
      const lignes = await db.lire<{
        id: string
        product_id: string
        name: string
        price_delta_millimes: number
        position: number
      }>(
        `SELECT id, product_id, name, price_delta_millimes, position
         FROM product_variants
         WHERE product_id = ? AND archived_at IS NULL AND is_available = 1
         ORDER BY position`,
        [produitId],
      )
      return lignes.map((l) => ({
        id: l.id,
        produitId: l.product_id,
        nom: l.name,
        prixDeltaMillimes: l.price_delta_millimes,
        position: l.position,
      }))
    },

    async modificateurs(produitId: string): Promise<ModificateurLocal[]> {
      const lignes = await db.lire<{
        id: string
        modifier_group_id: string
        groupe_nom: string
        name: string
        price_delta_millimes: number
        is_required: number
        min_select: number
        max_select: number
      }>(
        `SELECT m.id, m.modifier_group_id, g.name AS groupe_nom, m.name,
                m.price_delta_millimes, g.is_required, g.min_select, g.max_select
         FROM modifiers m
         JOIN modifier_groups g ON g.id = m.modifier_group_id
         JOIN product_modifiers pm ON pm.modifier_group_id = g.id
         WHERE pm.product_id = ? AND m.archived_at IS NULL AND m.is_available = 1
         ORDER BY g.position, m.position`,
        [produitId],
      )
      return lignes.map((l) => ({
        id: l.id,
        groupeId: l.modifier_group_id,
        groupeNom: l.groupe_nom,
        nom: l.name,
        prixDeltaMillimes: l.price_delta_millimes,
        obligatoire: l.is_required === 1,
        minSelect: l.min_select,
        maxSelect: l.max_select,
      }))
    },

    async tables(): Promise<TableLocale[]> {
      const lignes = await db.lire<{
        id: string
        label: string
        seats: number
        zone_nom: string | null
      }>(
        `SELECT t.id, t.label, t.seats, a.name AS zone_nom
         FROM tables t
         LEFT JOIN areas a ON a.id = t.area_id
         WHERE t.archived_at IS NULL
         ORDER BY a.position, CAST(t.label AS INTEGER), t.label`,
      )
      return lignes.map((l) => ({
        id: l.id,
        label: l.label,
        places: l.seats,
        zoneNom: l.zone_nom,
      }))
    },

    async methodesPaiement(): Promise<MethodePaiementLocale[]> {
      const lignes = await db.lire<{
        id: string
        name: string
        type: string
        opens_drawer: number
        position: number
      }>(
        `SELECT id, name, type, opens_drawer, position FROM payment_methods
         WHERE archived_at IS NULL AND is_active = 1 ORDER BY position`,
      )
      return lignes.map((l) => ({
        id: l.id,
        nom: l.name,
        type: l.type as MethodePaiementLocale['type'],
        ouvreTiroir: l.opens_drawer === 1,
        position: l.position,
      }))
    },

    /** Nombre de produits disponibles — sert de contrôle « le menu est là ». */
    async nombreProduits(): Promise<number> {
      const ligne = await db.lireUne<{ n: number }>(
        'SELECT COUNT(*) AS n FROM products WHERE archived_at IS NULL',
      )
      return ligne?.n ?? 0
    },
  }
}

export type DepotCatalogue = ReturnType<typeof depotCatalogue>
