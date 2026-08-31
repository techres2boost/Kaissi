import { describe, expect, it } from 'vitest'
import { formaterPourcentage } from '@kaissi/domain'
import {
  calculerIndicateurs,
  etatStock,
  ventilerParCategorie,
  ventilerParEmploye,
  ventilerParPaiement,
  ventilerParProduit,
  type CommandeVendue,
  type LigneVendue,
} from './rapports.js'

/** Un burger : vendu 15 000, acheté 10 000 — l'exemple du cahier des charges. */
function ligne(p: Partial<LigneVendue> = {}): LigneVendue {
  return {
    orderId: 'c1',
    produitId: 'p1',
    designation: 'Burger',
    quantite: 1,
    brutMillimes: 15000,
    remiseLigneMillimes: 0,
    remiseGlobaleMillimes: 0,
    netMillimes: 15000,
    coutUnitaire: 10000,
    categorieId: 'cat1',
    categorieNom: 'Plats',
    ...p,
  }
}

const commande = (p: Partial<CommandeVendue> = {}): CommandeVendue => ({
  id: 'c1',
  totalMillimes: 15000,
  vendeurId: 'e1',
  closeA: '2026-08-30T12:00:00Z',
  ...p,
})

describe('indicateurs du tableau de bord', () => {
  it('CA, coût, marge et marge % sur une vente simple', () => {
    const i = calculerIndicateurs([ligne()], [commande()])
    expect(i.caNetMillimes).toBe(15000)
    expect(i.coutMillimes).toBe(10000)
    expect(i.marge.margeMillimes).toBe(5000)
    expect(formaterPourcentage(i.marge.margeBp!)).toBe('33,33')
    expect(i.nombreTickets).toBe(1)
    expect(i.panierMoyenMillimes).toBe(15000)
    expect(i.articlesVendus).toBe(1)
  })

  it('la REMISE réduit le CA net, donc la marge — jamais le brut', () => {
    // 15 000 brut, 3 000 de remise → 12 000 net. Coût inchangé à 10 000,
    // donc la marge tombe de 5 000 à 2 000. C'est précisément ce qu'un
    // gérant doit voir avant d'accorder des remises à la chaîne.
    const i = calculerIndicateurs(
      [ligne({ remiseLigneMillimes: 3000, netMillimes: 12000 })],
      [commande({ totalMillimes: 12000 })],
    )
    expect(i.caBrutMillimes).toBe(15000)
    expect(i.remisesMillimes).toBe(3000)
    expect(i.caNetMillimes).toBe(12000)
    expect(i.marge.margeMillimes).toBe(2000)
  })

  it('additionne remise de ligne ET quote-part de remise globale', () => {
    const i = calculerIndicateurs(
      [ligne({ remiseLigneMillimes: 1000, remiseGlobaleMillimes: 500, netMillimes: 13500 })],
      [commande()],
    )
    expect(i.remisesMillimes).toBe(1500)
  })

  it('compte les remboursements sans les confondre avec le CA', () => {
    // Un remboursement est TTC et vit sur un paiement ; le CA net est HT.
    // Les mélanger fausserait la marge — on les présente donc à part.
    const i = calculerIndicateurs([ligne()], [commande()], [{ montantMillimes: 4000 }])
    expect(i.remboursementsMillimes).toBe(4000)
    expect(i.caNetMillimes).toBe(15000)
  })

  it('SIGNALE les lignes sans coût saisi au lieu de les compter à zéro', () => {
    // Sans ce compteur, la marge s'afficherait à 100 % et paraîtrait juste.
    const i = calculerIndicateurs(
      [ligne(), ligne({ produitId: 'p2', designation: 'Café', coutUnitaire: null })],
      [commande()],
    )
    expect(i.lignesSansCout).toBe(1)
    expect(i.coutMillimes).toBe(10000)
  })

  it('n’arrondit les coûts qu’au TOTAL, jamais ligne par ligne', () => {
    // 3 lignes à 0,4 millime de coût : 0+0+0 = 0 si on arrondit chacune,
    // 1 si l'on accumule puis arrondit. C'est le sens de numeric(18,6).
    const lignes = [1, 2, 3].map((n) =>
      ligne({ produitId: `p${n}`, coutUnitaire: 0.4, netMillimes: 100, brutMillimes: 100 }),
    )
    expect(calculerIndicateurs(lignes, [commande()]).coutMillimes).toBe(1)
  })

  it('sur une journée sans vente, ne divise pas par zéro', () => {
    const i = calculerIndicateurs([], [])
    expect(i.caNetMillimes).toBe(0)
    expect(i.panierMoyenMillimes).toBeNull()
    expect(i.marge.margeBp).toBeNull()
  })
})

describe('ventilations', () => {
  const lignes = [
    ligne({ produitId: 'p1', designation: 'Burger', netMillimes: 15000, coutUnitaire: 10000 }),
    ligne({
      produitId: 'p2', designation: 'Café', netMillimes: 5000, coutUnitaire: 500,
      categorieId: 'cat2', categorieNom: 'Boissons', orderId: 'c2',
    }),
  ]

  it('par produit : classe par CA décroissant et calcule la part', () => {
    const v = ventilerParProduit(lignes)
    expect(v.map((x) => x.libelle)).toEqual(['Burger', 'Café'])
    expect(v[0]!.part).toBe(7500) // 15000 / 20000 = 75 %
    expect(v[1]!.marge.margeMillimes).toBe(4500)
  })

  it('par produit : un produit SUPPRIMÉ garde son chiffre, via sa désignation', () => {
    // `product_id` passe à NULL quand le produit est supprimé du catalogue.
    // Regrouper sur lui ferait disparaître le CA du rapport.
    const v = ventilerParProduit([ligne({ produitId: null, designation: 'Plat retiré' })])
    expect(v).toHaveLength(1)
    expect(v[0]!.libelle).toBe('Plat retiré')
    expect(v[0]!.marge.caMillimes).toBe(15000)
  })

  it('par catégorie, avec un repli explicite pour les produits sans catégorie', () => {
    const v = ventilerParCategorie([
      ...lignes,
      ligne({ produitId: 'p3', categorieId: null, categorieNom: null, netMillimes: 1000 }),
    ])
    expect(v.map((x) => x.libelle)).toContain('Sans catégorie')
  })

  it('par employé : attribue la vente à celui qui a ENCAISSÉ', () => {
    const v = ventilerParEmploye(
      lignes,
      [commande({ id: 'c1', vendeurId: 'e1' }), commande({ id: 'c2', vendeurId: 'e2' })],
      (id) => (id === 'e1' ? 'Salma' : id === 'e2' ? 'Karim' : 'Inconnu'),
    )
    expect(v.find((x) => x.libelle === 'Salma')!.marge.caMillimes).toBe(15000)
    expect(v.find((x) => x.libelle === 'Karim')!.marge.caMillimes).toBe(5000)
  })

  it('par moyen de paiement : additionne et compte les transactions', () => {
    const v = ventilerParPaiement([
      { type: 'cash', montantMillimes: 10000 },
      { type: 'cash', montantMillimes: 5000 },
      { type: 'card', montantMillimes: 20000 },
    ])
    expect(v[0]).toMatchObject({ libelle: 'Carte', montantMillimes: 20000, nombre: 1 })
    expect(v[1]).toMatchObject({ libelle: 'Espèces', montantMillimes: 15000, nombre: 2 })
  })
})

describe('état du stock', () => {
  it('distingue rupture, faible et normal', () => {
    expect(etatStock(0, 3)).toBe('rupture')
    expect(etatStock(2, 3)).toBe('faible')
    expect(etatStock(3, 3)).toBe('faible')
    expect(etatStock(4, 3)).toBe('ok')
  })

  it('un stock NÉGATIF est une rupture, pas un « presque »', () => {
    // Il signale en plus une réception oubliée : le masquer serait pire.
    expect(etatStock(-2, 3)).toBe('rupture')
  })

  it('sans seuil, seule la rupture alerte', () => {
    expect(etatStock(1, null)).toBe('ok')
    expect(etatStock(0, null)).toBe('rupture')
  })

  it('un produit non suivi n’est pas « en rupture »', () => {
    expect(etatStock(null, null)).toBe('non_suivi')
  })
})
