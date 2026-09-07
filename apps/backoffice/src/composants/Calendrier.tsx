'use client'

/**
 * Le calendrier de période — on CLIQUE une date, on ne la tape pas.
 *
 * ── Pourquoi remplacer `<input type="date">` ──────────────────────────────
 *
 * Il marchait, et c'est précisément ce qui le rendait trompeur. Le champ natif
 * affiche « 09/07/2026 » et attend qu'on le saisisse au clavier ; son
 * calendrier existe, mais derrière une icône de quinze pixels que personne ne
 * voit. Or la question qu'on se pose devant un rapport n'est jamais « quelle
 * date sommes-nous » — c'est « la semaine dernière », « le week-end »,
 * « du 3 au 12 ». Ces questions se répondent sur une grille de mois, où l'on
 * voit les samedis et les fins de mois. Sur un champ texte, il faut d'abord
 * les traduire en chiffres.
 *
 * ── Une seule sélection, en deux clics ────────────────────────────────────
 *
 * Premier clic : le début. Second : la fin, et la période s'applique. Cliquer
 * une date antérieure au début recommence — plutôt que de refuser, ce qui
 * obligerait à comprendre pourquoi.
 *
 * ── Ce qui est INTERDIT, et pourquoi ──────────────────────────────────────
 *
 * L'avenir. Un rapport sur demain n'a pas de sens, et une période qui s'y
 * étend rend des totaux justes sur une durée fausse : la comparaison à la
 * période précédente devient alors incompréhensible. La borne est la journée
 * COMMERCIALE en cours, pas la date du navigateur — à 2 h du matin, on
 * travaille encore sur la veille.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { enFrancais, grilleDuMois, versDate, JOURS, MOIS } from './dates.js'

export function Calendrier({
  du,
  au,
  aujourdhui,
  onChoisir,
}: {
  du: string
  au: string
  /** La journée COMMERCIALE en cours — jamais `new Date()` du navigateur. */
  aujourdhui: string
  onChoisir: (du: string, au: string) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  /** Le mois affiché, ancré sur le début de la période en cours. */
  const [ancre, setAncre] = useState(() => versDate(du))
  /** Début d'une sélection en cours ; nul entre deux sélections. */
  const [debut, setDebut] = useState<string | null>(null)
  /** La case survolée, pour montrer la période AVANT de la valider. */
  const [survol, setSurvol] = useState<string | null>(null)
  const boite = useRef<HTMLDivElement>(null)
  const idPanneau = useId()

  // Rouvrir sur le mois de la période courante : après un « 30 derniers
  // jours », le calendrier doit s'ouvrir là où on l'a laissé, pas sur le mois
  // d'il y a trois clics.
  useEffect(() => {
    if (ouvert) {
      setAncre(versDate(du))
      setDebut(null)
      setSurvol(null)
    }
  }, [ouvert, du])

  /*
   * Fermer d'un clic à côté et d'un appui sur Échap.
   *
   * Les deux, et pas l'un ou l'autre : le clic est le geste à la souris, la
   * touche est le seul recours au clavier — sans elle, un panneau ouvert par
   * erreur piège la navigation.
   */
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false)
    }
    const echap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    document.addEventListener('keydown', echap)
    return () => {
      document.removeEventListener('mousedown', dehors)
      document.removeEventListener('keydown', echap)
    }
  }, [ouvert])

  const annee = ancre.getUTCFullYear()
  const mois = ancre.getUTCMonth()
  const cases = grilleDuMois(annee, mois)

  const choisir = (journee: string) => {
    if (journee > aujourdhui) return
    if (debut === null || journee < debut) {
      setDebut(journee)
      setSurvol(null)
      return
    }
    onChoisir(debut, journee)
    setOuvert(false)
  }

  // La période à PEINDRE : celle qu'on est en train de choisir si une
  // sélection est en cours, sinon celle qui est appliquée.
  const [peintDu, peintAu] =
    debut === null ? [du, au] : [debut, survol && survol > debut ? survol : debut]

  const moisPrecedent = () => setAncre(new Date(Date.UTC(annee, mois - 1, 1)))
  const moisSuivant = () => setAncre(new Date(Date.UTC(annee, mois + 1, 1)))
  // On ne navigue pas au-delà du mois en cours : il n'y a rien à y voir.
  const suivantPossible = `${annee}-${String(mois + 1).padStart(2, '0')}` < aujourdhui.slice(0, 7)

  return (
    <div className="calendrier" ref={boite}>
      <button
        type="button"
        className="calendrier-declencheur"
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        onClick={() => setOuvert((o) => !o)}
      >
        <span aria-hidden="true">📅</span>
        {du === au ? enFrancais(du) : `${enFrancais(du)} — ${enFrancais(au)}`}
      </button>

      {ouvert && (
        <div className="calendrier-panneau" id={idPanneau} role="dialog" aria-label="Choisir une période">
          <div className="calendrier-entete">
            <button type="button" onClick={moisPrecedent} aria-label="Mois précédent">
              ‹
            </button>
            <strong>
              {MOIS[mois]} {annee}
            </strong>
            <button
              type="button"
              onClick={moisSuivant}
              aria-label="Mois suivant"
              disabled={!suivantPossible}
            >
              ›
            </button>
          </div>

          <p className="calendrier-consigne">
            {debut === null
              ? 'Cliquez le premier jour de la période.'
              : `Depuis le ${enFrancais(debut)} — cliquez le dernier jour.`}
          </p>

          <div className="calendrier-grille" role="grid">
            {JOURS.map((j, i) => (
              // Deux « M » et deux « J » dans la semaine : la lettre seule ne
              // suffit pas à un lecteur d'écran, la clé non plus.
              <span key={`${j}-${i}`} className="calendrier-jour-entete" aria-hidden="true">
                {j}
              </span>
            ))}
            {cases.map((journee) => {
              const dansLeMois = versDate(journee).getUTCMonth() === mois
              const futur = journee > aujourdhui
              const dansLaPeriode = journee >= peintDu && journee <= peintAu
              const borne = journee === peintDu || journee === peintAu
              return (
                <button
                  key={journee}
                  type="button"
                  disabled={futur}
                  className={[
                    'calendrier-case',
                    dansLeMois ? '' : 'hors-mois',
                    dansLaPeriode ? 'dans-periode' : '',
                    borne ? 'borne' : '',
                    journee === aujourdhui ? 'aujourdhui' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => choisir(journee)}
                  onMouseEnter={() => setSurvol(journee)}
                  aria-label={enFrancais(journee)}
                  aria-current={journee === aujourdhui ? 'date' : undefined}
                >
                  {versDate(journee).getUTCDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
