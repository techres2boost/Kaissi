/**
 * Boîte de dialogue plein écran.
 *
 * Plein écran et non flottante : sur une tablette tenue à bout de bras, une
 * petite fenêtre au centre se rate une fois sur trois.
 */

import { useEffect, type ReactNode } from 'react'

interface Props {
  readonly titre: string
  readonly sousTitre?: string
  readonly onFermer?: () => void
  readonly children: ReactNode
  readonly pied?: ReactNode
  readonly large?: boolean
}

export function Modale({ titre, sousTitre, onFermer, children, pied, large }: Props) {
  useEffect(() => {
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onFermer) onFermer()
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  }, [onFermer])

  return (
    <div className="voile" role="dialog" aria-modal="true" aria-label={titre}>
      <div className={`modale ${large ? 'large' : ''}`}>
        <header>
          <div>
            <h2>{titre}</h2>
            {sousTitre && <p className="sous-titre">{sousTitre}</p>}
          </div>
          {onFermer && (
            <button type="button" className="fermer" onClick={onFermer} aria-label="Fermer">
              ✕
            </button>
          )}
        </header>
        <div className="corps">{children}</div>
        {pied && <footer>{pied}</footer>}
      </div>
    </div>
  )
}
