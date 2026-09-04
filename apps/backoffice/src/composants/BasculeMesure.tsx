/**
 * « Par chiffre d'affaires » / « Par quantité ».
 *
 * Deux LIENS et non un menu déroulant : le choix se voit sans ouvrir quoi
 * que ce soit, et il tient dans l'URL — donc il se partage, se met en
 * favori, et survit à un rechargement. Un état gardé en mémoire de page se
 * perdrait au premier retour arrière.
 *
 * Les bornes de période voyagent avec : sans elles, changer de mesure
 * ramènerait silencieusement à la période par défaut.
 */

import Link from 'next/link'
import { destinationSure } from '../serveur/redirection.js'

export function BasculeMesure({
  restaurantId,
  du,
  au,
  mesure,
}: {
  restaurantId: string
  du: string
  au: string
  mesure: 'ca' | 'quantite'
}) {
  const lien = (valeur: 'ca' | 'quantite') =>
    destinationSure(`/${restaurantId}/articles?du=${du}&au=${au}&mesure=${valeur}`)

  return (
    <nav className="bascule" aria-label="Classer par">
      <Link href={lien('ca')} className={mesure === 'ca' ? 'actif' : ''}>
        Par chiffre d’affaires
      </Link>
      <Link href={lien('quantite')} className={mesure === 'quantite' ? 'actif' : ''}>
        Par quantité
      </Link>
    </nav>
  )
}
