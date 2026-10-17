/**
 * Français ou arabe — le réglage de langue de CE terminal.
 *
 * Chaque langue est écrite DANS cette langue (« Français », « العربية ») :
 * celui qui ne lit pas la langue affichée reconnaît quand même la sienne.
 * C'est la seule façon de rendre ce bouton trouvable par la personne qui
 * en a besoin.
 *
 * `compact` ne montre que l'AUTRE langue — un seul bouton, pour le bandeau
 * de l'écran d'accueil et de la prise de poste, où la place compte à 320 px.
 * Le tiroir, lui, montre les deux, avec la langue courante marquée.
 */

import { LANGUES, NOM_LANGUE } from '@kaissi/i18n'
import { Languages } from 'lucide-react'
import { changerLangue, langue, t } from '../i18n.js'

export function ChoixLangue({ compact = false }: { readonly compact?: boolean }) {
  if (compact) {
    const autre = LANGUES.find((l) => l !== langue) ?? langue
    return (
      <button
        type="button"
        className="choix-langue compact"
        lang={autre}
        onClick={() => changerLangue(autre)}
        aria-label={t('Changer de langue')}
        title={t('Changer de langue')}
      >
        <Languages size={16} strokeWidth={2} aria-hidden="true" />
        <span>{NOM_LANGUE[autre]}</span>
      </button>
    )
  }
  return (
    <div className="choix-langue" role="group" aria-label={t('Langue')}>
      {LANGUES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          className={l === langue ? 'actif' : ''}
          aria-pressed={l === langue}
          onClick={() => changerLangue(l)}
        >
          {NOM_LANGUE[l]}
        </button>
      ))}
    </div>
  )
}
