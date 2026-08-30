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
    // La solution mise en avant est de FOURNIR le certificat — par son
    // contenu (DATABASE_CA, la forme des conteneurs) ou par un chemin en
    // local (DATABASE_CA_FILE) — et jamais de couper la vérification.
    expect(explication).toMatch(/DATABASE_CA\b/)
    expect(explication).toMatch(/DATABASE_CA_FILE/)
    expect(explication.indexOf('DATABASE_CA')).toBeLessThan(
      explication.indexOf('DATABASE_SSL=false'),
    )
    expect(explication).toMatch(/jamais en production/)
  })

  it('distingue les pannes qui appellent des gestes différents', () => {
    const cas = [
      ['ECONNREFUSED', 'connect ECONNREFUSED 1.2.3.4:5432', /rien n'écoute/i],
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND db.example', /résolu/i],
      ['28P01', 'password authentication failed for user "postgres"', /Mot de passe refusé/],
      ['ETIMEDOUT', 'connect ETIMEDOUT', /pare-feu/i],
      // Le piège Supabase direct + Railway : pas de route IPv6.
      ['ENETUNREACH', 'connect ENETUNREACH 2a05:d014:1:2:3:4:5:6:5432', /SESSION POOLER/],
    ] as const
    const explications = new Set<string>()
    for (const [code, message, attendu] of cas) {
      const { explication } = expliquerErreurBase(Object.assign(new Error(message), { code }))
      expect(explication).toMatch(attendu)
      explications.add(explication)
    }
    expect(explications.size).toBe(cas.length)
  })

  it('oriente vers le session pooler quand la base est injoignable en IPv6', () => {
    // Reproduit à la lettre le log Railway : connexion directe
    // db.<ref>.supabase.co, jointe en IPv6, sans route.
    const e = Object.assign(
      new Error('connect ENETUNREACH 2a05:d014:7c9:4e01:a7ed:5ee6:3da4:1344:5432 - Local (:::0)'),
      { code: 'ENETUNREACH' },
    )
    const { explication } = expliquerErreurBase(e)
    expect(explication).toMatch(/IPv6/)
    expect(explication).toMatch(/pooler\.supabase\.com/)
    // Surtout PAS conseiller d'activer IPv6 : ce n'est pas la solution.
    expect(explication).toMatch(/n'est PAS d'activer IPv6/)
  })

  it("cesse de parler d'encodage quand le mot de passe est passé à part", () => {
    // Le remède « encode ton mot de passe » est FAUX quand DATABASE_PASSWORD
    // est utilisé : la valeur ne traverse aucune URL. Le répéter renverrait
    // chercher là où il n'y a rien — précisément là où l'utilisateur vient
    // de regarder.
    const echec = Object.assign(
      new Error('password authentication failed for user "postgres"'),
      { code: '28P01' },
    )

    const sans = expliquerErreurBase(echec).explication
    expect(sans).toMatch(/DATABASE_PASSWORD/)
    expect(sans).toMatch(/casse une\s+URL/)

    const avec = expliquerErreurBase(echec, {
      motDePasseSepare: true,
      utilisateur: 'postgres.mzrbpbqp',
    }).explication
    expect(avec).toMatch(/n'est PAS en cause/)
    expect(avec).not.toMatch(/encode/i)
    expect(avec).toMatch(/Reset database password/)
    // Le piège qui a réellement coûté du temps : changer le mot de passe du
    // COMPTE Supabase en croyant changer celui de la BASE. Les deux écrans
    // se ressemblent, et l'erreur renvoyée est la même.
    expect(avec).toMatch(/COMPTE/)
    expect(avec).toMatch(/mot de passe ACTUEL/)
    // L'utilisateur réellement envoyé : Supabase le rapporte tronqué à
    // « postgres », ce qui fait croire à une erreur de nom d'utilisateur.
    expect(avec).toContain('postgres.mzrbpbqp')
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
