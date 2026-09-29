/**
 * Le diagnostic doit envoyer chercher au BON endroit.
 *
 * PANNE DE DIAGNOSTIC OBSERVÉE : « Failed to fetch » était attribué d'emblée
 * à CORS, alors que le serveur ne démarrait même pas. On a réglé
 * SYNC_ORIGINES pendant une heure pour un serveur éteint.
 */

import { describe, expect, it } from 'vitest'
import { expliquerEchecReseau } from './diagnostic-reseau.js'

const ECHEC = new TypeError('Failed to fetch')
const URL_PROD = 'https://kaissi-production.up.railway.app/'

describe('expliquerEchecReseau — serveur HTTPS distant', () => {
  it('dans un navigateur : /sante D’ABORD, CORS ensuite', () => {
    const message = expliquerEchecReseau(ECHEC, URL_PROD)

    const sante = message.indexOf('https://kaissi-production.up.railway.app/sante')
    const cors = message.indexOf('CORS')
    expect(sante, 'le message doit donner l’adresse /sante exacte').toBeGreaterThan(-1)
    expect(cors).toBeGreaterThan(sante)
    expect(message).toContain('SYNC_ORIGINES')
  })

  it('dans la coque native : ne parle PAS de CORS, qui ne s’y applique pas', () => {
    const message = expliquerEchecReseau(ECHEC, URL_PROD, true)

    expect(message).toContain('/sante')
    expect(message).not.toContain('CORS')
    expect(message).not.toContain('SYNC_ORIGINES')
  })
})

describe('expliquerEchecReseau — cas inchangés', () => {
  it('localhost désigne la tablette, pas le PC', () => {
    expect(expliquerEchecReseau(ECHEC, 'http://localhost:8787')).toContain('10.0.2.2')
  })

  it('adresse illisible', () => {
    expect(expliquerEchecReseau(ECHEC, 'pas une adresse')).toContain('Adresse invalide')
  })
})
