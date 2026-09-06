'use client'

/**
 * Le graphique d'un rapport : une série, trois formes, trois pas de temps.
 *
 * ── Une seule teinte, et c'est un choix vérifié ───────────────────────────
 *
 * La série est UNIQUE — le chiffre d'affaires de la période. Sa grandeur est
 * portée par la hauteur ; colorer les jours différemment n'ajouterait rien et
 * ferait croire à des catégories. Le validateur de palette refuse d'ailleurs
 * un second vert distinguable sur cette marque.
 *
 * ── Pourquoi le choix de la forme est laissé au lecteur ───────────────────
 *
 * Ce n'est pas de la décoration : les trois formes ne disent pas la même
 * chose. Les COLONNES sont l'honnêteté par défaut — il n'y a rien entre
 * mardi et mercredi, et une colonne l'assume. La LIGNE et les AIRES relient
 * les points, ce qui affirme une continuité qui n'existe pas ; mais sur trois
 * mois, la tendance devient la vraie question et le trait la sert mieux.
 *
 * ── Le pas de temps change le sens, pas seulement l'échelle ───────────────
 *
 * Quatre-vingt-dix colonnes sont illisibles ; les mêmes données par semaine
 * se lisent. Le regroupement part des journées COMMERCIALES déjà calculées
 * (bascule à 4 h) : une vente encaissée à 1 h du matin reste dans la soirée
 * de la veille, quel que soit le pas choisi.
 */

import { useState } from 'react'
import { formaterTND, millimes } from '@kaissi/domain'
import { agregerSerie, type Granularite, type JourneeCA } from '../serveur/rapports.js'
import { CamembertParts, type Part } from './CamembertParts.js'

type Forme = 'colonnes' | 'aires' | 'ligne' | 'circulaire'

const FORMES: { valeur: Forme; libelle: string }[] = [
  { valeur: 'colonnes', libelle: 'Colonnes' },
  { valeur: 'aires', libelle: 'Aires' },
  { valeur: 'ligne', libelle: 'Ligne' },
]

const PAS: { valeur: Granularite; libelle: string }[] = [
  { valeur: 'jours', libelle: 'Jours' },
  { valeur: 'semaines', libelle: 'Semaines' },
  { valeur: 'mois', libelle: 'Mois' },
]

export function GraphiqueSerie({
  journees,
  titre = 'Ventes brutes',
  parts,
}: {
  journees: readonly JourneeCA[]
  titre?: string
  /**
   * Les parts à répartir, quand la page en a.
   *
   * Leur présence AJOUTE « Circulaire » au menu des formes. Le camembert ne
   * répond pas à la même question que les colonnes : celles-ci disent
   * l'évolution, celui-là dit qui fait le chiffre. C'est pour cela qu'il n'a
   * pas de pas de temps — il porte sur la période entière.
   */
  parts?: readonly Part[]
}) {
  const [forme, setForme] = useState<Forme>('colonnes')
  /*
   * Le pas par défaut suit la LONGUEUR de la période.
   *
   * Quatre-vingt-dix colonnes ne se comparent pas, elles se subissent — et
   * le lecteur qui découvre l'écran ne sait pas encore qu'un menu déroulant
   * plus haut les regrouperait.
   */
  const [pas, setPas] = useState<Granularite>(
    journees.length > 62 ? 'mois' : journees.length > 21 ? 'semaines' : 'jours',
  )
  const [survole, setSurvole] = useState<number | null>(null)

  if (journees.length === 0) {
    return <p className="vide">Aucune vente sur cette période.</p>
  }

  const points = agregerSerie(journees, pas)
  const maximum = Math.max(...points.map((p) => p.caMillimes)) || 1
  const total = points.reduce((t, p) => t + p.caMillimes, 0)

  return (
    <div className="graphique-serie">
      <div className="entete-bloc">
        <h2>{titre}</h2>
        <div className="options-graphique">
          <label>
            <span className="visuellement-cache">Forme du graphique</span>
            <select value={forme} onChange={(e) => setForme(e.target.value as Forme)}>
              {FORMES.map((f) => (
                <option key={f.valeur} value={f.valeur}>
                  {f.libelle}
                </option>
              ))}
              {parts && <option value="circulaire">Circulaire</option>}
            </select>
          </label>
          {/* Le pas de temps ne s'applique qu'aux formes temporelles : le
              camembert porte sur la période entière, et proposer « Semaines »
              à côté d'un cercle poserait une question sans réponse. */}
          {forme !== 'circulaire' && (
            <label>
              <span className="visuellement-cache">Pas de temps</span>
              <select value={pas} onChange={(e) => setPas(e.target.value as Granularite)}>
                {PAS.map((p) => (
                  <option key={p.valeur} value={p.valeur}>
                    {p.libelle}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {forme === 'circulaire' && parts ? (
        <CamembertParts parts={parts} />
      ) : points.length === 1 ? (
        // Un seul seau ne fait pas une évolution : deux colonnes côte à côte
        // suggéreraient une comparaison qu'on n'a pas. Le chiffre est déjà
        // au-dessus.
        <p className="indication">
          Un seul {pas === 'jours' ? 'jour' : pas === 'semaines' ? 'semaine' : 'mois'} sur
          cette période — élargissez les dates, ou choisissez un pas plus fin.
        </p>
      ) : forme === 'colonnes' ? (
        <Colonnes points={points} maximum={maximum} survole={survole} setSurvole={setSurvole} />
      ) : (
        <Trace
          points={points}
          maximum={maximum}
          remplie={forme === 'aires'}
          survole={survole}
          setSurvole={setSurvole}
        />
      )}

      {forme === 'circulaire' ? (
        <p className="indication">
          Répartition sur toute la période. Le détail complet est dans le tableau
          ci-dessous — un camembert dit qui domine, pas combien exactement.
        </p>
      ) : (
        <p className="indication">
          {points.length} {pas} · {formaterTND(millimes(total))} au total ·{' '}
          <strong>{formaterTND(millimes(Math.round(total / points.length)))}</strong> en
          moyenne. Survolez pour le détail.
        </p>
      )}
    </div>
  )
}

interface Point {
  cle: string
  libelle: string
  caMillimes: number
  tickets: number
}

function infobulle(p: Point): string {
  return `${p.libelle} — ${formaterTND(millimes(p.caMillimes))} · ${p.tickets} ticket(s)`
}

function Colonnes({
  points,
  maximum,
  survole,
  setSurvole,
}: {
  points: readonly Point[]
  maximum: number
  survole: number | null
  setSurvole: (i: number | null) => void
}) {
  return (
    <div className="graphique-jours">
      <div className="colonnes" role="img" aria-label={`Chiffre d’affaires sur ${points.length} périodes`}>
        {points.map((p, i) => (
          <div key={p.cle} className="colonne">
            <div
              className="colonne-piste"
              title={infobulle(p)}
              onMouseEnter={() => setSurvole(i)}
              onMouseLeave={() => setSurvole(null)}
            >
              <div
                className="colonne-valeur"
                style={{ height: `${Math.max(2, (p.caMillimes / maximum) * 100)}%` }}
              />
            </div>
            <span className="colonne-jour">{p.libelle}</span>
          </div>
        ))}
      </div>
      <p className="detail" aria-live="polite">
        {survole === null ? ' ' : infobulle(points[survole]!)}
      </p>
    </div>
  )
}

/**
 * Ligne et aires, en SVG.
 *
 * Le tracé est calculé en pourcentages dans un `viewBox` fixe : le graphique
 * suit la largeur du panneau sans re-rendu au redimensionnement, et sans
 * mesurer le DOM — ce qui, sur un rendu serveur, provoquerait un saut à
 * l'hydratation.
 */
function Trace({
  points,
  maximum,
  remplie,
  survole,
  setSurvole,
}: {
  points: readonly Point[]
  maximum: number
  remplie: boolean
  survole: number | null
  setSurvole: (i: number | null) => void
}) {
  const L = 1000
  const H = 300
  const marge = 12
  const x = (i: number) =>
    points.length === 1 ? L / 2 : marge + (i * (L - 2 * marge)) / (points.length - 1)
  const y = (valeur: number) => H - marge - (valeur / maximum) * (H - 2 * marge)

  const chemin = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.caMillimes)}`).join(' ')
  const aire = `${chemin} L ${x(points.length - 1)} ${H - marge} L ${x(0)} ${H - marge} Z`

  return (
    <div className="graphique-jours">
      <svg
        viewBox={`0 0 ${L} ${H}`}
        className="trace"
        role="img"
        aria-label={`Chiffre d’affaires sur ${points.length} périodes`}
        preserveAspectRatio="none"
      >
        {/* Grille : trois repères, en trait plein et discret. Un pointillé
            ajoute du bruit et se lit comme une valeur incertaine. */}
        {[0.25, 0.5, 0.75].map((part) => (
          <line
            key={part}
            x1={0}
            x2={L}
            y1={y(maximum * part)}
            y2={y(maximum * part)}
            className="grille"
          />
        ))}
        {remplie && <path d={aire} className="aire" />}
        <path d={chemin} className="ligne" />
        {points.map((p, i) => (
          <g key={p.cle}>
            {/* Une cible de survol plus large que le point : on vise avec une
                souris, pas au pixel. */}
            <rect
              x={x(i) - (L - 2 * marge) / (points.length * 2)}
              y={0}
              width={(L - 2 * marge) / points.length}
              height={H}
              fill="transparent"
              onMouseEnter={() => setSurvole(i)}
              onMouseLeave={() => setSurvole(null)}
            >
              <title>{infobulle(p)}</title>
            </rect>
            <circle
              cx={x(i)}
              cy={y(p.caMillimes)}
              r={survole === i ? 9 : 5}
              className="point"
            />
          </g>
        ))}
      </svg>
      <div className="axe-x">
        {points.map((p, i) => (
          // Au-delà de douze repères, un sur deux : sinon les libellés se
          // chevauchent et aucun n'est lisible.
          <span key={p.cle} className={points.length > 12 && i % 2 === 1 ? 'efface' : ''}>
            {p.libelle}
          </span>
        ))}
      </div>
      <p className="detail" aria-live="polite">
        {survole === null ? ' ' : infobulle(points[survole]!)}
      </p>
    </div>
  )
}
