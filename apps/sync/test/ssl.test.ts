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

  it('accepte le CONTENU du certificat via DATABASE_CA — la forme des conteneurs', () => {
    // Sur Railway/Render/Fly, un chemin de fichier ne désigne rien : le
    // certificat doit voyager comme contenu. On l'ajoute aux racines, comme
    // le fichier.
    const pem = '-----BEGIN CERTIFICATE-----\nFAUXCONTENU\n-----END CERTIFICATE-----\n'
    const ssl = sslDepuisEnvironnement({ DATABASE_CA: pem })
    if (ssl === false) throw new Error('inattendu')
    const ca = ssl.ca as string[]
    expect(ca.length).toBe(rootCertificates.length + 1)
    expect(ca[ca.length - 1]).toContain('FAUXCONTENU')
  })

  it('restaure les sauts de ligne aplatis en « \\n » littéraux', () => {
    // Certaines interfaces stockent la valeur sur une seule ligne. OpenSSL
    // refuse un PEM sans vrais retours à la ligne : on les rétablit.
    const platEnUneLigne =
      '-----BEGIN CERTIFICATE-----\\nLIGNE1\\nLIGNE2\\n-----END CERTIFICATE-----'
    const ssl = sslDepuisEnvironnement({ DATABASE_CA: platEnUneLigne })
    if (ssl === false) throw new Error('inattendu')
    const ca = ssl.ca as string[]
    expect(ca[ca.length - 1]).toContain('\n')
    expect(ca[ca.length - 1]).not.toContain('\\n')
  })

  it('DATABASE_CA l’emporte sur DATABASE_CA_FILE', () => {
    const ssl = sslDepuisEnvironnement({
      DATABASE_CA: '-----BEGIN CERTIFICATE-----\nGAGNE\n-----END CERTIFICATE-----',
      DATABASE_CA_FILE: 'C:\\nexiste\\pas.crt',
    })
    if (ssl === false) throw new Error('inattendu')
    const ca = ssl.ca as string[]
    // Ni erreur de fichier introuvable, ni lecture du chemin : le contenu a
    // pris la priorité.
    expect(ca[ca.length - 1]).toContain('GAGNE')
  })

  it('refuse un DATABASE_CA qui n’est manifestement pas un PEM', () => {
    try {
      sslDepuisEnvironnement({ DATABASE_CA: 'C:\\Users\\salem\\prod-ca.crt' })
      throw new Error('aurait dû lever')
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurCertificat)
      expect((erreur as Error).message).toContain('BEGIN CERTIFICATE')
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
