import { describe, expect, it } from 'vitest'
import { expliquerErreurBase, formaterErreurBase } from '../src/diagnostic-base.js'

describe('expliquerErreurBase', () => {
  it("explique le certificat auto-signé SANS proposer de désactiver TLS", () => {
    // Le réflexe est `rejectUnauthorized: false`. Cette connexion transporte
    // toutes les ventes et les empreintes de jetons : la solution proposée
    // en premier doit être d'ajouter l'autorité, jamais de la contourner.
    const e = Object.assign(new Error('self-signed certificate in certificate chain'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    })
    const { explication } = expliquerErreurBase(e)
    expect(explication).toMatch(/NODE_EXTRA_CA_CERTS/)
    expect(explication).toMatch(/DATABASE_CA_FILE/)
    expect(explication.indexOf('NODE_EXTRA_CA_CERTS')).toBeLessThan(
      explication.indexOf('DATABASE_SSL=false'),
    )
    expect(explication).toMatch(/jamais en production/)
  })

  it('distingue les pannes qui appellent des gestes différents', () => {
    const cas = [
      ['ECONNREFUSED', 'connect ECONNREFUSED 1.2.3.4:5432', /rien n'écoute/i],
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND db.example', /résolu/i],
      ['28P01', 'password authentication failed for user "postgres"', /mot de passe/i],
      ['ETIMEDOUT', 'connect ETIMEDOUT', /pare-feu/i],
    ] as const
    const explications = new Set<string>()
    for (const [code, message, attendu] of cas) {
      const { explication } = expliquerErreurBase(Object.assign(new Error(message), { code }))
      expect(explication).toMatch(attendu)
      explications.add(explication)
    }
    expect(explications.size).toBe(cas.length)
  })

  it("conserve le message d'origine, et n'invente rien sur l'inconnu", () => {
    const inconnu = new Error('panique inédite du pilote')
    expect(expliquerErreurBase(inconnu).explication).toBe('')
    expect(formaterErreurBase(inconnu)).toBe('panique inédite du pilote')
    expect(formaterErreurBase(new Error('connect ECONNREFUSED'))).toContain(
      'connect ECONNREFUSED',
    )
  })
})
