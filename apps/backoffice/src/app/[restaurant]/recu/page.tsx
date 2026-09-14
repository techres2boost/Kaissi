/**
 * Paramètres → Reçu.
 *
 * L'en-tête et le pied du ticket CLIENT. Les reçus déjà émis se consultent
 * dans « Rapports → Reçus » ; ici on règle ce qui s'imprimera demain.
 */

import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ReglagesRecu } from '../../../composants/ReglagesRecu.js'

export const dynamic = 'force-dynamic'

export default async function PageRecu({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const { data, error } = await supabase
    .from('restaurants')
    .select('name, address, phone, fiscal_id, receipt_footer')
    .eq('id', restaurant)
    .single()

  return (
    <>
      <h1>Reçu</h1>
      <p className="sous-titre">
        Ce qui s’imprime en haut et en bas du ticket client. Les valeurs
        descendent aux caisses comme un changement de prix — les tickets déjà
        imprimés ne changent pas.
      </p>

      {error && <p className="message erreur">Lecture impossible : {error.message}</p>}

      <ReglagesRecu
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        recu={{
          nom: (data?.name as string | undefined) ?? etablissement.nom,
          adresse: (data?.address as string | null | undefined) ?? null,
          telephone: (data?.phone as string | null | undefined) ?? null,
          fiscal: (data?.fiscal_id as string | null | undefined) ?? null,
          pied: (data?.receipt_footer as string | null | undefined) ?? null,
        }}
      />
    </>
  )
}
