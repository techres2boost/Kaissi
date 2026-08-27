import type { ReactNode } from 'react'
import { etablissementObligatoire } from '../../serveur/session.js'
import { Navigation } from '../../composants/Navigation.js'

export default async function LayoutEtablissement({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { session, etablissement } = await etablissementObligatoire(restaurant)

  return (
    <>
      <Navigation session={session} etablissement={etablissement} />
      <main className="enveloppe">{children}</main>
    </>
  )
}
