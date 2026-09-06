/**
 * Catégories et postes de préparation.
 *
 * Deux réglages qu'on fait une fois par saison, sortis de la liste
 * d'articles où l'on descend chercher une catégorie sous quarante produits.
 * Ils restent ensemble parce que le poste se règle SUR la catégorie
 * (migration 0025) : créer « Bar » et y rattacher « Boissons » doit tenir en
 * un écran.
 */

import { formaterTND, millimes } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { GestionCategories } from '../../../composants/GestionCategories.js'

export const dynamic = 'force-dynamic'

export default async function PageCategories({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const [{ data: categories }, { data: stations }, { data: produits }, { data: archivees }] =
    await Promise.all([
      supabase
        .from('categories')
        .select('id, name, position, station_id')
        .eq('restaurant_id', restaurant)
        .is('archived_at', null)
        .order('position'),
      supabase
        .from('stations')
        .select('id, name, position')
        .eq('restaurant_id', restaurant)
        .is('archived_at', null)
        .order('position'),
      // Les produits ne servent ici qu'à COMPTER ce que contient chaque
      // catégorie : c'est ce compte qui dit si une catégorie est vide, donc
      // si on peut l'archiver sans rien casser.
      supabase
        .from('products')
        .select(
          'id, name, description, category_id, station_id, tax_rate_id, base_price_millimes, cost_per_unit, position, is_available',
        )
        .eq('restaurant_id', restaurant)
        .is('archived_at', null)
        .order('position'),
      supabase
        .from('categories')
        .select('id, name, position, station_id')
        .eq('restaurant_id', restaurant)
        .not('archived_at', 'is', null)
        .order('name'),
    ])

  const versCategorie = (c: {
    id: string
    name: string
    position: number | null
    station_id: string | null
  }) => ({
    id: c.id,
    nom: c.name,
    position: c.position ?? 0,
    stationId: c.station_id,
  })

  return (
    <>
      <h1>Catégories</h1>
      <p className="sous-titre">
        {etablissement.gestionnaire
          ? 'Ranger la carte, et dire quel poste prépare quoi. Les tablettes reçoivent la modification à leur prochaine synchronisation.'
          : `Consultation seule : le rôle « ${etablissement.role} » ne modifie pas la carte.`}
      </p>

      <GestionCategories
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        categories={(categories ?? []).map(versCategorie)}
        archivees={(archivees ?? []).map(versCategorie)}
        stations={(stations ?? []).map((s) => ({
          id: s.id as string,
          nom: s.name as string,
          position: (s.position as number) ?? 0,
        }))}
        produits={(produits ?? []).map((p) => ({
          id: p.id as string,
          nom: p.name as string,
          description: (p.description as string | null) ?? '',
          categorieId: (p.category_id as string | null) ?? '',
          stationId: (p.station_id as string | null) ?? '',
          tauxId: p.tax_rate_id as string,
          prixMillimes: Number(p.base_price_millimes) || 0,
          prixAffiche: formaterTND(millimes(Number(p.base_price_millimes) || 0)),
          coutUnitaire: p.cost_per_unit === null ? null : Number(p.cost_per_unit),
          position: (p.position as number) ?? 0,
          disponible: Boolean(p.is_available),
        }))}
      />
    </>
  )
}
