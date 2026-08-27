import { describe, expect, it } from 'vitest'
import { destinationSure } from './redirection.js'

describe('destination après connexion', () => {
  it('garde un chemin interne', () => {
    expect(destinationSure('/abc/journee')).toBe('/abc/journee')
    expect(destinationSure('/abc/catalogue?j=2026-08-29')).toBe('/abc/catalogue?j=2026-08-29')
  })

  it('refuse une URL absolue', () => {
    expect(destinationSure('https://evil.tn')).toBe('/')
    expect(destinationSure('http://evil.tn/phishing')).toBe('/')
  })

  it('refuse une URL PROTOCOL-RELATIVE — le piège du « commence par / »', () => {
    // Le navigateur lit « //evil.tn » comme « https://evil.tn ». Un contrôle
    // naïf « startsWith("/") » laisserait passer exactement ce cas.
    expect(destinationSure('//evil.tn')).toBe('/')
    expect(destinationSure('//evil.tn/connexion')).toBe('/')
    // Certains navigateurs traitent « /\ » de la même manière.
    expect(destinationSure('/\\evil.tn')).toBe('/')
  })

  it('refuse le vide et les espaces', () => {
    expect(destinationSure('')).toBe('/')
    expect(destinationSure('   ')).toBe('/')
    // Un espace en tête ne doit pas servir à contourner le contrôle.
    expect(destinationSure('  //evil.tn')).toBe('/')
  })
})
