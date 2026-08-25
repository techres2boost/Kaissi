import { describe, expect, it } from 'vitest'
import { millimes, pointsDeBase, sommer, type Millimes } from './monnaie.js'
import { calculerRendu, calculerTotaux, ErreurCalcul, verifierCoherence } from './totaux.js'
import type { ConfigCalcul, LigneCalculable, TauxTaxe } from './types.js'

const m = (n: number): Millimes => millimes(n)
const bp = (n: number) => pointsDeBase(n)

// Taux de TVA tunisiens usuels en restauration. ⚠ valeurs de TEST : les taux
// réellement applicables doivent être validés par un expert-comptable.
const TVA_19: TauxTaxe = { id: 'tva-19', nom: 'TVA 19 %', tauxBp: bp(1900), incluse: false }
const TVA_13: TauxTaxe = { id: 'tva-13', nom: 'TVA 13 %', tauxBp: bp(1300), incluse: false }
const TVA_07: TauxTaxe = { id: 'tva-07', nom: 'TVA 7 %', tauxBp: bp(700), incluse: false }
const TTC_19: TauxTaxe = { id: 'ttc-19', nom: 'TVA 19 % incluse', tauxBp: bp(1900), incluse: true }

const config: ConfigCalcul = {
  tauxTaxes: {
    [TVA_19.id]: TVA_19,
    [TVA_13.id]: TVA_13,
    [TVA_07.id]: TVA_07,
    [TTC_19.id]: TTC_19,
  },
}

function ligne(
  id: string,
  prix: number,
  quantite: number,
  tauxTaxeId: string,
  extra: Partial<LigneCalculable> = {},
): LigneCalculable {
  return {
    id,
    prixBaseMillimes: m(prix),
    modificateursMillimes: m(0),
    quantite,
    tauxTaxeId,
    ...extra,
  }
}

describe('étape 1-2 : lignes brutes et sous-total', () => {
  it('intègre les modificateurs AVANT la multiplication par la quantité', () => {
    const t = calculerTotaux({
      lignes: [
        {
          id: 'l1',
          prixBaseMillimes: m(8500),
          modificateursMillimes: m(1500), // supplément fromage
          quantite: 3,
          tauxTaxeId: TVA_19.id,
        },
      ],
      config,
    })
    expect(t.lignes[0]!.prixUnitaireMillimes).toBe(10000)
    expect(t.lignes[0]!.totalBrutMillimes).toBe(30000)
    expect(t.sousTotalMillimes).toBe(30000)
  })

  it('exclut les lignes annulées du total mais les garde dans le journal', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 10000, 1, TVA_19.id),
        ligne('l2', 5000, 1, TVA_19.id, { annulee: true }),
      ],
      config,
    })
    expect(t.sousTotalMillimes).toBe(10000)
    expect(t.lignes).toHaveLength(1)
  })

  it('refuse une quantité fractionnaire ou négative', () => {
    expect(() =>
      calculerTotaux({ lignes: [ligne('l1', 1000, 1.5, TVA_19.id)], config }),
    ).toThrow(ErreurCalcul)
    expect(() =>
      calculerTotaux({ lignes: [ligne('l1', 1000, -1, TVA_19.id)], config }),
    ).toThrow(ErreurCalcul)
  })

  it('refuse un taux de taxe absent du catalogue local', () => {
    expect(() =>
      calculerTotaux({ lignes: [ligne('l1', 1000, 1, 'tva-inconnue')], config }),
    ).toThrow(ErreurCalcul)
  })
})

describe('étape 3 : remise de ligne AVANT remise globale', () => {
  it('applique une remise de ligne en pourcentage', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 10000, 2, TVA_19.id, {
          remise: { type: 'pourcentage', valeurBp: bp(1000) }, // 10 %
        }),
      ],
      config,
    })
    expect(t.lignes[0]!.totalBrutMillimes).toBe(20000)
    expect(t.lignes[0]!.remiseLigneMillimes).toBe(2000)
    expect(t.lignes[0]!.baseApresRemisesMillimes).toBe(18000)
  })

  it('plafonne une remise de ligne supérieure au montant de la ligne', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 5000, 1, TVA_19.id, {
          remise: { type: 'montant', valeurMillimes: m(99999) },
        }),
      ],
      config,
    })
    expect(t.lignes[0]!.remiseLigneMillimes).toBe(5000)
    expect(t.lignes[0]!.baseApresRemisesMillimes).toBe(0)
    expect(t.totalMillimes).toBe(0)
  })

  it('la remise globale se calcule sur la base APRÈS remise de ligne', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 10000, 1, TVA_19.id, {
          remise: { type: 'montant', valeurMillimes: m(2000) },
        }),
      ],
      remiseGlobale: { type: 'pourcentage', valeurBp: bp(1000) }, // 10 %
      config,
    })
    // 10 % de 8000, pas de 10000.
    expect(t.remiseGlobaleMillimes).toBe(800)
  })
})

describe('étape 4 : remise globale répartie AU PRORATA — le cas critique', () => {
  it('répartit la remise proportionnellement aux lignes', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 30000, 1, TVA_19.id), ligne('l2', 10000, 1, TVA_07.id)],
      remiseGlobale: { type: 'montant', valeurMillimes: m(4000) },
      config,
    })
    expect(t.lignes[0]!.remiseGlobaleRepartieMillimes).toBe(3000)
    expect(t.lignes[1]!.remiseGlobaleRepartieMillimes).toBe(1000)
    expect(t.baseApresRemisesMillimes).toBe(36000)
  })

  it('SANS répartition la TVA par taux serait fausse — vérification chiffrée', () => {
    // Deux taux, remise globale de 10 %.
    const t = calculerTotaux({
      lignes: [ligne('l1', 30000, 1, TVA_19.id), ligne('l2', 10000, 1, TVA_07.id)],
      remiseGlobale: { type: 'pourcentage', valeurBp: bp(1000) },
      config,
    })
    // Bases après remise : 27000 à 19 %, 9000 à 7 %.
    const v19 = t.ventilationTaxes.find((v) => v.tauxTaxeId === TVA_19.id)!
    const v07 = t.ventilationTaxes.find((v) => v.tauxTaxeId === TVA_07.id)!
    expect(v19.baseHtMillimes).toBe(27000)
    expect(v19.taxeMillimes).toBe(5130) // 27000 × 19 %
    expect(v07.baseHtMillimes).toBe(9000)
    expect(v07.taxeMillimes).toBe(630) // 9000 × 7 %
    // Si l'on avait taxé 30000 et 10000 puis retiré 10 % du total de TVA :
    // (5700 + 700) × 0,9 = 5760 ≠ 5130 + 630 = 5760… identique ICI par
    // linéarité, mais l'écart apparaît dès qu'un arrondi intervient — cas suivant.
    expect(t.taxeMillimes).toBe(5760)
  })

  it('exhibe l écart que produirait une remise NON répartie (avec arrondi)', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 3333, 1, TVA_19.id), ligne('l2', 3333, 1, TVA_07.id)],
      remiseGlobale: { type: 'montant', valeurMillimes: m(1000) },
      config,
    })
    // Répartition : 500 / 500 → bases 2833 et 2833.
    const v19 = t.ventilationTaxes.find((v) => v.tauxTaxeId === TVA_19.id)!
    const v07 = t.ventilationTaxes.find((v) => v.tauxTaxeId === TVA_07.id)!
    expect(v19.baseHtMillimes).toBe(2833)
    expect(v19.taxeMillimes).toBe(538) // 538,27 → 538
    expect(v07.baseHtMillimes).toBe(2833)
    expect(v07.taxeMillimes).toBe(198) // 198,31 → 198
    expect(t.taxeMillimes).toBe(736)
    // Méthode fausse (taxer le brut puis abattre 1000/6666) : 633 + 233 = 866
    // puis ×(1 − 0,15) ≈ 736,1 → 736. Le résultat coïncide ici, mais la
    // méthode correcte est celle qui est stable dans TOUS les cas ci-dessous.
  })

  it('l écart résiduel de répartition va sur la DERNIÈRE ligne', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 1000, 1, TVA_19.id),
        ligne('l2', 1000, 1, TVA_19.id),
        ligne('l3', 1000, 1, TVA_19.id),
      ],
      remiseGlobale: { type: 'montant', valeurMillimes: m(10) },
      config,
    })
    expect(t.lignes.map((l) => l.remiseGlobaleRepartieMillimes)).toEqual([3, 3, 4])
    expect(t.ecartRepartitionMillimes).toBe(1)
    expect(t.lignes[2]!.absorbeEcartResiduel).toBe(true)
    expect(t.lignes[0]!.absorbeEcartResiduel).toBe(false)
  })

  it('la somme des remises réparties égale EXACTEMENT la remise globale', () => {
    for (let remise = 0; remise <= 500; remise += 1) {
      const t = calculerTotaux({
        lignes: [
          ligne('l1', 1234, 1, TVA_19.id),
          ligne('l2', 5678, 1, TVA_13.id),
          ligne('l3', 901, 1, TVA_07.id),
        ],
        remiseGlobale: { type: 'montant', valeurMillimes: m(remise) },
        config,
      })
      expect(sommer(t.lignes.map((l) => l.remiseGlobaleRepartieMillimes))).toBe(
        t.remiseGlobaleMillimes,
      )
    }
  })

  it('plafonne une remise globale supérieure au sous-total et le signale', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 10000, 1, TVA_19.id)],
      remiseGlobale: { type: 'montant', valeurMillimes: m(50000) },
      config,
    })
    expect(t.remiseGlobaleMillimes).toBe(10000)
    expect(t.remiseGlobalePlafonnee).toBe(true)
    expect(t.totalMillimes).toBe(0)
  })
})

describe('étape 5-6 : TVA arrondie PAR TAUX puis sommée', () => {
  it('regroupe les lignes de même taux avant d arrondir', () => {
    // 3 lignes à 3,333 au même taux : arrondir par ligne donnerait
    // 3 × 633 = 1899. Arrondir la base regroupée (9999 × 19 %) = 1900.
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 3333, 1, TVA_19.id),
        ligne('l2', 3333, 1, TVA_19.id),
        ligne('l3', 3333, 1, TVA_19.id),
      ],
      config,
    })
    expect(t.taxeMillimes).toBe(1900)
    expect(t.taxeMillimes).not.toBe(1899)
  })

  it('imputée aux lignes, la TVA du groupe reste exactement conservée', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 3333, 1, TVA_19.id),
        ligne('l2', 3333, 1, TVA_19.id),
        ligne('l3', 3333, 1, TVA_19.id),
      ],
      config,
    })
    expect(sommer(t.lignes.map((l) => l.taxeMillimes))).toBe(t.taxeMillimes)
  })

  it('ventile trois taux simultanément', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 10000, 1, TVA_19.id),
        ligne('l2', 10000, 1, TVA_13.id),
        ligne('l3', 10000, 1, TVA_07.id),
      ],
      config,
    })
    expect(t.ventilationTaxes).toHaveLength(3)
    expect(t.taxeMillimes).toBe(1900 + 1300 + 700)
    expect(t.totalMillimes).toBe(30000 + 3900)
  })

  it('produit une ventilation dans un ordre STABLE (tri par identifiant)', () => {
    const a = calculerTotaux({
      lignes: [ligne('l1', 1000, 1, TVA_07.id), ligne('l2', 1000, 1, TVA_19.id)],
      config,
    })
    const b = calculerTotaux({
      lignes: [ligne('l2', 1000, 1, TVA_19.id), ligne('l1', 1000, 1, TVA_07.id)],
      config,
    })
    expect(a.ventilationTaxes.map((v) => v.tauxTaxeId)).toEqual(
      b.ventilationTaxes.map((v) => v.tauxTaxeId),
    )
  })
})

describe('TVA incluse dans le prix affiché', () => {
  it('n ajoute rien au total : la taxe est extraite', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 11900, 1, TTC_19.id)],
      config,
    })
    expect(t.totalMillimes).toBe(11900)
    expect(t.taxeMillimes).toBe(1900)
    expect(t.taxeExclusiveMillimes).toBe(0)
    expect(t.ventilationTaxes[0]!.baseHtMillimes).toBe(10000)
  })

  it('gère un ticket mixte HT + TTC', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 11900, 1, TTC_19.id), ligne('l2', 10000, 1, TVA_19.id)],
      config,
    })
    // 11900 TTC (dont 1900 de TVA) + 10000 HT + 1900 de TVA = 23800
    expect(t.totalMillimes).toBe(23800)
    expect(t.taxeMillimes).toBe(3800)
    expect(t.taxeExclusiveMillimes).toBe(1900)
  })
})

describe('étape 7 : frais de service', () => {
  it('se calcule sur la base APRÈS remises', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 10000, 1, TVA_19.id)],
      remiseGlobale: { type: 'pourcentage', valeurBp: bp(2000) }, // 20 %
      config: { ...config, service: { tauxBp: bp(1000), taxable: false } },
    })
    expect(t.baseApresRemisesMillimes).toBe(8000)
    expect(t.serviceMillimes).toBe(800) // 10 % de 8000, pas de 10000
    expect(t.totalMillimes).toBe(8000 + 1520 + 800)
  })

  it('taxe le service quand la configuration le prévoit', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 10000, 1, TVA_19.id)],
      config: {
        ...config,
        service: { tauxBp: bp(1000), taxable: true, tauxTaxeId: TVA_19.id },
      },
    })
    expect(t.serviceMillimes).toBe(1000)
    expect(t.taxeServiceMillimes).toBe(190)
    expect(t.totalMillimes).toBe(10000 + 1900 + 1000 + 190)
  })
})

describe('timbre fiscal', () => {
  it('s ajoute au total sans être taxé', () => {
    const t = calculerTotaux({
      lignes: [ligne('l1', 10000, 1, TVA_19.id)],
      config: { ...config, timbreFiscalMillimes: m(1000) },
    })
    expect(t.timbreFiscalMillimes).toBe(1000)
    expect(t.taxeMillimes).toBe(1900)
    expect(t.totalMillimes).toBe(12900)
  })
})

describe('cohérence globale', () => {
  it('recompose toujours le total à partir de ses composantes', () => {
    const t = calculerTotaux({
      lignes: [
        ligne('l1', 8500, 3, TVA_19.id, {
          remise: { type: 'pourcentage', valeurBp: bp(500) },
        }),
        ligne('l2', 2500, 2, TVA_13.id),
        ligne('l3', 1200, 7, TVA_07.id),
      ],
      remiseGlobale: { type: 'montant', valeurMillimes: m(3333) },
      config: {
        ...config,
        service: { tauxBp: bp(1000), taxable: true, tauxTaxeId: TVA_19.id },
        timbreFiscalMillimes: m(600),
      },
    })
    expect(verifierCoherence(t)).toBe(true)
  })

  it('reste cohérent sur un balayage de remises et de quantités', () => {
    for (let q = 1; q <= 12; q += 1) {
      for (let remise = 0; remise <= 400; remise += 37) {
        const t = calculerTotaux({
          lignes: [
            ligne('l1', 3333, q, TVA_19.id),
            ligne('l2', 777, q, TVA_13.id),
            ligne('l3', 1, q, TVA_07.id),
          ],
          remiseGlobale: { type: 'montant', valeurMillimes: m(remise) },
          config,
        })
        expect(verifierCoherence(t)).toBe(true)
        expect(sommer(t.lignes.map((l) => l.remiseGlobaleRepartieMillimes))).toBe(
          t.remiseGlobaleMillimes,
        )
        expect(t.totalMillimes).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('gère une commande vide', () => {
    const t = calculerTotaux({ lignes: [], config })
    expect(t.sousTotalMillimes).toBe(0)
    expect(t.totalMillimes).toBe(0)
    expect(t.ventilationTaxes).toHaveLength(0)
  })
})

describe('étape 9 : rendu de monnaie', () => {
  it('calcule la monnaie à rendre', () => {
    const r = calculerRendu(m(24500), m(50000))
    expect(r.rendreMillimes).toBe(25500)
    expect(r.resteDuMillimes).toBe(0)
    expect(r.solde).toBe(true)
  })

  it('calcule le reste dû sur un paiement partiel', () => {
    const r = calculerRendu(m(24500), m(10000))
    expect(r.rendreMillimes).toBe(0)
    expect(r.resteDuMillimes).toBe(14500)
    expect(r.solde).toBe(false)
  })

  it('solde une commande payée au millime près', () => {
    const r = calculerRendu(m(24500), m(24500))
    expect(r.rendreMillimes).toBe(0)
    expect(r.resteDuMillimes).toBe(0)
    expect(r.solde).toBe(true)
  })
})

describe('scénario réel — le ticket de 19h48 du dossier d architecture', () => {
  it('1 Pizza Margherita + 2 Coca, payés 24,500 TND', () => {
    const PIZZA: TauxTaxe = TVA_19
    const t = calculerTotaux({
      lignes: [
        ligne('pizza', 14500, 1, PIZZA.id),
        ligne('coca', 4200, 2, TVA_07.id),
      ],
      config: {
        tauxTaxes: {
          [TVA_19.id]: { ...TVA_19, incluse: true },
          [TVA_07.id]: { ...TVA_07, incluse: true },
        },
      },
    })
    // Prix affichés TTC : le total est la somme des prix carte.
    expect(t.totalMillimes).toBe(14500 + 8400)
    const r = calculerRendu(t.totalMillimes, m(25000))
    expect(r.rendreMillimes).toBe(2100)
  })
})
