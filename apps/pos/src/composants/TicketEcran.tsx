/**
 * Ticket À L'ÉCRAN.
 *
 * Le MVP n'imprime pas : il montre. Et il montre EXACTEMENT ce que
 * l'imprimante sortirait — la MÊME charge ESC/POS produite par
 * `@kaissi/printing`, relue par `apercuTexte`.
 *
 * Pourquoi ne pas écrire un joli gabarit HTML à la place : un second gabarit
 * « pour l'écran » divergerait du papier au premier changement, et le jour
 * où l'imprimante est branchée le client verrait deux tickets différents
 * pour la même vente. Ici, brancher l'imprimante ne change rien au contenu.
 */

import { apercuTexte } from '@kaissi/printing'

interface Props {
  readonly charge: Uint8Array
  /** Largeur du papier simulée : 42 colonnes = 80 mm, 32 = 58 mm. */
  readonly largeur?: 32 | 42
}

export function TicketEcran({ charge, largeur = 42 }: Props) {
  return <pre className="ticket-ecran">{apercuTexte(charge, largeur)}</pre>
}
