/**
 * L'état affiché après un échec doit désigner le BON coupable.
 *
 * PANNE OBSERVÉE : un 500 du serveur s'affichait « Hors ligne. Le serveur
 * est injoignable ». On cherchait le Wi-Fi pendant que le serveur, lui,
 * répondait — par une erreur qu'il fallait corriger chez lui.
 */

import { describe, expect, it } from 'vitest'
import { etatApresEchec } from './moteur.js'
import { ErreurTransport } from './transport.js'

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
