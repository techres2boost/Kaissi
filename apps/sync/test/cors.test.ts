/**
 * CORS — le refus le plus silencieux de toute la chaîne.
 *
 * Une réponse sans en-tête Access-Control-Allow-Origin est jetée par le
 * navigateur AVANT que le code applicatif ne la voie. Côté tablette, cela
 * donne « Failed to fetch » : ni le statut, ni le corps, ni la moindre
 * indication de la cause. C'est exactement ce qui a bloqué un appairage
 * pendant que le serveur, lui, répondait correctement.
 */

import { describe, expect, it } from 'vitest'
import { creerServeur } from '../src/serveur.js'
import type { DepotSync } from '../src/depot.js'

// Aucune base : CORS se décide avant toute authentification.
const depotMuet = {
  async verifier() {},
  async appareilParJeton() {
    return null
  },
} as unknown as DepotSync

const CAPACITOR = 'https://localhost'

describe('CORS sur /sync', () => {
  it('autorise la coque Capacitor SANS configuration', () => {
    // Le cas du terrain : SYNC_ORIGINES vide, donc `origines` absent. Avant,
    // aucun en-tête CORS n'était posé du tout.
    const app = creerServeur({ depot: depotMuet })
    return app
      .request('http://test/sync/pull', {
        method: 'OPTIONS',
        headers: {
          origin: CAPACITOR,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      })
      .then((r) => {
        expect(r.headers.get('access-control-allow-origin')).toBe(CAPACITOR)
        expect(r.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
          'authorization',
        )
      })
  })

  it('ajoute les origines configurées sans perdre celles de Capacitor', async () => {
    const app = creerServeur({
      depot: depotMuet,
      origines: ['https://backoffice.example'],
    })
    for (const origine of ['https://backoffice.example', CAPACITOR]) {
      const r = await app.request('http://test/sync/pull', {
        method: 'OPTIONS',
        headers: { origin: origine, 'access-control-request-method': 'GET' },
      })
      expect(r.headers.get('access-control-allow-origin')).toBe(origine)
    }
  })

  it("n'autorise pas une origine inconnue", async () => {
    // CORS n'est pas notre authentification — le jeton d'appareil l'est —
    // mais ouvrir à tout vent n'apporterait rien non plus.
    const app = creerServeur({ depot: depotMuet })
    const r = await app.request('http://test/sync/pull', {
      method: 'OPTIONS',
      headers: { origin: 'https://site-tiers.example', 'access-control-request-method': 'GET' },
    })
    expect(r.headers.get('access-control-allow-origin')).not.toBe('https://site-tiers.example')
  })
})
