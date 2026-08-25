import { describe, expect, it } from 'vitest'
import { millimes } from './monnaie.js'
import { bornerRemise, ErreurRepartition, repartirAuProrata } from './repartition.js'

const m = (n: number) => millimes(n)

describe('répartition au prorata', () => {
  it('conserve EXACTEMENT le montant réparti', () => {
    const r = repartirAuProrata(m(1000), [m(3333), m(3333), m(3334)])
    expect(r.parts.reduce<number>((s, p) => s + p, 0)).toBe(1000)
  })

  it('pousse l écart résiduel sur la DERNIÈRE ligne de poids non nul', () => {
    // 10 millimes sur 3 lignes égales : 3 + 3 + 3 = 9, résidu 1 → dernière.
    const r = repartirAuProrata(m(10), [m(100), m(100), m(100)])
    expect(r.parts).toEqual([3, 3, 4])
    expect(r.ecartResiduel).toBe(1)
    expect(r.indexAbsorbeur).toBe(2)
  })

  it('ignore les lignes de poids nul et cible la dernière ligne NON nulle', () => {
    const r = repartirAuProrata(m(10), [m(100), m(100), m(0)])
    expect(r.parts).toEqual([5, 5, 0])
    expect(r.indexAbsorbeur).toBe(1) // dernière ligne de poids non nul
    expect(r.ecartResiduel).toBe(0)
    expect(r.indicesAbsorbeurs).toEqual([])
  })

  it('NE REND JAMAIS une part supérieure à son poids — le cas qui casserait la TVA', () => {
    // Sans garde-fou, tout le résidu irait sur la dernière ligne (poids 1)
    // et rendrait sa base négative. Ici il remonte sur les lignes précédentes.
    const r = repartirAuProrata(m(3000), [m(3333), m(777), m(1)])
    expect(r.parts.every((p, i) => p <= [3333, 777, 1][i]!)).toBe(true)
    expect(r.parts.reduce<number>((s, p) => s + p, 0)).toBe(3000)
  })

  it('remonte le résidu quand la dernière ligne est saturée', () => {
    // Poids 5 et 1, montant 6 : planchers 5 et 1, aucun résidu.
    expect(repartirAuProrata(m(6), [m(5), m(1)]).parts).toEqual([5, 1])
    // Poids 999 et 1, montant 999 : plancher 998 et 0, résidu 1 → dernière (capacité 1).
    expect(repartirAuProrata(m(999), [m(999), m(1)]).parts).toEqual([998, 1])
  })

  it('refuse un montant supérieur à la somme des poids', () => {
    expect(() => repartirAuProrata(m(101), [m(50), m(50)])).toThrow(ErreurRepartition)
  })

  it('n attribue rien à une ligne offerte (poids 0)', () => {
    const r = repartirAuProrata(m(999), [m(0), m(1000), m(0)])
    expect(r.parts[0]).toBe(0)
    expect(r.parts[2]).toBe(0)
    expect(r.parts[1]).toBe(999)
  })

  it('ne répartit rien si tous les poids sont nuls', () => {
    const r = repartirAuProrata(m(500), [m(0), m(0)])
    expect(r.parts).toEqual([0, 0])
    expect(r.indexAbsorbeur).toBe(-1)
  })

  it('gère un montant nul', () => {
    const r = repartirAuProrata(m(0), [m(100), m(200)])
    expect(r.parts).toEqual([0, 0])
    expect(r.ecartResiduel).toBe(0)
  })

  it('reste déterministe et exact sur des poids très déséquilibrés', () => {
    const poids = [m(1), m(1), m(1), m(99997)]
    const r = repartirAuProrata(m(7777), poids)
    expect(r.parts.reduce<number>((s, p) => s + p, 0)).toBe(7777)
    // Les micro-lignes reçoivent 0 (plancher), le gros absorbe tout.
    expect(r.parts.slice(0, 3)).toEqual([0, 0, 0])
  })

  it('est stable : deux appels identiques donnent le même résultat', () => {
    const poids = [m(1234), m(5678), m(910), m(1112)]
    const a = repartirAuProrata(m(3333), poids)
    const b = repartirAuProrata(m(3333), poids)
    expect(a.parts).toEqual(b.parts)
  })

  it('conserve la somme ET borne chaque part, sur un balayage exhaustif', () => {
    const poids = [m(700), m(1300), m(1900), m(1)]
    const total = 3901
    for (let montant = 0; montant <= total; montant += 1) {
      const r = repartirAuProrata(m(montant), poids)
      expect(r.parts.reduce<number>((s, p) => s + p, 0)).toBe(montant)
      expect(r.parts.every((p) => p >= 0)).toBe(true)
      expect(r.parts.every((p, i) => p <= poids[i]!)).toBe(true)
    }
  })

  it('refuse un montant négatif et un poids négatif', () => {
    expect(() => repartirAuProrata(m(-1), [m(10)])).toThrow(ErreurRepartition)
    expect(() => repartirAuProrata(m(10), [m(-1)])).toThrow(ErreurRepartition)
  })
})

describe('plafonnement de remise', () => {
  it('plafonne une remise supérieure à la base et le signale', () => {
    const r = bornerRemise(m(50000), m(24500))
    expect(r.remise).toBe(24500)
    expect(r.plafonnee).toBe(true)
  })

  it('laisse passer une remise normale', () => {
    const r = bornerRemise(m(5000), m(24500))
    expect(r.remise).toBe(5000)
    expect(r.plafonnee).toBe(false)
  })
})
