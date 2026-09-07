import { PLAFOND_COMMANDES } from '../serveur/ventes.js'

/**
 * « Ce rapport est incomplet » — dit, jamais tu.
 *
 * ── Pourquoi ce composant existe ──────────────────────────────────────────
 *
 * Un rapport ne charge qu'un nombre borné de commandes (voir
 * `PLAFOND_COMMANDES`). Sans cette limite, une période d'un an sur un
 * établissement chargé rendait 73 000 commandes et ~220 000 lignes dans une
 * fonction serverless : mémoire et délai dépassés, donc une erreur 500 sans
 * explication sur l'écran des chiffres d'affaires.
 *
 * Mais tronquer en SILENCE est pire que l'erreur. Un chiffre d'affaires
 * amputé ressemble exactement à un chiffre d'affaires complet : il ne
 * déclenche aucun soupçon, on l'exporte, on le porte à son comptable. Une
 * erreur, au moins, se voit.
 *
 * D'où cette bannière, à afficher AVANT les totaux et non en note de bas de
 * page : ce qu'elle annonce change la lecture de tout ce qui suit.
 */
export function AvertissementTronque({ tronque }: { tronque: boolean }) {
  if (!tronque) return null
  return (
    <p className="message avertissement" role="status">
      <strong>Ce rapport est incomplet.</strong> La période choisie dépasse{' '}
      {PLAFOND_COMMANDES.toLocaleString('fr-FR')} ventes : seules les plus
      récentes sont comptées. Les totaux ci-dessous ne portent donc PAS sur
      toute la période. Choisissez une période plus courte — un mois, un
      trimestre — pour obtenir des chiffres complets.
    </p>
  )
}
