import { describe, expect, it } from 'vitest'
import {
  estFigee,
  estModifiable,
  libelleStatut,
  lignesAEnvoyer,
  transitionAutorisee,
} from './machine-etat.js'

describe('machine d état d une commande', () => {
  it('autorise tout ce qui est normal sur une commande ouverte', () => {
    for (const e of ['line.added', 'discount.applied', 'payment.recorded', 'order.closed'] as const) {
      expect(transitionAutorisee('ouverte', e).autorisee).toBe(true)
    }
  })

  it('autorise encore d ajouter sur une commande envoyée — la tournée suivante', () => {
    expect(transitionAutorisee('envoyee', 'line.added').autorisee).toBe(true)
  })

  it('REFUSE d ajouter une ligne à une commande encaissée, avec escalade', () => {
    const r = transitionAutorisee('close', 'line.added')
    expect(r.autorisee).toBe(false)
    if (!r.autorisee) {
      expect(r.escaladePossible).toBe(false)
      expect(r.motif).toMatch(/clôturée/)
    }
  })

  it('autorise UNIQUEMENT l annulation sur une commande encaissée', () => {
    const r = transitionAutorisee('close', 'order.cancelled')
    expect(r.autorisee).toBe(true)
  })

  it('une commande annulée est terminale', () => {
    for (const e of ['line.added', 'order.cancelled', 'payment.recorded'] as const) {
      const r = transitionAutorisee('annulee', e)
      expect(r.autorisee).toBe(false)
      if (!r.autorisee) expect(r.escaladePossible).toBe(false)
    }
  })

  it('classe les statuts figés et modifiables', () => {
    expect(estModifiable('ouverte')).toBe(true)
    expect(estModifiable('envoyee')).toBe(true)
    expect(estFigee('close')).toBe(true)
    expect(estFigee('annulee')).toBe(true)
  })

  it('donne un libellé français à chaque statut', () => {
    expect(libelleStatut('envoyee')).toBe('En cuisine')
    expect(libelleStatut('close')).toBe('Encaissée')
  })
})

describe('lignes à envoyer en cuisine', () => {
  const lignes = [
    { id: 'a', annulee: false },
    { id: 'b', annulee: false },
    { id: 'c', annulee: true },
  ]

  it('NE RÉIMPRIME PAS une ligne déjà partie — le plat serait fait en double', () => {
    expect(lignesAEnvoyer(lignes, new Set(['a'])).map((l) => l.id)).toEqual(['b'])
  })

  it('exclut les lignes annulées', () => {
    expect(lignesAEnvoyer(lignes, new Set()).map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('ne rend rien quand tout est déjà envoyé', () => {
    expect(lignesAEnvoyer(lignes, new Set(['a', 'b']))).toHaveLength(0)
  })
})
