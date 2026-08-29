import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'
import { sslDepuisEnvironnement, ErreurCertificat } from '../src/ssl.js'

describe('sslDepuisEnvironnement', () => {
  it('vérifie le certificat par défaut', () => {
    expect(sslDepuisEnvironnement({})).toEqual({ rejectUnauthorized: true })
  })

  it('coupe TLS UNIQUEMENT sur DATABASE_SSL=false', () => {
    expect(sslDepuisEnvironnement({ DATABASE_SSL: 'false' })).toBe(false)
  })

  it('AJOUTE le CA aux racines de Node, sans les remplacer', () => {
    // Le piège de l'option `ca` : passée seule, Node ne fait plus confiance
    // qu'à elle. Une connexion qui marchait par la chaîne publique casserait
    // alors. Le fichier doit donc s'ajouter, pas remplacer.
    const dir = mkdtempSync(join(tmpdir(), 'kaissi-ca-'))
    const chemin = join(dir, 'ca.crt')
    writeFileSync(chemin, '-----BEGIN CERTIFICATE-----\nFAUX\n-----END CERTIFICATE-----\n')
    try {
      const ssl = sslDepuisEnvironnement({ DATABASE_CA_FILE: chemin })
      if (ssl === false) throw new Error('inattendu')
      expect(ssl.rejectUnauthorized).toBe(true)
      const ca = ssl.ca as string[]
      expect(Array.isArray(ca)).toBe(true)
      // Toutes les racines de confiance système + la nôtre.
      expect(ca.length).toBe(rootCertificates.length + 1)
      expect(ca[ca.length - 1]).toContain('FAUX')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('échoue clairement quand DATABASE_CA_FILE est introuvable', () => {
    // Le cas exact du terrain : un chemin Windows recopié de travers. Sans
    // ce garde, Node crachait un ENOENT brut avec pile.
    try {
      sslDepuisEnvironnement({ DATABASE_CA_FILE: 'C:\\nexiste\\pas.crt' })
      throw new Error('aurait dû lever')
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurCertificat)
      expect((erreur as Error).message).toContain('DATABASE_CA_FILE')
      expect((erreur as Error).message).toContain('nexiste')
    }
  })
})
