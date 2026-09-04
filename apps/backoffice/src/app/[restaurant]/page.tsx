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
  // Chacun sur SON écran : la préparation (cuisine, bar) sur ses lignes,
  // l'encadrement sur les chiffres, et un caissier sur la journée — le seul
  // rapport qui le concerne, puisqu'il n'a pas accès au reste.
  redirect(
    etablissement.preparation
      ? `/${restaurant}/preparation`
      : etablissement.gestionnaire
        ? `/${restaurant}/tableau-bord`
        : `/${restaurant}/journee`,
  )
}
