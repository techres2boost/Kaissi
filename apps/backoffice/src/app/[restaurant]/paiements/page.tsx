/**
 * Paramètres → Modes de paiement.
 *
 * Le RÉFÉRENTIEL, pas la mesure : ce que la caisse propose à l'encaissement.
 * Ce que chacun a encaissé se lit dans « Ventes par mode de paiement ».
 */

import Link from 'next/link'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { GestionModesPaiement } from '../../../composants/GestionModesPaiement.js'

export const dynamic = 'force-dynamic'

export default async function PageModesPaiement({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const { data, error } = await supabase
    .from('payment_methods')
    .select('id, name, type, opens_drawer, position, archived_at')
    .eq('restaurant_id', restaurant)
    .order('position')

  return (
    <>
      <h1>Modes de paiement</h1>
      <p className="sous-titre">
        Ce que le caissier peut choisir à l’encaissement. Le rapport{' '}
        <Link href={{ pathname: `/${restaurant}/ventes-par-paiement` }}>
          Ventes par mode de paiement
        </Link>{' '}
        dit ce que chacun a rapporté.
      </p>

      {error && <p className="message erreur">Lecture impossible : {error.message}</p>}

      <GestionModesPaiement
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        modes={(data ?? []).map((m) => ({
          id: m.id as string,
          nom: m.name as string,
          type: m.type as string,
          ouvreTiroir: (m.opens_drawer as boolean | null) ?? false,
          archive: m.archived_at !== null,
        }))}
      />
    </>
  )
}
