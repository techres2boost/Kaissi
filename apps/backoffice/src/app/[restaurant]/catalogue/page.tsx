/**
 * Catalogue — ce qui remplace les requêtes SQL directes dans Supabase.
 *
 * Une modification ici part vers les tablettes par le journal de changements
 * (`change_log`), alimenté automatiquement par un déclencheur. Elle n'est PAS
 * instantanée : une tablette hors ligne l'appliquera à sa reconnexion. C'est
 * dit à l'écran, parce qu'un gérant qui change un prix et ne le voit pas
 * apparaître en salle conclura que rien n'a marché.
 */

import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { EditeurCatalogue } from '../../../composants/EditeurCatalogue.js'

export default async function PageCatalogue({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const [{ data: categories }, { data: stations }, { data: taux }, { data: produits, error }] =
    await Promise.all([
      supabase
        .from('categories')
        .select('id, name, position')
        .eq('restaurant_id', restaurant)
        .is('archived_at', null)
        .order('position'),
      supabase
        .from('stations')
        .select('id, name')
        .eq('restaurant_id', restaurant)
        .is('archived_at', null)
        .order('position'),
      supabase
        .from('tax_rates')
        .select('id, name, rate_bp, is_included, is_default')
        .eq('restaurant_id', restaurant)
        .is('archived_at', null)
        .order('rate_bp', { ascending: false }),
      supabase
        .from('products')
        .select(
          'id, name, description, category_id, station_id, tax_rate_id, base_price_millimes, cost_per_unit, position, is_available',
        )
        .eq('restaurant_id', restaurant)
        .is('archived_at', null)
        .order('position'),
    ])

  return (
    <>
      <h1>Catalogue</h1>
      <p className="sous-titre">
        {etablissement.gestionnaire
          ? 'Une modification part vers les tablettes à leur prochaine synchronisation — pas instantanément.'
          : `Consultation seule : le rôle « ${etablissement.role} » ne modifie pas le catalogue.`}
      </p>

      {error ? <p className="message erreur">Lecture impossible : {error.message}</p> : null}

      {(taux ?? []).length === 0 && (
        <p className="message avertissement">
          Aucun taux de TVA n&apos;est configuré. Un produit ne peut pas exister sans taux —
          créez-en un avant d&apos;ajouter des produits. ⚠ Les taux applicables à la
          restauration doivent être confirmés par un expert-comptable tunisien.
        </p>
      )}

      <EditeurCatalogue
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        categories={(categories ?? []).map((c) => ({
          id: c.id as string,
          nom: c.name as string,
          position: (c.position as number) ?? 0,
        }))}
        stations={(stations ?? []).map((s) => ({ id: s.id as string, nom: s.name as string }))}
        taux={(taux ?? []).map((t) => ({
          id: t.id as string,
          nom: t.name as string,
          libelle: `${t.name} — ${formaterPourcentage(t.rate_bp as number)} %${
            t.is_included ? ' (incluse)' : ' (hors taxe)'
          }`,
          defaut: Boolean(t.is_default),
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
          // `null` reste `null` : « coût non saisi » et « coût nul » sont deux
          // états différents, et les rapports comptent le premier pour dire
          // que la marge est surestimée.
          coutUnitaire: p.cost_per_unit === null ? null : Number(p.cost_per_unit),
          position: (p.position as number) ?? 0,
          disponible: Boolean(p.is_available),
        }))}
      />
    </>
  )
}
