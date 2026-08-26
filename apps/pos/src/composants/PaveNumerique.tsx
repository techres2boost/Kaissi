/**
 * Pavé numérique tactile.
 *
 * Une tablette de caisse n'a pas de clavier physique, et le clavier logiciel
 * Android mange la moitié de l'écran. Ce pavé est donc la seule saisie
 * numérique du POS.
 */

interface Props {
  readonly valeur: string
  readonly onChange: (valeur: string) => void
  readonly maxLongueur?: number
  /** Affiche une touche « , » pour saisir des millimes. */
  readonly decimale?: boolean
  readonly onValider?: () => void
  readonly libelleValider?: string
  readonly validerActif?: boolean
}

export function PaveNumerique({
  valeur,
  onChange,
  maxLongueur = 12,
  decimale = false,
  onValider,
  libelleValider = 'Valider',
  validerActif = true,
}: Props) {
  const taper = (touche: string) => {
    if (touche === ',' && (!decimale || valeur.includes(','))) return
    if (valeur.length >= maxLongueur) return
    // Pas de zéro de tête inutile : « 0 » puis « 5 » donne « 5 », pas « 05 ».
    if (valeur === '0' && touche !== ',') {
      onChange(touche)
      return
    }
    onChange(valeur + touche)
  }

  return (
    <div className="pave">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((t) => (
        <button key={t} type="button" onClick={() => taper(t)}>
          {t}
        </button>
      ))}
      <button
        type="button"
        onClick={() => taper(',')}
        disabled={!decimale}
        className={decimale ? '' : 'inactif'}
      >
        ,
      </button>
      <button type="button" onClick={() => taper('0')}>
        0
      </button>
      <button
        type="button"
        className="effacer"
        onClick={() => onChange(valeur.slice(0, -1))}
        aria-label="Effacer le dernier chiffre"
      >
        ⌫
      </button>
      {onValider && (
        <button
          type="button"
          className="valider"
          onClick={onValider}
          disabled={!validerActif}
        >
          {libelleValider}
        </button>
      )}
    </div>
  )
}
