import Link from 'next/link'
import { libelleJournee } from '../serveur/journee.js'
import type { Periode } from '../serveur/ventes.js'

/**
 * « Votre formule ne remonte pas si loin » — dit, et pas deviné.
 *
 * ── Pourquoi un bandeau distinct de `AvertissementTronque` ────────────────
 *
 * Les deux disent qu'un rapport ne couvre pas la période demandée, mais pour
 * des raisons OPPOSÉES, qui appellent des gestes opposés :
 *
 *   • le plafond technique (92 jours, 20 000 ventes) invite à RACCOURCIR la
 *     période ;
 *   • la formule, elle, ne bouge pas si l'on raccourcit — il faut en changer.
 *
 * Un message unique pour les deux ferait raccourcir la période à quelqu'un
 * dont le problème est ailleurs, et il conclurait au bout de trois essais que
 * l'écran est cassé.
 *
 * ── Il dit une DATE, pas « deux mois » ────────────────────────────────────
 *
 * « Votre formule remonte au 15 juillet 2026 » se vérifie d'un coup d'œil
 * contre la période affichée juste au-dessus. « Deux mois d'historique »
 * oblige à faire le calcul, et on se trompe d'un jour ou deux — assez pour
 * croire à un bug quand le total ne colle pas.
 */
export function AvertissementFormule({
  restaurantId,
  periode,
}: {
  restaurantId: string
  periode: Periode
}) {
  if (!periode.limiteeParFormule) return null
  return (
    <p className="message avertissement" role="status">
      <strong>Votre formule limite l’historique.</strong> Ce rapport commence au{' '}
      {libelleJournee(periode.du)} — les ventes antérieures existent toujours,
      elles ne sont simplement pas consultables avec la formule en cours.{' '}
      <Link href={{ pathname: `/${restaurantId}/abonnement` }}>
        Voir la formule
      </Link>
      .
    </p>
  )
}
