import { describe, expect, it } from 'vitest'
import {
  additionner,
  appliquerPointsDeBase,
  arrondirCommercial,
  depuisDecimal,
  ErreurMonnaie,
  extraireTaxeIncluse,
  formaterTND,
  millimes,
  multiplier,
  pointsDeBase,
  pourcentEnPointsDeBase,
  versDecimal,
} from './monnaie.js'

describe('millimes — le garde-fou anti-flottant', () => {
  it('accepte un entier', () => {
    expect(millimes(24500)).toBe(24500)
  })

  it('REFUSE un flottant : c est le piège principal du TND', () => {
    expect(() => millimes(24.5)).toThrow(ErreurMonnaie)
    expect(() => millimes(0.1 + 0.2)).toThrow(ErreurMonnaie)
  })

  it('refuse NaN et Infinity', () => {
    expect(() => millimes(Number.NaN)).toThrow(ErreurMonnaie)
    expect(() => millimes(Number.POSITIVE_INFINITY)).toThrow(ErreurMonnaie)
  })

  it('refuse une multiplication par une quantité fractionnaire', () => {
    expect(() => multiplier(millimes(1000), 1.5)).toThrow(ErreurMonnaie)
  })
})

describe('conversion décimale ↔ millimes (3 décimales)', () => {
  it('convertit les écritures usuelles du dinar', () => {
    expect(depuisDecimal('24,500')).toBe(24500)
    expect(depuisDecimal('24.5')).toBe(24500)
    expect(depuisDecimal('0,001')).toBe(1)
    expect(depuisDecimal('1')).toBe(1000)
    expect(depuisDecimal(3.25)).toBe(3250)
  })

  it('n interprète JAMAIS un montant comme des centimes', () => {
    // Le piège : une bibliothèque « centimes ×100 » rendrait 2450.
    expect(depuisDecimal('24.50')).toBe(24500)
  })

  it('arrondit au millime le chiffre excédentaire', () => {
    expect(depuisDecimal('1.2345')).toBe(1235)
    expect(depuisDecimal('1.2344')).toBe(1234)
  })

  it('gère les négatifs (remboursements)', () => {
    expect(depuisDecimal('-12,750')).toBe(-12750)
  })

  it('fait un aller-retour exact', () => {
    for (const v of [0, 1, 999, 1000, 24500, 1234567]) {
      expect(depuisDecimal(versDecimal(millimes(v)))).toBe(v)
    }
  })

  it('refuse une saisie illisible', () => {
    expect(() => depuisDecimal('12,5 TND')).toThrow(ErreurMonnaie)
  })
})

describe('formatage français', () => {
  it('affiche trois décimales et le séparateur virgule', () => {
    expect(formaterTND(millimes(24500))).toBe('24,500 TND')
    expect(formaterTND(millimes(1))).toBe('0,001 TND')
    // Espace FINE insécable entre les milliers (U+202F).
    expect(formaterTND(millimes(1234567))).toBe('1\u202f234,567 TND')
    expect(formaterTND(millimes(-500), { symbole: false })).toBe('-0,500')
  })
})

describe('arrondi commercial', () => {
  it('arrondit le demi vers le haut en valeur absolue, symétriquement', () => {
    expect(arrondirCommercial(2.5)).toBe(3)
    expect(arrondirCommercial(-2.5)).toBe(-3)
    expect(arrondirCommercial(2.4)).toBe(2)
    expect(arrondirCommercial(-2.4)).toBe(-2)
    expect(arrondirCommercial(3.5)).toBe(4)
  })

  it('ne se comporte pas comme Math.round sur les négatifs', () => {
    // Math.round(-2.5) === -2 : asymétrique, donc inutilisable pour de l'argent.
    expect(arrondirCommercial(-2.5)).not.toBe(Math.round(-2.5))
  })
})

describe('taux en points de base', () => {
  it('convertit un pourcentage', () => {
    expect(pourcentEnPointsDeBase(19)).toBe(1900)
    expect(pourcentEnPointsDeBase(13)).toBe(1300)
    expect(pourcentEnPointsDeBase(7)).toBe(700)
  })

  it('refuse un taux négatif ou fractionnaire', () => {
    expect(() => pointsDeBase(-100)).toThrow(ErreurMonnaie)
    expect(() => pointsDeBase(19.5)).toThrow(ErreurMonnaie)
  })

  it('applique un taux avec arrondi commercial', () => {
    // 24,500 × 19 % = 4,655 exactement
    expect(appliquerPointsDeBase(millimes(24500), pointsDeBase(1900))).toBe(4655)
    // 1,000 × 7 % = 0,070
    expect(appliquerPointsDeBase(millimes(1000), pointsDeBase(700))).toBe(70)
    // 3,333 × 19 % = 0,63327 → 0,633
    expect(appliquerPointsDeBase(millimes(3333), pointsDeBase(1900))).toBe(633)
    // 1,500 × 19 % = 0,285 exactement (pas d'arrondi)
    expect(appliquerPointsDeBase(millimes(1500), pointsDeBase(1900))).toBe(285)
  })
})

describe('TVA incluse dans le prix', () => {
  it('décompose un TTC sans jamais perdre de millime', () => {
    const ttc = millimes(11900)
    const { baseHT, taxe } = extraireTaxeIncluse(ttc, pointsDeBase(1900))
    expect(baseHT).toBe(10000)
    expect(taxe).toBe(1900)
    expect(additionner(baseHT, taxe)).toBe(ttc)
  })

  it('garantit base + taxe = TTC pour tous les montants, sans exception', () => {
    for (const bp of [700, 1300, 1900]) {
      for (let ttc = 1; ttc <= 3000; ttc += 1) {
        const { baseHT, taxe } = extraireTaxeIncluse(millimes(ttc), pointsDeBase(bp))
        expect(baseHT + taxe).toBe(ttc)
      }
    }
  })
})
