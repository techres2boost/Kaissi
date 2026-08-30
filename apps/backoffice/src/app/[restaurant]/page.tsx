import { redirect } from 'next/navigation'
import { etablissementObligatoire } from '../../serveur/session.js'

/**
 * Racine d'un établissement : chacun atterrit sur SON écran.
 *
 * Un cuisinier renvoyé sur le rapport de journée conclurait que le logiciel
 * ne le concerne pas — et il aurait raison, ce n'est pas son poste.
 */
export default async function RacineEtablissement({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  redirect(
    etablissement.role === 'cuisine'
      ? `/${restaurant}/cuisine`
      : `/${restaurant}/journee`,
  )
}
