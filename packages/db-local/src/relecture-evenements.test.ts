/**
 * Migration locale 015 — le curseur de lecture repart de zéro, une fois.
 *
 * Les caisses mises en service avant la correction du moteur ont un curseur
 * placé APRÈS des événements qu'elles n'ont jamais lus (voir
 * `apps/sync/test/curseur-apres-push.test.ts`). Rien d'autre ne les leur
 * rendrait : le pull ne regarde jamais en arrière.
 */

import { describe, expect, it } from 'vitest'
import { adaptateurNode } from './adaptateurs/node.js'
import { migrer } from './migrateur.js'
import { MIGRATIONS } from './migrations/index.js'

describe('la migration locale 015', () => {
  it('remet le curseur d’événements à zéro, sans toucher au reste', async () => {
    const db = adaptateurNode(':memory:')
    await migrer(db, MIGRATIONS.filter((m) => m.version <= 14))
    for (const [cle, valeur] of [
      ['last_event_seq', '4812'],
      ['last_catalog_seq', '977'],
    ] as const) {
      await db.executer(
        `INSERT INTO sync_state (cle, valeur) VALUES (?, ?)
           ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur`,
        [cle, valeur],
      )
    }

    await migrer(db)

    const lire = async (cle: string) =>
      (await db.lireUne<{ valeur: string }>('SELECT valeur FROM sync_state WHERE cle = ?', [cle]))
        ?.valeur
    expect(await lire('last_event_seq')).toBe('0')
    // Le catalogue, lui, n'a jamais avancé par un push : on ne le relit pas.
    expect(await lire('last_catalog_seq')).toBe('977')
  })
})
