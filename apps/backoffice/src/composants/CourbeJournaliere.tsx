/**
 * Le chiffre d'affaires jour par jour, en colonnes.
 *
 * ── Pourquoi des colonnes et non une courbe ───────────────────────────────
 *
 * Une courbe relie les points, et cette liaison affirme quelque chose : que
 * la valeur existe ENTRE deux mesures. C'est vrai d'une température, faux
 * d'un chiffre d'affaires quotidien — il n'y a rien entre mardi et mercredi.
 * Sur une période courte (une semaine, un mois), les colonnes disent la
 * bonne chose : des grandeurs séparées, qu'on compare deux à deux.
 *
 * ── Une journée COMMERCIALE, pas un jour de calendrier ────────────────────
 *
 * Une vente encaissée à 1 h du matin appartient à la soirée de la veille.
 * Le regroupement suit donc la bascule de l'établissement, exactement comme
 * l'écran Journée — sinon le même service apparaîtrait sur deux colonnes, et
 * le samedi soir paraîtrait moitié moins bon qu'il ne l'a été.
 *
 * ── Une seule teinte ──────────────────────────────────────────────────────
 *
 * La hauteur porte la grandeur. Colorer les jours différemment n'ajouterait
 * rien, et le validateur de palette refuse de toute façon un second vert
 * distinguable sur cette marque.
 */

import { formaterTND, millimes } from '@kaissi/domain'

export interface JourneeCA {
  /** « 2026-09-03 ». */
  readonly journee: string
  readonly caMillimes: number
  readonly tickets: number
}

/** « 2026-09-03 » → « mer. 3 » — assez pour se repérer, assez court pour tenir. */
function etiquetteCourte(journee: string): string {
  const [a, m, j] = journee.split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(a!, m! - 1, j!)))
}

export function CourbeJournaliere({ jours }: { jours: readonly JourneeCA[] }) {
  if (jours.length === 0) {
    return <p className="vide">Aucune vente sur cette période.</p>
  }

  // Une seule journée ne fait pas une évolution : deux colonnes côte à côte
  // suggèrent une comparaison qu'on n'a pas. Le chiffre suffit, et il est
  // déjà affiché plus haut.
  if (jours.length === 1) {
    return (
      <p className="indication">
        Une seule journée sur cette période — élargis les dates pour voir
        l’évolution.
      </p>
    )
  }

  const maximum = Math.max(...jours.map((j) => j.caMillimes)) || 1
  const total = jours.reduce((t, j) => t + j.caMillimes, 0)
  const moyenne = Math.round(total / jours.length)

  return (
    <div className="graphique-jours">
      <div className="colonnes" role="img" aria-label={`Chiffre d’affaires sur ${jours.length} jours`}>
        {jours.map((j) => {
          const hauteur = Math.max(2, (j.caMillimes / maximum) * 100)
          return (
            <div key={j.journee} className="colonne">
              {/* Le titre natif porte le détail : le survol d'une colonne
                  donne le jour, le montant et le nombre de tickets, sans
                  charger une bibliothèque pour un encart flottant. */}
              <div
                className="colonne-piste"
                title={`${etiquetteCourte(j.journee)} — ${formaterTND(
                  millimes(j.caMillimes),
                )} · ${j.tickets} ticket(s)`}
              >
                <div className="colonne-valeur" style={{ height: `${hauteur}%` }} />
              </div>
              <span className="colonne-jour">{etiquetteCourte(j.journee)}</span>
            </div>
          )
        })}
      </div>

      {/*
        La MOYENNE en toutes lettres plutôt qu'un trait sur le graphique.
        Un trait de référence sur des colonnes serrées se confond avec une
        graduation, et il faut alors une légende pour dire ce qu'il est —
        soit une ligne de plus à lire pour une information qui tient ici.
      */}
      <p className="indication">
        {jours.length} journées · {formaterTND(millimes(total))} au total ·{' '}
        <strong>{formaterTND(millimes(moyenne))}</strong> en moyenne par jour.
        Survolez une colonne pour le détail.
      </p>
    </div>
  )
}
