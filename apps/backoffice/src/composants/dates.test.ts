import { describe, expect, it } from 'vitest'
import { enFrancais, grilleDuMois, lundiDe, versDate, versJournee } from './dates.js'

describe('la grille d’un mois', () => {
  it('commence toujours un LUNDI', () => {
    // Sept colonnes qui glissent d'un jour, et le mardi s'affiche sous « L ».
    // Personne ne le remarque avant d'avoir comparé un total hebdomadaire.
    for (const [a, m] of [
      [2026, 0],
      [2026, 8],
      [2026, 11],
      [2024, 1],
    ] as const) {
      const cases = grilleDuMois(a, m)
      expect(versDate(cases[0]!).getUTCDay(), `${a}-${m + 1}`).toBe(1)
    }
  })

  it('contient des semaines PLEINES, et pas une de plus', () => {
    for (let mois = 0; mois < 12; mois += 1) {
      const cases = grilleDuMois(2026, mois)
      expect(cases.length % 7).toBe(0)
      expect(cases.length).toBeGreaterThanOrEqual(28)
      expect(cases.length).toBeLessThanOrEqual(42)
    }
  })

  it('contient tous les jours du mois, et aucun trou', () => {
    const cases = grilleDuMois(2026, 8) // septembre 2026, 30 jours
    for (let jour = 1; jour <= 30; jour += 1) {
      expect(cases).toContain(`2026-09-${String(jour).padStart(2, '0')}`)
    }
    // Chaque case suit la précédente d'exactement un jour.
    for (let i = 1; i < cases.length; i += 1) {
      const ecart = versDate(cases[i]!).getTime() - versDate(cases[i - 1]!).getTime()
      expect(ecart).toBe(86_400_000)
    }
  })

  it('sait qu’un février bissextile a 29 jours', () => {
    const cases = grilleDuMois(2028, 1)
    expect(cases).toContain('2028-02-29')
    expect(cases).not.toContain('2027-02-29')
  })

  it('ne perd pas la dernière semaine d’un mois qui commence un dimanche', () => {
    // Le cas limite : le lundi de départ est SIX jours avant le 1er, et le
    // mois déborde alors sur une sixième ligne.
    const cases = grilleDuMois(2026, 10) // novembre 2026 commence un dimanche
    expect(versDate(cases[0]!).getUTCDay()).toBe(1)
    expect(cases).toContain('2026-11-30')
  })
})

describe('les conversions ne dépendent d’aucun fuseau', () => {
  it('fait l’aller-retour sans décaler d’un jour', () => {
    for (const journee of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
      expect(versJournee(versDate(journee))).toBe(journee)
    }
  })

  it('trouve le lundi d’un dimanche — le pire cas', () => {
    // Avec une semaine qui commence le dimanche, ce jour-là bascule d'une
    // semaine entière. C'est l'erreur classique de `getDay()`.
    expect(versJournee(lundiDe(versDate('2026-09-06')))).toBe('2026-08-31')
    expect(versJournee(lundiDe(versDate('2026-09-07')))).toBe('2026-09-07')
  })

  it('écrit la date à la française', () => {
    expect(enFrancais('2026-09-07')).toBe('07/09/2026')
  })
})
