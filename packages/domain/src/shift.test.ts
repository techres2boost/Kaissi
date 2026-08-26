import { describe, expect, it } from 'vitest'
import { millimes, type Millimes } from './monnaie.js'
import {
  COUPURES_TND,
  ecartSignificatif,
  resumerShift,
  suggestionsEspeces,
  totaliserComptage,
  type EncaissementShift,
  type MouvementCaisse,
  type Shift,
} from './shift.js'

const m = (n: number): Millimes => millimes(n)

const shift = (extra: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  restaurantId: 'resto-1',
  organizationId: 'org-1',
  deviceId: 'dev-1',
  employeId: 'emp-1',
  ouvertA: '2026-08-25T08:00:00.000Z',
  fondDeCaisseMillimes: m(50_000),
  closA: null,
  compteMillimes: null,
  noteCloture: null,
  ...extra,
})

const paiement = (
  mode: EncaissementShift['mode'],
  montant: number,
  annule = false,
): EncaissementShift => ({
  paiementId: `pay-${mode}-${montant}`,
  mode,
  montantMillimes: m(montant),
  annule,
})

const mouvement = (
  type: MouvementCaisse['type'],
  montant: number,
): MouvementCaisse => ({
  id: `mv-${type}-${montant}`,
  type,
  montantMillimes: m(montant),
  motif: 'test',
  creeA: '2026-08-25T12:00:00.000Z',
  creePar: 'emp-1',
})

describe('résumé de shift', () => {
  it('ne compte QUE les espèces dans le tiroir', () => {
    const r = resumerShift({
      shift: shift(),
      encaissements: [paiement('cash', 24_500), paiement('card', 100_000)],
      mouvements: [],
      nombreCommandes: 2,
      chiffreAffairesMillimes: m(124_500),
    })
    // La carte ne passe pas par le tiroir.
    expect(r.attenduMillimes).toBe(50_000 + 24_500)
    expect(r.carteMillimes).toBe(100_000)
  })

  it('exclut un paiement annulé', () => {
    const r = resumerShift({
      shift: shift(),
      encaissements: [paiement('cash', 24_500), paiement('cash', 10_000, true)],
      mouvements: [],
      nombreCommandes: 1,
      chiffreAffairesMillimes: m(24_500),
    })
    expect(r.especesMillimes).toBe(24_500)
  })

  it('ajoute les entrées et retire toutes les formes de sortie', () => {
    const r = resumerShift({
      shift: shift(),
      encaissements: [paiement('cash', 100_000)],
      mouvements: [
        mouvement('in', 20_000),
        mouvement('out', 5_000),
        mouvement('drop', 50_000), // prélèvement vers le coffre
        mouvement('payout', 3_000), // dépense réglée en caisse
      ],
      nombreCommandes: 5,
      chiffreAffairesMillimes: m(100_000),
    })
    expect(r.entreesMillimes).toBe(20_000)
    expect(r.sortiesMillimes).toBe(58_000)
    expect(r.attenduMillimes).toBe(50_000 + 100_000 + 20_000 - 58_000)
  })

  it('reste ouvert tant qu il n est pas clôturé : pas d écart calculable', () => {
    const r = resumerShift({
      shift: shift(),
      encaissements: [paiement('cash', 24_500)],
      mouvements: [],
      nombreCommandes: 1,
      chiffreAffairesMillimes: m(24_500),
    })
    expect(r.ouvert).toBe(true)
    expect(r.compteMillimes).toBeNull()
    expect(r.ecartMillimes).toBeNull()
  })

  it("calcule un écart NÉGATIF quand il manque de l'argent", () => {
    const r = resumerShift({
      shift: shift({ closA: '2026-08-25T23:00:00.000Z', compteMillimes: m(70_000) }),
      encaissements: [paiement('cash', 24_500)],
      mouvements: [],
      nombreCommandes: 1,
      chiffreAffairesMillimes: m(24_500),
    })
    expect(r.attenduMillimes).toBe(74_500)
    // Il manque 4,500 TND : l'écart DOIT pouvoir être négatif.
    expect(r.ecartMillimes).toBe(-4_500)
  })

  it('calcule un écart positif — un excédent est aussi une anomalie', () => {
    const r = resumerShift({
      shift: shift({ closA: '2026-08-25T23:00:00.000Z', compteMillimes: m(80_000) }),
      encaissements: [paiement('cash', 24_500)],
      mouvements: [],
      nombreCommandes: 1,
      chiffreAffairesMillimes: m(24_500),
    })
    expect(r.ecartMillimes).toBe(5_500)
  })

  it('signale un écart significatif au-delà d un dinar', () => {
    expect(ecartSignificatif(m(-1_000))).toBe(true)
    expect(ecartSignificatif(m(1_500))).toBe(true)
    expect(ecartSignificatif(m(-999))).toBe(false)
    expect(ecartSignificatif(null)).toBe(false)
  })
})

describe('comptage du tiroir', () => {
  it('totalise un comptage par coupure', () => {
    expect(totaliserComptage({ 50_000: 2, 10_000: 3, 1_000: 5, 500: 2 })).toBe(
      100_000 + 30_000 + 5_000 + 1_000,
    )
  })

  it('refuse un nombre de coupures négatif ou fractionnaire', () => {
    expect(() => totaliserComptage({ 1_000: -1 })).toThrow()
    expect(() => totaliserComptage({ 1_000: 1.5 })).toThrow()
  })

  it('rend un total nul pour un comptage vide', () => {
    expect(totaliserComptage({})).toBe(0)
  })

  it('propose les coupures de la plus grosse à la plus petite', () => {
    expect([...COUPURES_TND]).toEqual([...COUPURES_TND].sort((a, b) => b - a))
  })
})

describe("suggestions d'espèces", () => {
  it('propose le compte exact en premier', () => {
    expect(suggestionsEspeces(m(24_500))[0]).toBe(24_500)
  })

  it('propose ensuite les arrondis naturels', () => {
    const s = suggestionsEspeces(m(24_500))
    expect(s).toContain(25_000)
    expect(s).toContain(30_000)
    expect(s).toContain(50_000)
  })

  it('ne propose jamais un montant inférieur au total', () => {
    for (const total of [1_000, 12_345, 99_999]) {
      for (const s of suggestionsEspeces(m(total))) {
        expect(s).toBeGreaterThanOrEqual(total)
      }
    }
  })

  it('ne propose rien pour un total nul', () => {
    expect(suggestionsEspeces(m(0))).toHaveLength(0)
  })

  it('ne duplique pas un montant déjà rond', () => {
    const s = suggestionsEspeces(m(50_000))
    expect(new Set(s).size).toBe(s.length)
  })
})
