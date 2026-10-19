/**
 * Un serveur SATURÉ répond « occupé, réessayez » — jamais « erreur interne ».
 *
 * Trouvé par `stress.test.ts` (scénario G) : cent caisses d'un même
 * établissement qui se reconnectent à la même seconde font attendre
 * certaines requêtes plus longtemps que le délai du pool. Rien n'est écrit,
 * rien n'est perdu — mais le service répondait 500 « erreur inattendue »,
 * en rouge dans les journaux, et l'écran Synchronisation de la caisse
 * affichait « Erreur interne du serveur ». Exactement le message qui fait
 * appeler le support pour une simple file d'attente.
 */

import { describe, expect, it } from 'vitest'
import { creerServeur, estPoolSature } from '../src/serveur.js'
import type { DepotSync } from '../src/depot.js'

/** Un dépôt dont chaque appel attend une connexion qui ne vient pas. */
const sature = new Proxy({} as DepotSync, {
  get: (_cible, nom) =>
    nom === 'then'
      ? undefined
      : async () => {
          throw new Error('timeout exceeded when trying to connect')
        },
})

describe('pool saturé', () => {
  it('reconnaît l’erreur de pg-pool, et elle seule', () => {
    expect(estPoolSature(new Error('timeout exceeded when trying to connect'))).toBe(true)
    expect(estPoolSature(new Error('relation "kaissi.x" does not exist'))).toBe(false)
    expect(estPoolSature('timeout exceeded when trying to connect')).toBe(false)
  })

  it('le push répond 503 « serveur_occupe » avec Retry-After — la caisse réessaie seule', async () => {
    const app = creerServeur({ depot: sature })
    const reponse = await app.request('http://test/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer un-jeton' },
      body: JSON.stringify({ protocolVersion: 1, batchId: crypto.randomUUID(), evenements: [] }),
    })
    expect(reponse.status).toBe(503)
    expect(reponse.headers.get('retry-after')).toBe('5')
    const corps = (await reponse.json()) as { erreur: string; message: string }
    expect(corps.erreur).toBe('serveur_occupe')
    expect(corps.message).toMatch(/conservées sur cette caisse/)
  })
})
