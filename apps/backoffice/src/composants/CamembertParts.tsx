'use client'

/**
 * Le camembert des parts — qui fait le chiffre.
 *
 * ── Pourquoi il est BORNÉ à six parts ─────────────────────────────────────
 *
 * Au-delà, les tranches deviennent des échardes qu'on ne compare plus, et
 * il faudrait autant de couleurs que d'articles — or deux teintes voisines
 * sont indiscernables pour une partie des lecteurs. Le reste est donc
 * rassemblé dans « Autres », et le TABLEAU en dessous porte le détail
 * complet. Un camembert répond à « qui domine ? », pas à « combien
 * exactement ».
 *
 * ── Pourquoi ces couleurs-là, et pas la menthe de la marque ───────────────
 *
 * Ici, les séries SONT le sujet : c'est de l'identité, pas de la grandeur.
 * Une seule teinte déclinée en six valeurs se lit très mal en camembert.
 * La palette est celle du validateur, vérifiée contre CE fond sombre
 * (#0D2B1F) :
 *
 *     node scripts/validate_palette.js "#3987e5,#d95926,#199e70,#c98500,
 *       #d4699a,#7a6ff0" --mode dark --surface "#0D2B1F"
 *     → bande de clarté, plancher de chroma, séparation daltonienne
 *       (ΔE 8,4 pire paire), plancher vision normale (18,5), contraste : tout
 *       passe.
 *
 * Chaque part porte en plus son NOM et son pourcentage : la couleur n'est
 * jamais la seule information.
 */

import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'

const TEINTES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d4699a', '#7a6ff0'] as const
const MAX_PARTS = 6

export interface Part {
  readonly cle: string
  readonly libelle: string
  readonly valeurMillimes: number
}

export function CamembertParts({ parts }: { parts: readonly Part[] }) {
  const classees = [...parts].sort((a, b) => b.valeurMillimes - a.valeurMillimes)
  const retenues = classees.slice(0, MAX_PARTS - 1)
  const reste = classees.slice(MAX_PARTS - 1)
  const affichees =
    reste.length > 0
      ? [
          ...retenues,
          {
            cle: '__autres',
            libelle: `Autres (${reste.length})`,
            valeurMillimes: reste.reduce((t, p) => t + p.valeurMillimes, 0),
          },
        ]
      : retenues

  const total = affichees.reduce((t, p) => t + p.valeurMillimes, 0)
  if (total <= 0) {
    return <p className="vide">Aucune vente à répartir sur cette période.</p>
  }

  // Un seul segment : le cercle entier n'apprend rien qu'un nombre ne dise
  // mieux. C'est l'anti-motif du camembert à deux parts, en pire.
  if (affichees.length === 1) {
    return (
      <p className="indication">
        Un seul article sur cette période — {affichees[0]!.libelle},{' '}
        {formaterTND(millimes(total))}. Une part unique ne se compare à rien.
      </p>
    )
  }

  const RAYON = 100
  let angle = -Math.PI / 2 // on part du haut, comme une horloge
  const segments = affichees.map((p, index) => {
    const portion = p.valeurMillimes / total
    const fin = angle + portion * 2 * Math.PI
    const grand = portion > 0.5 ? 1 : 0
    const x1 = RAYON + RAYON * Math.cos(angle)
    const y1 = RAYON + RAYON * Math.sin(angle)
    const x2 = RAYON + RAYON * Math.cos(fin)
    const y2 = RAYON + RAYON * Math.sin(fin)
    angle = fin
    return {
      ...p,
      portion,
      teinte: TEINTES[index % TEINTES.length]!,
      chemin: `M ${RAYON} ${RAYON} L ${x1} ${y1} A ${RAYON} ${RAYON} 0 ${grand} 1 ${x2} ${y2} Z`,
    }
  })

  return (
    <div className="camembert">
      <svg viewBox="0 0 200 200" role="img" aria-label="Répartition du chiffre d’affaires">
        {segments.map((s) => (
          <path key={s.cle} d={s.chemin} fill={s.teinte} className="part">
            <title>
              {s.libelle} — {formaterTND(millimes(s.valeurMillimes))} (
              {formaterPourcentage(Math.round(s.portion * 10_000))} %)
            </title>
          </path>
        ))}
      </svg>

      {/*
        La légende n'est pas une commodité : sans elle, l'identité d'une part
        reposerait sur la seule couleur — ce qui exclut une partie des
        lecteurs, et tous ceux qui impriment en noir et blanc.
      */}
      <ul className="legende">
        {segments.map((s) => (
          <li key={s.cle}>
            <span className="pastille" style={{ background: s.teinte }} aria-hidden="true" />
            <span className="legende-nom">{s.libelle}</span>
            <span className="legende-valeur">
              {formaterTND(millimes(s.valeurMillimes))}
              <small className="detail">
                {' '}
                {formaterPourcentage(Math.round(s.portion * 10_000))} %
              </small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
