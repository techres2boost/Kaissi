/**
 * Règle Apple 3.1.1 : sur iOS, la caisse ne crée pas de compte d'entreprise.
 */

import { describe, expect, it } from 'vitest'
import { inscriptionPermise } from './config.js'

describe('inscription depuis la caisse', () => {
  it('jamais sur iOS', () => {
    expect(inscriptionPermise('ios')).toBe(false)
  })
  it('sur Android et sur la cible web, oui', () => {
    expect(inscriptionPermise('android')).toBe(true)
    expect(inscriptionPermise('web')).toBe(true)
  })
})
