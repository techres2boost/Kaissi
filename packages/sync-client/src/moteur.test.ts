/**
 * L'état affiché après un échec doit désigner le BON coupable.
 *
 * PANNE OBSERVÉE : un 500 du serveur s'affichait « Hors ligne. Le serveur
 * est injoignable ». On cherchait le Wi-Fi pendant que le serveur, lui,
 * répondait — par une erreur qu'il fallait corriger chez lui.
 */

import { describe, expect, it } from 'vitest'
import { MoteurSync, etatApresEchec, type DepotLocalSync } from './moteur.js'
import { ErreurTransport, type Transport } from './transport.js'

describe('etatApresEchec', () => {
  it('pas de réponse du tout → hors ligne', () => {
    expect(etatApresEchec(new ErreurTransport('Failed to fetch', false))).toBe('hors_ligne')
  })

  it('le serveur a RÉPONDU 500 → erreur, pas hors ligne', () => {
    expect(
      etatApresEchec(new ErreurTransport('Erreur interne du serveur de synchronisation.', false, 500)),
    ).toBe('erreur')
  })

  it('refus définitif (appareil révoqué) → bloqué', () => {
    expect(etatApresEchec(new ErreurTransport('Appareil révoqué', true, 401))).toBe('bloque')
  })

  it('échec local (pas une erreur de transport) → erreur', () => {
    expect(etatApresEchec(new Error('disque plein'))).toBe('erreur')
  })
})

describe('pointeuse', () => {
  const pointage = { id: 'p1', employeId: 'e1', arriveeA: '2026-10-21T10:00:00Z', sortieA: null }

  function moteur(transport: Partial<Transport>, accuses: unknown[][]) {
    const depot: DepotLocalSync = {
      lotAPousser: async () => [],
      accuserReception: async () => {},
      marquerRejet: async () => {},
      integrerEvenements: async () => {},
      integrerCatalogue: async () => {},
      lireCurseur: async () => 0,
      ecrireCurseur: async () => {},
      compteurs: async () => ({ enAttente: 0, rejetes: 0 }),
      pointagesAPousser: async () => [pointage],
      accuserPointages: async (envoyes) => {
        accuses.push([...envoyes])
      },
    }
    return new MoteurSync({
      transport: {
        push: async () => ({ acceptes: [], rejetes: [] }) as never,
        pull: async () =>
          ({ catalogue: [], evenements: [], curseurCatalogue: 0, curseurEvenements: 0, encore: false }) as never,
        ...transport,
      },
      depot,
      genererId: () => 'lot',
    })
  }

  it('accuse les pointages que le serveur a enregistrés, tels qu’envoyés', async () => {
    const accuses: unknown[][] = []
    await moteur({ pointages: async () => ({ enregistres: ['p1'] }) }, accuses).cycle()
    expect(accuses).toEqual([[pointage]])
  })

  it('un serveur ANTÉRIEUR (404) ne met pas le cycle en échec', async () => {
    const accuses: unknown[][] = []
    const resume = await moteur(
      {
        pointages: async () => {
          throw new ErreurTransport('Not Found', false, 404)
        },
      },
      accuses,
    ).cycle()
    expect(resume.etat).toBe('a_jour')
    expect(accuses).toEqual([])
  })
})
