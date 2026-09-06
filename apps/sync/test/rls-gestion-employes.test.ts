/**
 * Ce qu'un gérant peut ÉCRIRE sur un employé (migration 0014).
 *
 * Le privilège n'est pas de table mais de COLONNE : `full_name`, `phone`,
 * `pin_hash`, `status`, `archived_at`, et rien d'autre. C'est ce qui empêche
 * un gérant de déplacer un employé vers une autre organisation ou de changer
 * son e-mail — ce qui le désynchroniserait de `auth.users` sans que rien ne
 * le signale.
 *
 * Ces tests existent parce que ce privilège s'est retourné contre nous : le
 * back-office écrivait `updated_at` en même temps que `pin_hash`, et Postgres
 * refusait l'écriture ENTIÈRE avec « permission denied for table users ».
 * Message exact, cause invisible : ni le nom de la colonne fautive, ni le
 * mot « colonne ». La réinitialisation du PIN et la suspension étaient
 * cassées toutes les deux, pour la même raison.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const comptes = new Map<string, string>()

async function dansLaPeauDe(
  acteur: string,
  sql: string,
  valeurs: unknown[] = [],
): Promise<'applique' | 'filtre' | 'refuse'> {
  await client.query('begin')
  try {
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: comptes.get(acteur) ?? acteur }),
    ])
    await client.query('set local role authenticated')
    const resultat = await client.query(sql, valeurs)
    return resultat.rowCount === 0 ? 'filtre' : 'applique'
  } catch {
    return 'refuse'
  } finally {
    await client.query('rollback')
  }
}

async function creer(role: string) {
  const compte = uuidV7()
  const id = uuidV7()
  await client.query('insert into auth.users (id) values ($1)', [compte])
  await client.query(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name, pin_hash)
     values ($1, $2, $3, $4, $5, 'HACHE')`,
    [id, DEMO_ORG, compte, `${id}@equipe.tn`, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [DEMO_ORG, id, DEMO_RESTO, role],
  )
  comptes.set(id, compte)
  return id
}

let gerant: string
let cuisinier: string

beforeEach(async () => {
  gerant = await creer('gerant')
  cuisinier = await creer('cuisine')
})

afterAll(async () => {
  await client.query("delete from kaissi.memberships where user_id in (select id from kaissi.users where email like '%@equipe.tn')")
  await client.query("delete from kaissi.users where email like '%@equipe.tn'")
  await client.end()
})

describe('un gérant administre son équipe', () => {
  it('réinitialise un code PIN', async () => {
    expect(
      await dansLaPeauDe(gerant, 'update kaissi.users set pin_hash = $2 where id = $1', [
        cuisinier,
        'NOUVEAU-HACHE',
      ]),
    ).toBe('applique')
  })

  it('suspend et réactive', async () => {
    expect(
      await dansLaPeauDe(gerant, `update kaissi.users set status = 'suspendu' where id = $1`, [
        cuisinier,
      ]),
    ).toBe('applique')
  })

  it('est REFUSÉ dès qu’il touche une colonne hors privilège', async () => {
    /*
     * Le cas qui a cassé la production. Écrire `updated_at` « en passant »
     * fait refuser TOUTE l'instruction, y compris la partie légitime.
     *
     * On ne corrige donc pas en élargissant le privilège : la colonne est
     * tenue par le déclencheur `users_updated_at`, et le back-office n'a
     * aucune raison de l'écrire.
     */
    expect(
      await dansLaPeauDe(
        gerant,
        'update kaissi.users set pin_hash = $2, updated_at = now() where id = $1',
        [cuisinier, 'HACHE-2'],
      ),
    ).toBe('refuse')

    // Et l'e-mail reste hors d'atteinte : le changer désynchroniserait la
    // ligne applicative de `auth.users`, en silence.
    expect(
      await dansLaPeauDe(gerant, 'update kaissi.users set email = $2 where id = $1', [
        cuisinier,
        'ailleurs@exemple.tn',
      ]),
    ).toBe('refuse')
  })

  it('le déclencheur pose `updated_at` tout seul', async () => {
    const avant = await client.query<{ updated_at: string }>(
      'select updated_at from kaissi.users where id = $1',
      [cuisinier],
    )
    await client.query(`update kaissi.users set status = 'suspendu' where id = $1`, [cuisinier])
    const apres = await client.query<{ updated_at: string }>(
      'select updated_at from kaissi.users where id = $1',
      [cuisinier],
    )
    expect(new Date(apres.rows[0]!.updated_at).getTime()).toBeGreaterThan(
      new Date(avant.rows[0]!.updated_at).getTime(),
    )
  })

  it('ne touche PAS un employé d’un autre établissement', async () => {
    const { rows } = await client.query<{ id: string }>(
      'select id from kaissi.restaurants where id <> $1 limit 1',
      [DEMO_RESTO],
    )
    if (rows.length === 0) return
    const etranger = uuidV7()
    const compte = uuidV7()
    await client.query('insert into auth.users (id) values ($1)', [compte])
    await client.query(
      `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name)
       values ($1, $2, $3, $4, 'Ailleurs')`,
      [etranger, DEMO_ORG, compte, `${etranger}@equipe.tn`],
    )
    await client.query(
      `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
       values ($1, $2, $3, 'caissier')`,
      [DEMO_ORG, etranger, rows[0]!.id],
    )
    expect(
      await dansLaPeauDe(gerant, `update kaissi.users set status = 'suspendu' where id = $1`, [
        etranger,
      ]),
    ).toBe('filtre')
  })
})
