/**
 * L'ancienne adresse des reçus.
 *
 * L'écran « Tickets » s'appelle désormais « Reçus » (§13.6 du cahier de
 * charges, et le mot de Loyverse). Renommer une route casse les favoris et
 * les liens déjà envoyés par messagerie : cette page-ci n'existe que pour
 * les rattraper, en conservant la période et le ticket demandés.
 *
 * Elle disparaîtra quand plus personne ne l'atteindra.
 */

import { redirect } from 'next/navigation'
import { destinationSure } from '../../../serveur/redirection.js'

export default async function PageTicketsHeritee({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { restaurant } = await params
  const recherche = await searchParams
  const parametres = new URLSearchParams(
    Object.entries(recherche).filter((e): e is [string, string] => e[1] !== undefined),
  )
  const requete = parametres.toString()
  redirect(destinationSure(`/${restaurant}/recus${requete ? `?${requete}` : ''}`))
}
