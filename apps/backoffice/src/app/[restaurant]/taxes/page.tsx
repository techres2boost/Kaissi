/**
 * Paramètres → Taxes.
 *
 * Le RÉFÉRENTIEL des taux, pas leur mesure : ce que la caisse applique. Ce
 * qu'ils ont rapporté se lit dans « Récapitulatif des ventes », qui ventile
 * par taux.
 */

import Link from 'next/link'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { GestionTaxes } from '../../../composants/GestionTaxes.js'

export const dynamic = 'force-dynamic'

export default async function PageTaxes({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const { data, error } = await supabase
    .from('tax_rates')
    .select('id, name, rate_bp, is_included, is_default, archived_at')
    .eq('restaurant_id', restaurant)
    .order('rate_bp')

  return (
    <>
      <h1>Taxes</h1>
      <p className="sous-titre">
        Les taux que la caisse applique. Ils descendent aux terminaux comme un
        changement de prix — les ventes déjà encaissées gardent la ventilation
        calculée au moment de la vente, et se lisent dans le{' '}
        <Link href={{ pathname: `/${restaurant}/ventes` }}>
          récapitulatif des ventes
        </Link>
        .
      </p>

      {error && <p className="message erreur">Lecture impossible : {error.message}</p>}

      <GestionTaxes
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        taux={(data ?? []).map((t) => ({
          id: t.id as string,
          nom: t.name as string,
          tauxBp: (t.rate_bp as number) ?? 0,
          incluse: t.is_included as boolean,
          parDefaut: t.is_default as boolean,
          archive: t.archived_at !== null,
        }))}
      />
    </>
  )
}
