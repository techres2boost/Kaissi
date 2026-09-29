/**
 * La graine locale — ce qu'elle écrit doit pouvoir REMONTER.
 *
 * PANNE OBSERVÉE (septembre 2026). Les trois réductions de la graine avaient
 * un identifiant de 35 caractères (`…00000000960`). SQLite stocke du texte
 * et l'acceptait ; PostgreSQL le refusait comme uuid. Une vente « Happy
 * hour » faisait échouer la projection côté serveur, et plus RIEN ne
 * remontait. Aucun test local ne pouvait le voir : localement, tout
 * marchait.
 *
 * D'où le premier test : il énumère TOUTES les colonnes d'identifiant de
 * TOUTES les tables après la graine, et exige un UUID bien formé. C'est la
 * règle, pas le cas — une prochaine faute de frappe dans un suffixe tombera
 * ici, pas sur la caisse d'un client.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { estUuid } from '@kaissi/domain'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import { migrer } from './migrateur.js'
import { MIGRATIONS } from './migrations/index.js'
import {
  DEMO_DEVICE,
  DEMO_ORG,
  DEMO_RESTO,
  GRAINE_SANS_EQUIVALENT_SERVEUR,
  installerGraine,
  retirerGraineSansEquivalentServeur,
} from './graine.js'

let db: AdaptateurSqlite

async function tables(): Promise<string[]> {
  const lignes = await db.lire<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  return lignes.map((l) => l.name)
}

async function colonnesIdentifiant(table: string): Promise<string[]> {
  const colonnes = await db.lire<{ name: string }>(`PRAGMA table_info(${table})`)
  return colonnes
    .map((c) => c.name)
    .filter((nom) => nom === 'id' || nom.endsWith('_id'))
}

async function compter(table: string, ids: readonly string[]): Promise<number> {
  const ligne = await db.lireUne<{ n: number }>(
    `SELECT count(*) AS n FROM ${table} WHERE id IN (${ids.map(() => '?').join(', ')})`,
    [...ids],
  )
  return ligne?.n ?? 0
}

describe('la graine', () => {
  beforeEach(async () => {
    db = adaptateurNode(':memory:')
    await migrer(db)
    await installerGraine(db)
  })

  it('n’écrit QUE des identifiants au format UUID, dans toutes les tables', async () => {
    const fautifs: string[] = []
    for (const table of await tables()) {
      for (const colonne of await colonnesIdentifiant(table)) {
        const lignes = await db.lire<{ v: unknown }>(
          `SELECT ${colonne} AS v FROM ${table} WHERE ${colonne} IS NOT NULL`,
        )
        for (const { v } of lignes) {
          // `installation_id` et autres clés d'état vivent dans sync_state
          // (cle/valeur) : seules les colonnes typées identifiant comptent.
          if (typeof v === 'string' && !estUuid(v)) fautifs.push(`${table}.${colonne} = ${v}`)
        }
      }
    }
    expect(fautifs, 'un identifiant mal formé est refusé par PostgreSQL').toEqual([])
  })

  it('retire à la mise en service ce que le serveur ne connaît pas — et RIEN d’autre', async () => {
    const produitsAvant = await db.lireUne<{ n: number }>('SELECT count(*) AS n FROM products')

    await retirerGraineSansEquivalentServeur(db)

    expect(await compter('discounts', GRAINE_SANS_EQUIVALENT_SERVEUR.discounts)).toBe(0)
    expect(await compter('customers', GRAINE_SANS_EQUIVALENT_SERVEUR.customers)).toBe(0)
    // Les produits portent les identifiants du serveur (migration 0007) :
    // le premier pull les recouvre. Les retirer viderait la carte.
    const produitsApres = await db.lireUne<{ n: number }>('SELECT count(*) AS n FROM products')
    expect(produitsApres?.n).toBe(produitsAvant?.n)
  })
})

describe('la migration locale 014', () => {
  const ancien = (s: string) => `01930000-0000-7000-8000-00000000${s}`

  /** Une base telle que l'ancienne graine l'avait laissée. */
  async function baseAncienne(deviceId: string): Promise<void> {
    db = adaptateurNode(':memory:')
    await migrer(db, MIGRATIONS.filter((m) => m.version <= 13))
    for (const [s, nom] of [
      ['960', 'Happy hour'],
      ['961', 'Personnel'],
      ['962', 'Geste commercial'],
    ] as const) {
      await db.executer(
        `INSERT INTO discounts (id, organization_id, restaurant_id, name, kind, value_bp, position)
         VALUES (?, ?, ?, ?, 'pourcentage', 1000, 1)`,
        [ancien(s), DEMO_ORG, DEMO_RESTO, nom],
      )
    }
    await db.executer(
      `INSERT INTO customers (id, organization_id, restaurant_id, name) VALUES (?, ?, ?, 'Salem Haddad')`,
      [ancien('0801'), DEMO_ORG, DEMO_RESTO],
    )
    await db.executer(
      `INSERT INTO sync_state (cle, valeur) VALUES ('device_id', ?)
         ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur`,
      [deviceId],
    )
  }

  it('caisse EN SERVICE : retire les réductions et clients de la graine (plus de doublons)', async () => {
    await baseAncienne('01a0e000-0000-7000-8000-00000000abcd')
    await migrer(db)

    const reductions = await db.lire<{ id: string }>('SELECT id FROM discounts')
    expect(reductions).toEqual([])
    expect(await compter('customers', [ancien('0801')])).toBe(0)
  })

  it('caisse JAMAIS mise en service : garde la démonstration, corrige les identifiants', async () => {
    await baseAncienne(DEMO_DEVICE)
    await migrer(db)

    const reductions = await db.lire<{ id: string; name: string }>(
      'SELECT id, name FROM discounts ORDER BY id',
    )
    expect(reductions.map((r) => r.name)).toEqual(['Happy hour', 'Personnel', 'Geste commercial'])
    expect(reductions.every((r) => estUuid(r.id))).toBe(true)
    expect(await compter('customers', [ancien('0801')])).toBe(1)
  })
})
