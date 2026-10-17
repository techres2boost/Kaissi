'use client'

/**
 * La langue, côté navigateur : reçue du serveur, jamais devinée.
 *
 * La racine (`app/layout.tsx`) lit le cookie et la transmet ici. Un
 * composant client ne relit pas le cookie lui-même : il est d'abord rendu
 * SUR LE SERVEUR, où `document` n'existe pas — il s'afficherait en français,
 * puis en arabe à l'hydratation, et React signalerait un écart entre les deux.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { Languages } from 'lucide-react'
import { direction, LANGUES, NOM_LANGUE, type Langue } from '@kaissi/i18n'
import { COOKIE_LANGUE, creerTraduction, langueDuCookie, type Traduction } from './commun.js'

const Contexte = createContext<Langue | null>(null)

export function FournisseurLangue({ langue, children }: { langue: Langue; children: ReactNode }) {
  return <Contexte.Provider value={langue}>{children}</Contexte.Provider>
}

/**
 * Hors de tout fournisseur — la page d'erreur globale, qui REMPLACE la
 * racine —, on lit le cookie : elle n'est rendue que dans le navigateur.
 */
function langueDuDocument(): Langue {
  if (typeof document === 'undefined') return 'fr'
  const trouve = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE_LANGUE}=`))
  return langueDuCookie(trouve?.slice(COOKIE_LANGUE.length + 1))
}

export function useT(): Traduction {
  const langue = useContext(Contexte)
  return creerTraduction(langue ?? langueDuDocument())
}

/**
 * Change la langue : un cookie d'un an, puis un rechargement complet.
 *
 * Complet et non `router.refresh()` : `lang` et `dir` sont posés sur
 * `<html>`, et le sens de lecture de TOUTE la page bascule — y compris les
 * composants clients qui ont déjà calculé leur mise en page.
 */
export function changerLangue(langue: Langue): void {
  document.cookie = `${COOKIE_LANGUE}=${langue}; path=/; max-age=31536000; samesite=lax`
  document.documentElement.lang = langue
  document.documentElement.dir = direction(langue)
  window.location.reload()
}

/**
 * Le bouton de langue. Il affiche l'AUTRE langue, écrite dans cette langue
 * (« العربية », « Français ») : qui ne lit pas la langue affichée reconnaît
 * quand même la sienne.
 */
export function ChoixLangue() {
  const t = useT()
  const autre = LANGUES.find((l) => l !== t.langue) ?? t.langue
  return (
    <button
      type="button"
      className="discret choix-langue"
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
