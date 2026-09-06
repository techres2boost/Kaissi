import { describe, expect, it } from 'vitest'
import { grouperParCategorie } from './grouper.js'

const CATEGORIES = [
  { id: 'c1', nom: 'Boissons' },
  { id: 'c2', nom: 'Pizzas' },
  { id: 'c3', nom: 'Desserts' },
]

const produit = (nom: string, categorieId: string | null) => ({ nom, categorieId })

describe('grouper par catégorie', () => {
  it('suit l’ordre des CATÉGORIES, pas l’ordre alphabétique', () => {
    const groupes = grouperParCategorie(
      [produit('Pizza', 'c2'), produit('Coca', 'c1')],
      (p) => p.categorieId,
      CATEGORIES,
    )
    // « Boissons » d'abord parce qu'elle est première au Menu — pas parce
    // que B vient avant P. Le gérant qui déplace une catégorie avec les
    // flèches doit voir la liste suivre.
    expect(groupes.map((g) => g.titre)).toEqual(['Boissons', 'Pizzas'])
  })

  it('ne laisse pas un titre orphelin pour une catégorie vide', () => {
    const groupes = grouperParCategorie([produit('Coca', 'c1')], (p) => p.categorieId, CATEGORIES)
    expect(groupes).toHaveLength(1)
  })

  it('met les produits SANS catégorie en dernier', () => {
    const groupes = grouperParCategorie(
      [produit('Orphelin', null), produit('Coca', 'c1')],
      (p) => p.categorieId,
      CATEGORIES,
    )
    expect(groupes.map((g) => g.titre)).toEqual(['Boissons', 'Sans catégorie'])
  })

  it('conserve l’ordre reçu À L’INTÉRIEUR d’un groupe', () => {
    // C'est l'ordre des flèches du Menu : le regroupement ne doit pas le
    // défaire, sinon monter un produit dans sa catégorie n'aurait plus
    // d'effet visible.
    const groupes = grouperParCategorie(
      [produit('B', 'c1'), produit('A', 'c1')],
      (p) => p.categorieId,
      CATEGORIES,
    )
    expect(groupes[0]!.lignes.map((l) => l.nom)).toEqual(['B', 'A'])
  })

  it('ne perd aucune ligne, même sans catégorie connue', () => {
    const groupes = grouperParCategorie(
      [produit('X', 'inconnue'), produit('Coca', 'c1')],
      (p) => p.categorieId,
      CATEGORIES,
    )
    // Une catégorie archivée entre-temps : le produit ne doit pas disparaître
    // de l'écran — c'est justement celui qu'il faut reclasser.
    const total = groupes.reduce((n, g) => n + g.lignes.length, 0)
    expect(total).toBe(2)
  })
})
