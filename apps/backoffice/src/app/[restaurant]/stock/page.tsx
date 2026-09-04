/**
 * Stock — quantités, seuils et alertes.
 *
 * Le stock affiché ici est CALCULÉ à la lecture par la vue
 * `kaissi.stock_actuel` : comptage de référence + mouvements manuels −
 * ventes depuis le comptage. Aucun compteur n'est muté par un déclencheur,
 * et c'est délibéré : la reprojection serveur réécrit toutes les lignes
 * d'une commande à chaque nouvel événement, ce qui ferait dériver un
 * compteur en silence. Un stock faux est pire qu'un stock absent.
 *
 * Ce stock ne bloque JAMAIS une vente — la caisse encaisse hors ligne et ne
 * consulte pas cet écran. Une quantité négative est donc possible : elle
 * signale une réception qu'on a oublié de saisir.
 */

import { formaterTND, margeProduit, millimes } from '@kaissi/domain'
import { montant } from '../../../serveur/montant.js'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { etatStock, type EtatStock } from '../../../serveur/rapports.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { HistoriqueStock, type Mouvement } from '../../../composants/HistoriqueStock.js'
import { TableauStock } from '../../../composants/TableauStock.js'
import { BoutonNotifications } from '../../../composants/BoutonNotifications.js'

export const dynamic = 'force-dynamic'

export interface ProduitStock {
  id: string
  nom: string
  categorie: string | null
  prixMillimes: number
  coutUnitaire: number | null
  margeMillimes: number
  margeBp: number | null
  suivi: boolean
  /** `false` = retiré de la carte de la caisse. */
  enVente: boolean
  /** `'manuel'` | `'stock'` | `null` — pourquoi il en est sorti. */
  motifRetrait: string | null
  /** Retirer automatiquement de la carte quand le stock atteint zéro. */
  ruptureAuto: boolean
  quantite: number | null
  seuil: number | null
  vendue: number
  compteA: string | null
  etat: EtatStock
}

export default async function PageStock({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const [produitsRes, categoriesRes, stockRes, suiviRes, mouvementsRes] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, name, category_id, base_price_millimes, cost_per_unit, track_stock, is_available, unavailable_reason, archived_at',
      )
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .order('position', { ascending: true }),
    supabase.from('categories').select('id, name').eq('restaurant_id', restaurant),
    supabase
      .from('stock_actuel')
      .select('product_id, qty_on_hand, min_qty, qty_vendue, counted_at')
      .eq('restaurant_id', restaurant),
    supabase
      .from('stock_items')
      .select('product_id, auto_rupture')
      .eq('restaurant_id', restaurant),
    /*
     * L'HISTORIQUE des mouvements manuels.
     *
     * Borné : au-delà de deux cents lignes, ce n'est plus un historique
     * qu'on parcourt, c'est un export qu'on veut. Charger tout le passé
     * d'un restaurant sur chaque affichage de l'écran Stock, pour des
     * lignes que personne ne fera défiler, coûte sans rien rendre.
     */
    supabase
      .from('stock_movements')
      .select('id, product_id, qty_delta, reason, note, supplier, created_by, created_at')
      .eq('restaurant_id', restaurant)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  if (produitsRes.error) {
    return (
      <section className="bloc">
        <h1>Stock</h1>
        <p className="message erreur">Lecture impossible : {produitsRes.error.message}</p>
      </section>
    )
  }

  const categories = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.name]))
  const stocks = new Map((stockRes.data ?? []).map((s) => [s.product_id, s]))
  const reglages = new Map((suiviRes.data ?? []).map((s) => [s.product_id, s]))

  const produits: ProduitStock[] = (produitsRes.data ?? []).map((p) => {
    const stock = stocks.get(p.id)
    const marge = margeProduit(montant(p.base_price_millimes), p.cost_per_unit)
    return {
      id: p.id,
      nom: p.name,
      categorie: p.category_id ? (categories.get(p.category_id) ?? null) : null,
      prixMillimes: p.base_price_millimes,
      coutUnitaire: p.cost_per_unit,
      margeMillimes: marge.margeMillimes,
      margeBp: marge.margeBp,
      suivi: stock !== undefined,
      enVente: p.is_available,
      motifRetrait: p.unavailable_reason,
      ruptureAuto: reglages.get(p.id)?.auto_rupture ?? true,
      quantite: stock ? Number(stock.qty_on_hand) : null,
      seuil: stock?.min_qty === null || stock?.min_qty === undefined ? null : Number(stock.min_qty),
      vendue: stock ? Number(stock.qty_vendue) : 0,
      compteA: stock?.counted_at ?? null,
      etat: etatStock(
        stock ? Number(stock.qty_on_hand) : null,
        stock?.min_qty === null || stock?.min_qty === undefined ? null : Number(stock.min_qty),
      ),
    }
  })

  // Les auteurs des mouvements, en une requête plutôt qu'une par ligne.
  // La jointure imbriquée de PostgREST ferait l'affaire, mais elle devient
  // illisible dès qu'on y ajoute un filtre, et il n'y a ici que deux cents
  // lignes au plus.
  const idsAuteurs = [
    ...new Set((mouvementsRes.data ?? []).map((m) => m.created_by).filter((i): i is string => !!i)),
  ]
  const auteursRes =
    idsAuteurs.length === 0
      ? { data: [] }
      : await supabase.from('users').select('id, full_name').in('id', idsAuteurs)
  const auteurs = new Map((auteursRes.data ?? []).map((u) => [u.id, u.full_name]))
  const nomProduit = new Map((produitsRes.data ?? []).map((p) => [p.id, p.name]))

  const mouvements: Mouvement[] = (mouvementsRes.data ?? []).map((m) => ({
    id: m.id,
    produit: nomProduit.get(m.product_id) ?? 'Produit archivé',
    delta: Number(m.qty_delta),
    raison: m.reason,
    note: m.note,
    fournisseur: m.supplier,
    auteur: m.created_by ? (auteurs.get(m.created_by) ?? null) : null,
    creeA: m.created_at,
  }))

  const ruptures = produits.filter((p) => p.etat === 'rupture')
  const faibles = produits.filter((p) => p.etat === 'faible')
  const suivis = produits.filter((p) => p.suivi)
  const valeurStock = suivis.reduce(
    (total, p) => total + (p.quantite ?? 0) * (p.coutUnitaire ?? 0),
    0,
  )

  return (
    <>
      <header className="entete-rapport">
        <h1>Stock</h1>
        <p className="sous-titre">
          Le stock se décrémente tout seul à chaque vente. Il n’empêche jamais
          d’encaisser : une quantité négative signale une réception oubliée,
          pas une erreur à corriger dans l’urgence.
        </p>
        {/*
          La clé PUBLIQUE seulement — la privée reste au service de
          synchronisation, qui est le seul à envoyer. Elle est lue à
          l'EXÉCUTION (la page est `force-dynamic`) : la poser sur
          l'hébergeur n'oblige donc pas à reconstruire le back-office.
        */}
        <BoutonNotifications
          restaurant={restaurant}
          clePublique={process.env['VAPID_PUBLIC_KEY']?.trim() || null}
        />
      </header>

      <div className="cartes-kpi">
        <div className="kpi">
          <span className="kpi-libelle">Produits comptés</span>
          <span className="kpi-valeur">
            {suivis.length} <small>/ {produits.length}</small>
          </span>
          <span className="kpi-aide">
            Saisir une quantité suffit : il n’y a pas de suivi à activer.
          </span>
        </div>
        <div className={`kpi ${ruptures.length > 0 ? 'alerte' : ''}`}>
          <span className="kpi-libelle">En rupture</span>
          <span className={`kpi-valeur ${ruptures.length > 0 ? 'negatif' : ''}`}>
            {ruptures.length}
          </span>
          <span className="kpi-aide">Quantité nulle ou négative.</span>
        </div>
        <div className={`kpi ${faibles.length > 0 ? 'attention' : ''}`}>
          <span className="kpi-libelle">Stock faible</span>
          <span className="kpi-valeur">{faibles.length}</span>
          <span className="kpi-aide">Au niveau du seuil d’alerte ou en dessous.</span>
        </div>
        <div className="kpi">
          <span className="kpi-libelle">Valeur du stock</span>
          <span className="kpi-valeur">
            {formaterTND(millimes(Math.round(valeurStock)))}
          </span>
          <span className="kpi-aide">Quantités × coût d’achat.</span>
        </div>
      </div>

      {(ruptures.length > 0 || faibles.length > 0) && (
        <section className="bloc">
          <h2>À réapprovisionner</h2>
          <ul className="liste-alertes">
            {[...ruptures, ...faibles].map((p) => (
              <li key={p.id}>
                <span className={`pastille ${p.etat}`} aria-hidden="true" />
                <strong>{p.nom}</strong>
                <span className="detail">
                  {p.quantite} restant(s){p.seuil !== null && ` · seuil ${p.seuil}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BoutonsExport
        restaurantId={restaurant}
        exports={[
          { quoi: 'stock', libelle: 'État du stock' },
          { quoi: 'mouvements', libelle: 'Historique des mouvements' },
        ]}
      />

      <TableauStock restaurantId={restaurant} produits={produits} />

      <HistoriqueStock mouvements={mouvements} />

      <p className="indication">
        Établissement : {etablissement.nom}. Le coût d’achat se saisit au{' '}
        <strong>Catalogue</strong> ; il alimente la marge affichée ici et dans
        tous les rapports.
      </p>
    </>
  )
}
