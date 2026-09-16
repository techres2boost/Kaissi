/**
 * Articles → Inventaire avancé.
 *
 * ── Deux questions, un seul écran ─────────────────────────────────────────
 *
 * « Combien d'argent dort dans mes frigos ? » et « chez qui ai-je acheté
 * ça ? ». Ce sont les deux moitiés de la même conversation avec un
 * comptable, et les séparer obligerait à naviguer entre deux écrans au
 * milieu d'un rapprochement de factures.
 *
 * ── La valorisation est calculée dans `packages/domain` ───────────────────
 *
 * RÈGLE 7, et elle mord ici : `valoriserStock()` porte les trois décisions —
 * on multiplie par le coût d'ACHAT et non par le prix de vente, on n'arrondit
 * qu'au total, et un coût non saisi vaut zéro mais SE DIT. Les écrire dans
 * cette page les mettrait à un endroit où personne ne les relit, et la
 * prochaine somme les referait autrement.
 *
 * ── Le refus est CÔTÉ SERVEUR, mais il n'est pas un 404 ───────────────────
 *
 * Quand le module n'est pas ouvert, cet écran ne charge AUCUNE donnée : il
 * rend l'invitation et s'arrête là. C'est volontairement une page, et pas un
 * `notFound()` : le client sait que l'inventaire avancé existe — on le lui
 * vend — et lui rendre « introuvable » ferait conclure à une panne. Ce qui
 * compte, c'est que les lectures ne se fassent pas : une page qui afficherait
 * un cadenas par-dessus des chiffres déjà rendus ne protégerait rien.
 */

import Link from 'next/link'
import { Lock, Package, Truck } from 'lucide-react'
import { formaterTND, moduleOuvert, valoriserStock } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { abonnementDe } from '../../../serveur/abonnement.js'
import { montant } from '../../../serveur/montant.js'
import {
  GestionFournisseurs,
  type Fournisseur,
} from '../../../composants/GestionFournisseurs.js'
import { TableauValorisation, type LigneValorisee } from '../../../composants/TableauValorisation.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'

export const dynamic = 'force-dynamic'

export default async function PageInventaire({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const abonnement = await abonnementDe(etablissement.organizationId)

  if (!moduleOuvert(abonnement, 'inventaire_avance')) {
    return (
      <>
        <h1>Inventaire avancé</h1>
        <p className="sous-titre">
          Ce module n’est pas ouvert avec la formule «&nbsp;{abonnement.nom}&nbsp;».
        </p>

        <section className="carte">
          <h2>
            <Lock size={18} strokeWidth={1.9} aria-hidden="true" /> Ce qu’il ajoute
          </h2>
          <ul>
            <li>
              <strong>La valeur d’achat de votre stock</strong>, calculée au coût
              d’achat de chaque article — le chiffre qu’un comptable demande, et
              qu’aucun rapport de vente ne donne.
            </li>
            <li>
              <strong>Des fiches fournisseurs</strong>, pour rattacher une
              réception à qui l’a livrée sans retaper son nom.
            </li>
          </ul>
          <p>
            <Link href={{ pathname: `/${restaurant}/abonnement` }}>
              Voir les formules
            </Link>
          </p>
        </section>

        {/*
          Ce que le module ne ferme PAS. Sans cette phrase, un gérant qui
          tombe sur un écran verrouillé se demande ce que son abonnement lui
          retire d'autre — et la réponse est : rien de ce qui compte.
        */}
        <div className="message info">
          <strong>Le stock, lui, reste entier.</strong> Comptages, mouvements,
          seuils d’alerte et retrait automatique de la carte continuent de
          fonctionner dans{' '}
          <Link href={{ pathname: `/${restaurant}/stock` }}>Stock</Link>, quelle
          que soit votre formule — et la caisse encaisse hors ligne comme
          toujours. Ce module ajoute une lecture comptable, il ne conditionne
          aucun geste de service.
        </div>
      </>
    )
  }

  const supabase = await supabaseServeur()
  const [produitsRes, stockRes, fournisseursRes, receptionsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, category_id, cost_per_unit')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null),
    supabase
      .from('stock_actuel')
      .select('product_id, qty_on_hand')
      .eq('restaurant_id', restaurant),
    supabase
      .from('suppliers')
      .select('id, name, contact, phone, note, archived_at')
      .eq('restaurant_id', restaurant)
      .order('name'),
    /*
     * Le NOMBRE de réceptions par fiche, et non leur contenu.
     *
     * C'est ce qu'on perdrait des yeux en archivant une fiche, et c'est la
     * seule information dont la ligne a besoin. Remonter les mouvements pour
     * les compter en JavaScript coûterait des milliers de lignes sur un
     * établissement chargé — le défaut que la migration 0033 a corrigé
     * ailleurs.
     */
    supabase
      .from('stock_movements')
      .select('supplier_id')
      .eq('restaurant_id', restaurant)
      .not('supplier_id', 'is', null),
  ])

  const erreur = produitsRes.error ?? stockRes.error ?? fournisseursRes.error
  const quantites = new Map(
    (stockRes.data ?? []).map((s) => [s.product_id, Number(s.qty_on_hand)]),
  )

  /*
   * Seuls les produits SUIVIS entrent dans la valorisation.
   *
   * Un produit qu'on ne compte pas n'a pas de quantité : l'inclure à zéro
   * gonflerait `lignesSansCout` de toute la carte et rendrait l'avertissement
   * illisible — il annoncerait « 120 articles sans coût » là où trois
   * articles suivis en manquent vraiment.
   */
  const lignes: LigneValorisee[] = (produitsRes.data ?? [])
    .filter((p) => quantites.has(p.id))
    .map((p) => ({
      id: p.id as string,
      nom: p.name as string,
      quantite: quantites.get(p.id) ?? 0,
      coutUnitaire: (p.cost_per_unit as number | null) ?? null,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

  const valorisation = valoriserStock(lignes)

  const receptions = new Map<string, number>()
  for (const m of receptionsRes.data ?? []) {
    const id = m.supplier_id as string
    receptions.set(id, (receptions.get(id) ?? 0) + 1)
  }

  const fournisseurs: Fournisseur[] = (fournisseursRes.data ?? []).map((f) => ({
    id: f.id as string,
    nom: f.name as string,
    contact: (f.contact as string | null) ?? null,
    telephone: (f.phone as string | null) ?? null,
    note: (f.note as string | null) ?? null,
    archive: f.archived_at !== null,
    receptions: receptions.get(f.id as string) ?? 0,
  }))

  return (
    <>
      <h1>Inventaire avancé</h1>
      <p className="sous-titre">
        Ce que votre stock vaut, et chez qui vous l’achetez.
      </p>

      {erreur && <p className="message erreur">Lecture impossible : {erreur.message}</p>}

      <section className="bloc">
        <h2>
          <Package size={18} strokeWidth={1.9} aria-hidden="true" /> Valeur d’achat
          du stock
        </h2>
        <p className="sous-titre">
          {lignes.length} article(s) suivi(s) —{' '}
          <strong>{formaterTND(montant(valorisation.valeurMillimes))}</strong>
        </p>

        {/*
          L'angle mort, AVANT le tableau et non en note de bas de page : il
          change la lecture de tout ce qui suit. Un coût non saisi n'est pas un
          coût nul, et un total qui ignorerait cinq articles en silence aurait
          exactement l'air d'un total complet.
        */}
        {valorisation.lignesSansCout > 0 && (
          <p className="message avertissement" role="status">
            <strong>
              {valorisation.lignesSansCout} article(s) sans coût d’achat saisi.
            </strong>{' '}
            Ils comptent pour zéro dans le total ci-dessus, qui est donc{' '}
            <strong>incomplet</strong> — un coût non saisi n’est pas un coût nul.
            Saisissez-les dans{' '}
            <Link href={{ pathname: `/${restaurant}/catalogue` }}>
              la liste d’articles
            </Link>
            .
          </p>
        )}

        {valorisation.lignesNegatives > 0 && (
          <p className="message avertissement" role="status">
            <strong>
              {valorisation.lignesNegatives} article(s) en quantité négative.
            </strong>{' '}
            Ils <strong>retirent</strong> de la valeur. Une quantité négative est
            le signal normal d’une réception non saisie, ou d’un comptage de
            référence à refaire — elle n’est pas bornée à zéro, parce que la
            borner ferait paraître juste un stock faux.
          </p>
        )}

        {/*
          L'export passe par la MÊME garde de module que cet écran
          (`exigerModule`, dans la route) : un export sans garde rendrait ce
          qu'on vient de retirer de l'écran.
        */}
        <BoutonsExport
          restaurantId={restaurant}
          exports={[{ quoi: 'valorisation', libelle: 'Valorisation (CSV)' }]}
        />

        <TableauValorisation lignes={lignes} />
      </section>

      <section className="bloc">
        <h2>
          <Truck size={18} strokeWidth={1.9} aria-hidden="true" /> Fournisseurs
        </h2>
        <p className="sous-titre">
          Un carnet, pas un portail d’achats. Une réception se saisit toujours
          avec un nom libre dans{' '}
          <Link href={{ pathname: `/${restaurant}/stock` }}>Stock</Link> — ces
          fiches évitent seulement de le retaper, et rattachent la réception
          quand le nom correspond.
        </p>

        {!etablissement.gestionnaire && (
          <p className="sous-titre">
            Consultation seule : le rôle «&nbsp;{etablissement.role}&nbsp;» ne
            modifie pas les fiches fournisseurs.
          </p>
        )}

        <GestionFournisseurs
          restaurantId={restaurant}
          modifiable={etablissement.gestionnaire}
          fournisseurs={fournisseurs}
        />
      </section>
    </>
  )
}
