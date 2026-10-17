/**
 * Les tests de largeur rendent les VRAIS composants, hors de toute requête
 * Next : `cookies()` n'existe pas, et `use(traduction())` suspendrait le
 * rendu. On fournit donc la langue du passage — `KAISSI_LANGUE`, français
 * par défaut — sous la forme d'une promesse DÉJÀ tenue, que `use()` lit
 * sans suspendre.
 *
 * Le script `test:largeur` passe deux fois : en français, puis en arabe. Un
 * libellé arabe plus long, ou un sens de lecture inversé, peut faire
 * déborder un écran que le français laissait tenir.
 */
import { vi } from 'vitest'
import { creerTraduction, langueDuCookie } from './commun.js'

export const LANGUE_DU_PASSAGE = langueDuCookie(process.env['KAISSI_LANGUE'])

vi.mock('./serveur.js', () => {
  const t = creerTraduction(LANGUE_DU_PASSAGE)
  const tenue = <T,>(valeur: T) =>
    Object.assign(Promise.resolve(valeur), { status: 'fulfilled', value: valeur })
  return {
    langueCourante: () => tenue(LANGUE_DU_PASSAGE),
    traduction: () => tenue(t),
  }
})
