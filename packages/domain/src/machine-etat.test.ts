import { describe, expect, it } from 'vitest'
import {
  estCommandeVide,
  ligneACompleter,
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

describe('commande vide — libérable sans gérant', () => {
  const ligne = { annulee: false } as never
  const paiement = { annule: false } as never

  it('une table ouverte sans rien saisir est vide', () => {
    expect(estCommandeVide({ statut: 'ouverte', lignes: [], paiements: [] })).toBe(true)
  })

  it('une ligne RETIRÉE compte : le plat a pu partir en cuisine', () => {
    const retiree = { annulee: true } as never
    expect(estCommandeVide({ statut: 'ouverte', lignes: [retiree], paiements: [] })).toBe(false)
    expect(estCommandeVide({ statut: 'ouverte', lignes: [ligne], paiements: [] })).toBe(false)
  })

  it('un paiement, même annulé, compte', () => {
    expect(estCommandeVide({ statut: 'ouverte', lignes: [], paiements: [paiement] })).toBe(false)
  })

  it('une commande close ou annulée n’est jamais « vide »', () => {
    expect(estCommandeVide({ statut: 'annulee', lignes: [], paiements: [] })).toBe(false)
    expect(estCommandeVide({ statut: 'close', lignes: [], paiements: [] })).toBe(false)
  })
})

describe('ligne à compléter — deux touchers sur un article', () => {
  const base = {
    id: 'l1',
    produitId: 'ojja',
    variantId: null,
    prixBaseMillimes: 13_500,
    modificateursMillimes: 0,
    tauxTaxeId: 'tva',
    modificateurs: [] as unknown[],
    note: null as string | null,
    annulee: false,
    deviceId: 'caisse-1',
  }
  const ajout = { produitId: 'ojja', prixBaseMillimes: 13_500, modificateursMillimes: 0, tauxTaxeId: 'tva' }
  const ctx = { deviceId: 'caisse-1', dejaEnvoyees: new Set<string>() }

  it('complète la ligne identique de cette caisse', () => {
    expect(ligneACompleter([base], ajout, ctx)?.id).toBe('l1')
  })

  it('ne complète PAS une ligne déjà envoyée : la cuisine ne verrait pas l’unité', () => {
    expect(ligneACompleter([base], ajout, { ...ctx, dejaEnvoyees: new Set(['l1']) })).toBeNull()
  })

  it('ne complète PAS la ligne d’une autre tablette : deux ajouts doivent commuter', () => {
    expect(ligneACompleter([{ ...base, deviceId: 'caisse-2' }], ajout, ctx)).toBeNull()
  })

  it('ne complète pas une ligne avec options, note, remise, ou retirée', () => {
    expect(ligneACompleter([{ ...base, modificateurs: [{}] }], ajout, ctx)).toBeNull()
    expect(ligneACompleter([{ ...base, note: 'sans oignon' }], ajout, ctx)).toBeNull()
    expect(ligneACompleter([{ ...base, remise: { type: 'pourcentage' } }], ajout, ctx)).toBeNull()
    expect(ligneACompleter([{ ...base, annulee: true }], ajout, ctx)).toBeNull()
  })

  it('un ajout AVEC options ou note, ou à prix libre, fait toujours une ligne neuve', () => {
    expect(ligneACompleter([base], { ...ajout, modificateurs: [{}] }, ctx)).toBeNull()
    expect(ligneACompleter([base], { ...ajout, note: 'bien cuit' }, ctx)).toBeNull()
    expect(ligneACompleter([{ ...base, produitId: null }], { ...ajout, produitId: null }, ctx)).toBeNull()
  })

  it('une autre variante ou un autre prix ne se confondent pas', () => {
    expect(ligneACompleter([base], { ...ajout, variantId: 'grande' }, ctx)).toBeNull()
    expect(ligneACompleter([base], { ...ajout, prixBaseMillimes: 14_000 }, ctx)).toBeNull()
  })
})
