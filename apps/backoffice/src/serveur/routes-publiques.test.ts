/**
 * Ce qui est public l'est-il VRAIMENT, et rien d'autre ?
 *
 * Deux risques opposés, et ce test tient les deux bouts :
 *
 *   • une page qu'on croit publique et qui ne l'est pas — la politique de
 *     confidentialité derrière l'authentification rendrait un écran de
 *     connexion à Google Play, qui rejetterait la fiche pour « politique
 *     injoignable ». Le pire est qu'elle EXISTE : on la vérifie en étant
 *     connecté, elle s'affiche, et on cherche le problème ailleurs ;
 *   • une page qu'on ouvre sans le vouloir — un `startsWith` brut suffit à
 *     exposer tout un back-office à qui nomme une route habilement.
 */

import { describe, expect, it } from 'vitest'
import { CHEMINS_PUBLICS, estPublique } from './routes-publiques.js'

describe('les chemins ouverts sans session', () => {
  it('ouvre la connexion, la confidentialité et l’assistance', () => {
    expect(estPublique('/connexion')).toBe(true)
    expect(estPublique('/confidentialite')).toBe(true)
    // « Support URL » de la fiche App Store, visitée par le relecteur.
    expect(estPublique('/support')).toBe(true)
  })

  it('les pages ouvertes EXISTENT — sinon les ouvrir ne sert à rien', async () => {
    // Une liste qui autorise une page absente rend un 404 au magasin, ce qui
    // est exactement aussi rédhibitoire qu'une redirection vers la connexion.
    const { existsSync } = await import('node:fs')
    for (const page of ['confidentialite', 'support']) {
      expect(
        existsSync(new URL(`../app/${page}/page.tsx`, import.meta.url)),
        `src/app/${page}/page.tsx`,
      ).toBe(true)
    }
  })

  it('ferme tout le reste', () => {
    for (const chemin of [
      '/',
      '/administration',
      '/01930000-0000-7000-8000-000000000002/ventes',
      '/01930000-0000-7000-8000-000000000002/employes',
    ]) {
      expect(estPublique(chemin), chemin).toBe(false)
    }
  })

  it('ne se laisse pas déborder par un nom qui RESSEMBLE', () => {
    /*
     * `startsWith` brut ouvrirait ces trois-là, et personne ne le verrait
     * avant qu'un écran de gestion ne devienne lisible sans compte.
     */
    for (const piege of [
      '/confidentialite-interne',
      '/connexions-des-appareils',
      '/confidentialitehack',
      '/support-technique-interne',
    ]) {
      expect(estPublique(piege), piege).toBe(false)
    }
  })

  it('ouvre en revanche les sous-chemins légitimes', () => {
    expect(estPublique('/confidentialite/export')).toBe(true)
    expect(estPublique('/connexion/oubli')).toBe(true)
  })

  it('la liste reste COURTE — ouvrir une page est une décision', () => {
    // Si ce test tombe, ce n'est pas qu'il est trop strict : c'est qu'une
    // page de plus est devenue publique, et cela se relit.
    expect(CHEMINS_PUBLICS).toHaveLength(3)
  })

  it('le middleware utilise bien ce garde, et pas son ancien `startsWith`', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8')
    expect(source).toContain('estPublique(requete.nextUrl.pathname)')
    expect(source, 'l’ancien test en ligne doit avoir disparu').not.toContain(
      "pathname.startsWith('/connexion')",
    )
  })
})
