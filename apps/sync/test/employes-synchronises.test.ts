/**
 * Un employé créé ou modifié dans le back-office atteint-il les tablettes ?
 *
 * C'est la question que la migration 0011 répond. Avant elle, ni `users` ni
 * `memberships` n'alimentaient `change_log` : un gérant pouvait réinitialiser
 * un code PIN sans que cela ne quitte jamais le serveur. L'employé se serait
 * présenté devant une caisse qui ne le connaît pas, un vendredi soir, sans
 * que rien n'indique pourquoi.
 *
 * Ces tests tapent dans un vrai PostgreSQL avec le schéma de production.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

/** Identifiant de l'employé de test, régénéré à chaque cas. */
let employe: string

/** Les entrées « employees » du journal, de la plus récente à la plus ancienne. */
async function journal(): Promise<
  { restaurant: string; op: string; charge: Record<string, unknown> | null }[]
> {
  const { rows } = await client.query(
    `select restaurant_id, op, payload
       from kaissi.change_log
      where entity_type = 'employees' and entity_id = $1
      order by seq desc`,
    [employe],
  )
  return rows.map((r) => ({
    restaurant: r.restaurant_id as string,
    op: r.op as string,
    charge: r.payload as Record<string, unknown> | null,
  }))
}

async function creerEmploye(role = 'serveur', pin = 'HACHE-INITIAL'): Promise<void> {
  employe = uuidV7()
  await client.query('insert into auth.users (id) values ($1)', [employe])
  await client.query(
    `insert into kaissi.users (id, organization_id, email, full_name, pin_hash)
     values ($1, $2, $3, 'Employé de test', $4)`,
    [employe, DEMO_ORG, `${employe}@demo.tn`, pin],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [DEMO_ORG, employe, DEMO_RESTO, role],
  )
}

beforeEach(async () => {
  await client.query("delete from kaissi.change_log where entity_type = 'employees'")
})

afterAll(async () => {
  await client.end()
})

describe('un employé du back-office atteint la tablette', () => {
  it('sa création émet une entrée à la forme EXACTE de la table locale', async () => {
    await creerEmploye('caissier')
    const entrees = await journal()

    expect(entrees).toHaveLength(1)
    expect(entrees[0]?.op).toBe('insert')
    expect(entrees[0]?.restaurant).toBe(DEMO_RESTO)

    // Les clés doivent correspondre aux colonnes de packages/db-local
    // (employees) : le POS recopie colonne à colonne, sans rien transformer.
    expect(Object.keys(entrees[0]!.charge!).sort()).toEqual([
      'archived_at',
      'full_name',
      'id',
      'is_active',
      'organization_id',
      'permissions',
      'pin_hash',
      'restaurant_id',
      'role',
    ])
    expect(entrees[0]?.charge?.['id']).toBe(employe)
    expect(entrees[0]?.charge?.['role']).toBe('caissier')
    expect(entrees[0]?.charge?.['is_active']).toBe(1)
  })

  it("l'identifiant est celui de l'UTILISATEUR, pas celui de l'appartenance", async () => {
    await creerEmploye()
    const { rows } = await client.query(
      'select id from kaissi.memberships where user_id = $1',
      [employe],
    )
    // orders.opened_by et payments.created_by portent users.id. Envoyer
    // l'identifiant d'appartenance rendrait tout rapprochement impossible.
    expect(rows[0]?.id).not.toBe(employe)
    expect((await journal())[0]?.charge?.['id']).toBe(employe)
  })

  it('une réinitialisation de PIN voyage — c’est tout le sujet', async () => {
    await creerEmploye()
    await client.query("update kaissi.users set pin_hash = 'HACHE-NEUF' where id = $1", [employe])

    const entrees = await journal()
    expect(entrees[0]?.op).toBe('update')
    expect(entrees[0]?.charge?.['pin_hash']).toBe('HACHE-NEUF')
  })

  it('le PIN voyage HACHÉ, jamais en clair', async () => {
    await creerEmploye('serveur', '$argon2id$v=19$m=8192,t=3,p=1$c2Vs$aGFjaGU')
    const hache = (await journal())[0]?.charge?.['pin_hash']
    expect(hache).toMatch(/^\$argon2id\$/)
  })

  it('une suspension désactive sans effacer', async () => {
    await creerEmploye()
    await client.query("update kaissi.users set status = 'suspendu' where id = $1", [employe])

    const entrees = await journal()
    expect(entrees[0]?.op).toBe('update')
    // La ligne RESTE sur l'appareil : les commandes déjà passées à son nom
    // doivent rester lisibles. Seule la prise de poste est refusée.
    expect(entrees[0]?.charge?.['is_active']).toBe(0)
    expect(entrees[0]?.charge?.['full_name']).toBe('Employé de test')
  })

  it("une appartenance révoquée désactive aussi, sans toucher à l'utilisateur", async () => {
    await creerEmploye()
    await client.query(
      'update kaissi.memberships set revoked_at = now() where user_id = $1',
      [employe],
    )
    expect((await journal())[0]?.charge?.['is_active']).toBe(0)
  })

  it("l'appartenance supprimée demande une suppression locale", async () => {
    await creerEmploye()
    await client.query('delete from kaissi.memberships where user_id = $1', [employe])

    const entrees = await journal()
    expect(entrees[0]?.op).toBe('delete')
    expect(entrees[0]?.charge).toBeNull()
  })

  it('un changement sans intérêt pour la caisse ne réveille aucune tablette', async () => {
    await creerEmploye()
    const avant = (await journal()).length

    await client.query("update kaissi.users set phone = '+21620000000' where id = $1", [employe])

    // Sans ce filtre, chaque correction de fiche téléphonique ferait retélécharger
    // le catalogue à toutes les tablettes de l'établissement.
    expect((await journal()).length).toBe(avant)
  })
})

describe('plusieurs établissements — le cas qui justifie la boucle', () => {
  const autreResto = '01930000-0000-7000-8000-00000000b002'

  beforeEach(async () => {
    await client.query(
      `insert into kaissi.restaurants (id, organization_id, name, slug)
       values ($1, $2, 'Kaissi Lac 2', 'lac2-test')
       on conflict (id) do nothing`,
      [autreResto, DEMO_ORG],
    )
  })

  it('UNE réinitialisation de PIN atteint CHAQUE établissement, avec son rôle', async () => {
    await creerEmploye('caissier')
    await client.query(
      `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
       values ($1, $2, $3, 'gerant')`,
      [DEMO_ORG, employe, autreResto],
    )
    await client.query("delete from kaissi.change_log where entity_type = 'employees'")

    await client.query("update kaissi.users set pin_hash = 'HACHE-PARTOUT' where id = $1", [employe])

    const entrees = await journal()
    // Sans la boucle sur les appartenances, une seule caisse recevrait le
    // nouveau PIN — et l'employé serait refusé dans l'autre établissement.
    expect(entrees).toHaveLength(2)
    expect(new Set(entrees.map((e) => e.restaurant))).toEqual(new Set([DEMO_RESTO, autreResto]))
    for (const entree of entrees) expect(entree.charge?.['pin_hash']).toBe('HACHE-PARTOUT')

    // Le rôle est celui de l'établissement concerné, pas un rôle global.
    const parResto = Object.fromEntries(entrees.map((e) => [e.restaurant, e.charge?.['role']]))
    expect(parResto[DEMO_RESTO]).toBe('caissier')
    expect(parResto[autreResto]).toBe('gerant')
  })
})
