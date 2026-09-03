import { describe, expect, it } from 'vitest'
import { montant } from './montant.js'

describe('montant', () => {
  it('laisse passer un entier de millimes', () => {
    expect(montant(24_500)).toBe(24_500)
  })

  it('lit un bigint sérialisé en chaîne par PostgREST', () => {
    expect(montant('24500')).toBe(24_500)
  })

  it('rend 0 plutôt que de faire tomber la page sur une valeur absente', () => {
    // Le cas vécu : `tax_breakdown` porte `baseHtMillimes`, la page lisait
    // `baseMillimes` — `millimes(undefined)` faisait tomber tout le détail
    // du ticket.
    expect(montant(undefined)).toBe(0)
    expect(montant(null)).toBe(0)
    expect(montant('')).toBe(0)
    expect(montant('abc')).toBe(0)
    expect(montant(Number.NaN)).toBe(0)
    expect(montant(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('arrondit une décimale au lieu de la refuser', () => {
    expect(montant(24_500.4)).toBe(24_500)
  })

  it('conserve un montant négatif — un remboursement en est un', () => {
    expect(montant(-1_500)).toBe(-1_500)
  })
})
