import { describe, expect, it } from 'vitest'
import { assembler, COMMANDES, ligneAlignee, normaliserTexte, separateur } from './index.js'

describe('rendu ESC/POS', () => {
  it('translittère ce qu une imprimante thermique ne sait pas afficher', () => {
    expect(normaliserTexte('Bœuf à l’os')).toBe("Boeuf à l'os")
    // L'espace fine insécable du formatage monétaire deviendrait un carré.
    expect(normaliserTexte('1 234,567 TND')).toBe('1 234,567 TND')
  })

  it('aligne un libellé et un montant sur la largeur du papier', () => {
    const l = ligneAlignee('Pizza Margherita', '14,500', 42)
    expect(l).toHaveLength(42)
    expect(l.startsWith('Pizza Margherita')).toBe(true)
    expect(l.endsWith('14,500')).toBe(true)
  })

  it('tronque un libellé trop long sans jamais dépasser la largeur', () => {
    const l = ligneAlignee('Escalope panée frites sauce champignons', '999,999', 32)
    expect(l.length).toBeLessThanOrEqual(32)
    expect(l.endsWith('999,999')).toBe(true)
  })

  it('assemble commandes et texte en une charge unique', () => {
    const charge = assembler(COMMANDES.initialiser, COMMANDES.gras(true), 'KOT', COMMANDES.couper)
    expect(charge).toBeInstanceOf(Uint8Array)
    expect([...charge.slice(0, 2)]).toEqual([0x1b, 0x40])
    expect([...charge.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00])
  })

  it('produit un séparateur à la bonne largeur', () => {
    expect(separateur(32)).toHaveLength(32)
  })
})
