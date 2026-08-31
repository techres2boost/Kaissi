import { describe, expect, it } from 'vitest'
import { millimes, formaterPourcentage } from './monnaie.js'
import {
  calculerMarge,
  coutLigneExact,
  margeProduit,
  panierMoyen,
  totaliserCouts,
} from './marge.js'

describe('coût unitaire — la seule exception au tout-entier', () => {
  it("n'arrondit PAS ligne par ligne : c'est le total qui est arrondi", () => {
    // 3 lignes à 0,4 millime. Arrondies séparément : 0 + 0 + 0 = 0.
    // Accumulées puis arrondies : 1,2 → 1. La différence est tout l'objet
    // de numeric(18,6) sur cost_per_unit.
    const exacts = [coutLigneExact(0.4, 1), coutLigneExact(0.4, 1), coutLigneExact(0.4, 1)]
    expect(totaliserCouts(exacts)).toBe(1)
  })

  it('multiplie un coût fractionnaire par une quantité décimale', () => {
    // 250 g de mozzarella à 0,0125 millime le gramme.
    expect(coutLigneExact(0.0125, 250)).toBeCloseTo(3.125, 6)
    expect(totaliserCouts([coutLigneExact(0.0125, 250)])).toBe(3)
  })

  it('traite un coût non renseigné comme nul, sans exploser', () => {
    expect(coutLigneExact(null, 3)).toBe(0)
    expect(coutLigneExact(undefined, 3)).toBe(0)
    expect(totaliserCouts([])).toBe(0)
  })
})

describe('marge', () => {
  it("l'exemple du cahier des charges : 15 de prix, 10 de coût → 5 et 33,33 %", () => {
    const m = calculerMarge(millimes(15000), millimes(10000))
    expect(m.margeMillimes).toBe(5000)
    expect(m.margeBp).toBe(3333)
    expect(formaterPourcentage(m.margeBp!)).toBe('33,33')
  })

  it('rend une marge NÉGATIVE quand on vend à perte, sans la masquer', () => {
    // Un plancher à zéro cacherait exactement ce qu'il faut voir.
    const m = calculerMarge(millimes(8000), millimes(10000))
    expect(m.margeMillimes).toBe(-2000)
    expect(m.margeBp).toBe(-2500)
  })

  it('rend null — et non 0 % — quand le CA est nul', () => {
    // « 0 % » se lirait comme une marge nulle sur des ventes réelles.
    expect(calculerMarge(millimes(0), millimes(0)).margeBp).toBeNull()
    expect(calculerMarge(millimes(0), millimes(500)).margeMillimes).toBe(-500)
  })

  it('marge de 100 % quand le coût est nul (service, boisson offerte au coût)', () => {
    expect(calculerMarge(millimes(4200), millimes(0)).margeBp).toBe(10000)
  })

  it('rapporte la marge au CA, pas au coût', () => {
    // Sur le coût, 5000/10000 donnerait 50 %. La convention des logiciels de
    // caisse est le CA : 5000/15000 = 33,33 %.
    expect(calculerMarge(millimes(15000), millimes(10000)).margeBp).toBe(3333)
  })
})

describe('panier moyen', () => {
  it('divise le CA par le nombre de tickets, arrondi au millime', () => {
    expect(panierMoyen(millimes(100000), 3)).toBe(33333)
  })

  it('rend null sans ticket plutôt qu’une division par zéro', () => {
    expect(panierMoyen(millimes(0), 0)).toBeNull()
    expect(panierMoyen(millimes(5000), 0)).toBeNull()
  })
})

describe('margeProduit — ce que le catalogue affiche', () => {
  it('calcule la marge unitaire depuis le prix et le coût saisis', () => {
    const m = margeProduit(millimes(15000), 10000)
    expect(m.margeMillimes).toBe(5000)
    expect(m.margeBp).toBe(3333)
  })

  it('sans coût saisi, la marge vaut le prix entier — et se voit comme telle', () => {
    const m = margeProduit(millimes(15000), null)
    expect(m.coutMillimes).toBe(0)
    expect(m.margeBp).toBe(10000)
  })
})
