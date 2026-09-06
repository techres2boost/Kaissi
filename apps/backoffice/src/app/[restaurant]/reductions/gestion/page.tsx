/**
 * Articles → Réductions : le référentiel.
 *
 * Le RAPPORT des réductions vit à côté (`/‹resto›/reductions`) : l'un dit ce
 * qu'on accorde, l'autre ce que cela a coûté. Les confondre en un écran
 * mélangerait un réglage et une mesure.
 */

import Link from 'next/link'
import { ecranReserve, etablissementObligatoire } from '../../../../serveur/session.js'
import { supabaseServeur } from '../../../../serveur/supabase.js'
import { GestionReductions } from '../../../../composants/GestionReductions.js'

export const dynamic = 'force-dynamic'

export default async function PageGestionReductions({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const { data, error } = await supabase
    .from('discounts')
    .select('id, name, kind, value_bp, amount_millimes, position, archived_at')
    .eq('restaurant_id', restaurant)
    .order('position')

  return (
    <>
      <h1>Réductions</h1>
      <p className="sous-titre">
        Les remises habituelles de la maison. La caisse les propose ; le{' '}
        <Link href={{ pathname: `/${restaurant}/reductions` }}>rapport</Link> dit ce
        qu’elles ont coûté.
      </p>

      {error && <p className="message erreur">Lecture impossible : {error.message}</p>}

      <GestionReductions
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        reductions={(data ?? []).map((r) => ({
          id: r.id as string,
          nom: r.name as string,
          type: (r.kind as string) === 'montant' ? 'montant' : 'pourcentage',
          valeurBp: (r.value_bp as number | null) ?? null,
          montantMillimes: (r.amount_millimes as number | null) ?? null,
          position: (r.position as number) ?? 0,
          archivee: r.archived_at !== null,
        }))}
      />
    </>
  )
}
