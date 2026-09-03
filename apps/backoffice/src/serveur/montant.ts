/**
 * Lecture défensive d'un montant venu de la base.
 *
 * `millimes()` REFUSE tout ce qui n'est pas un entier sûr — c'est voulu : sur
 * le chemin de la caisse, un montant douteux doit faire du bruit plutôt que
 * de s'arrondir en silence (règle 1).
 *
 * Mais une page de reporting n'est pas le chemin de la caisse. Ici la valeur
 * arrive de PostgREST, où elle peut être `null` (colonne jamais renseignée),
 * une chaîne (`numeric` sérialisé en texte), ou un champ absent parce qu'un
 * JSON stocké n'a pas la forme attendue. Faire remonter l'exception jusqu'à
 * Next.js fait tomber la page ENTIÈRE avec un « server-side exception » —
 * le gérant perd l'accès à toute la vente pour un seul champ manquant.
 *
 * Donc : on normalise, on affiche, et le zéro se voit à l'écran.
 */

import { millimes, type Millimes } from '@kaissi/domain'

/** Normalise en entier de millimes ; toute valeur illisible vaut 0. */
export function montant(valeur: unknown): Millimes {
  const nombre = typeof valeur === 'string' ? Number(valeur) : valeur
  if (typeof nombre !== 'number' || !Number.isFinite(nombre)) return millimes(0)
  return millimes(Math.round(nombre))
}
