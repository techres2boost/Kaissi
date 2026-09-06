/**
 * Le bandeau de tête d'un rapport : cinq nombres, et leur écart.
 *
 * ── Pourquoi cinq, et ceux-là ─────────────────────────────────────────────
 *
 * Ventes brutes → remboursements → réductions → ventes nettes → marge brute.
 * Ce n'est pas une liste, c'est une SOUSTRACTION : chaque tuile explique
 * comment on passe de la précédente à la suivante. Lues de gauche à droite,
 * elles répondent à « pourquoi le net n'est pas le brut », qui est la
 * première question de tout gérant devant un rapport.
 *
 * ── L'écart se compare à la période PRÉCÉDENTE de même longueur ───────────
 *
 * « +40 % » ne veut rien dire sans dire par rapport à quoi. Sept jours se
 * comparent aux sept jours d'avant, un mois au mois d'avant. Comparer à une
 * durée différente serait une erreur silencieuse — le chiffre paraîtrait
 * juste.
 *
 * Quand la période précédente est VIDE, on n'affiche pas « +100 % » : on
 * n'écrit rien. Un pourcentage calculé sur zéro n'est pas une progression,
 * c'est une division par zéro déguisée.
 */

import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'

export interface Indicateur {
  readonly libelle: string
  readonly valeurMillimes: number
  /** La même mesure sur la période précédente, ou `null` si on ne compare pas. */
  readonly precedentMillimes: number | null
  /** Complément court sous le nombre : « 37,4 % du CA », « 12 tickets ». */
  readonly detail?: string
  /** `true` quand une hausse est une MAUVAISE nouvelle (remboursements…). */
  readonly hausseDefavorable?: boolean
  readonly aide?: string
}

function ecart(valeur: number, precedent: number | null) {
  if (precedent === null || precedent === 0) return null
  const delta = valeur - precedent
  return { delta, partBp: Math.round((delta / Math.abs(precedent)) * 10_000) }
}

export function BandeauIndicateurs({ indicateurs }: { indicateurs: readonly Indicateur[] }) {
  return (
    <div className="bandeau-indicateurs">
      {indicateurs.map((i) => {
        const e = ecart(i.valeurMillimes, i.precedentMillimes)
        const favorable = e === null ? null : i.hausseDefavorable ? e.delta < 0 : e.delta > 0
        return (
          <div key={i.libelle} className="indicateur" title={i.aide}>
            <span className="indicateur-libelle">
              {i.libelle}
              {i.aide && (
                <abbr title={i.aide} aria-label={i.aide}>
                  ⓘ
                </abbr>
              )}
            </span>
            <span className="indicateur-valeur">
              {formaterTND(millimes(Math.round(i.valeurMillimes)))}
            </span>
            {e === null ? (
              <span className="indicateur-ecart neutre">{i.detail ?? '—'}</span>
            ) : (
              <span className={`indicateur-ecart ${favorable ? 'hausse' : 'baisse'}`}>
                {e.delta >= 0 ? '+' : '−'}
                {formaterTND(millimes(Math.abs(Math.round(e.delta))))} (
                {e.delta >= 0 ? '+' : '−'}
                {formaterPourcentage(Math.abs(e.partBp))} %)
              </span>
            )}
            {e !== null && i.detail && <span className="indicateur-detail">{i.detail}</span>}
          </div>
        )
      })}
    </div>
  )
}
