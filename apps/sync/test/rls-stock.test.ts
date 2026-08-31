/**
 * Ce que RLS autorise sur le stock (migration 0019).
 *
 * Le stock est une donnée de gestion : un cuisinier la LIT (il voit ce qui
 * manque), mais seul l'encadrement la corrige. Et rien de tout cela ne doit
 * traverser la frontière d'un autre client.
 *
 * On éprouve aussi la VUE `stock_actuel`, déclarée `security_invoker` : sans
 * cette option, elle s'exécuterait avec les droits de son propriétaire et
 * rendrait le stock de TOUS les restaurants — une fuite qu'aucune politique
 * sur les tables sous-jacentes n'aurait rattrapée.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

type Issue = 'applique' | 'filtre' | 'refuse'
const comptes = new Map<string, string>()

async function dansLaPeauDe(acteur: string, sql: string, valeurs: unknown[] = []): Promise<Issue> {
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

async function creer(role: string, organisation = DEMO_ORG, restaurant = DEMO_RESTO) {
  const compte = uuidV7()
  const id = uuidV7()
  await client.query('insert into auth.users (id) values ($1)', [compte])
  await client.query(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name, pin_hash)
     values ($1, $2, $3, $4, $5, 'HACHE')`,
    [id, organisation, compte, `${id}@stock.tn`, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [organisation, id, restaurant, role],
  )
  comptes.set(id, compte)
  return id
}

let gerant: string
let cuisinier: string
let produit: string

beforeAll(async () => {
  const { rows } = await client.query(
    'select id from kaissi.products where restaurant_id = $1 order by position limit 1',
    [DEMO_RESTO],
  )
  produit = rows[0].id
})

beforeEach(async () => {
  gerant = await creer('gerant')
  cuisinier = await creer('cuisine')
  await client.query('delete from kaissi.stock_items where product_id = $1', [produit])
  await client.query(
    `insert into kaissi.stock_items
       (product_id, organization_id, restaurant_id, qty_reference, counted_at, min_qty)
     values ($1, $2, $3, 10, now() - interval '1 hour', 3)`,
    [produit, DEMO_ORG, DEMO_RESTO],
  )
})

afterAll(async () => {
  await client.query('delete from kaissi.stock_items where product_id = $1', [produit])
  await client.query("delete from kaissi.users where email like '%@stock.tn'")
  await client.end()
})

describe('le stock se lit, mais ne se corrige pas par n’importe qui', () => {
  it('un cuisinier VOIT le stock — il doit savoir ce qui manque', async () => {
    expect(
      await dansLaPeauDe(cuisinier, 'select 1 from kaissi.stock_actuel where product_id = $1', [
        produit,
      ]),
    ).toBe('applique')
  })

  it('un cuisinier ne CORRIGE pas le comptage', async () => {
    // La clause USING de la politique « correction » exige est_gestionnaire :
    // la ligne est masquée à l'écriture, donc zéro ligne touchée.
    expect(
      await dansLaPeauDe(cuisinier, 'update kaissi.stock_items set qty_reference = 999 where product_id = $1', [
        produit,
      ]),
    ).toBe('filtre')
  })

  it('un gérant recompte et pose un seuil', async () => {
    expect(
      await dansLaPeauDe(
        gerant,
        'update kaissi.stock_items set qty_reference = 42, min_qty = 5 where product_id = $1',
        [produit],
      ),
    ).toBe('applique')
  })

  it('un gérant enregistre une réception', async () => {
    expect(
      await dansLaPeauDe(
        gerant,
        `insert into kaissi.stock_movements
           (organization_id, restaurant_id, product_id, qty_delta, reason)
         values ($1, $2, $3, 12, 'reception')`,
        [DEMO_ORG, DEMO_RESTO, produit],
      ),
    ).toBe('applique')
  })

  it('un gérant peut arrêter le suivi d’un produit', async () => {
    expect(
      await dansLaPeauDe(gerant, 'delete from kaissi.stock_items where product_id = $1', [produit]),
    ).toBe('applique')
  })

  it('un mouvement de ZÉRO est refusé par la base, pas seulement par l’écran', async () => {
    expect(
      await dansLaPeauDe(
        gerant,
        `insert into kaissi.stock_movements
           (organization_id, restaurant_id, product_id, qty_delta, reason)
         values ($1, $2, $3, 0, 'correction')`,
        [DEMO_ORG, DEMO_RESTO, produit],
      ),
    ).toBe('refuse')
  })
})

describe('la vue stock_actuel ne traverse pas les clients', () => {
  it('un gérant d’une AUTRE organisation ne voit rien', async () => {
    const autreOrg = uuidV7()
    const autreResto = uuidV7()
    await client.query(
      "insert into kaissi.organizations (id, name, slug) values ($1, 'Autre', $2)",
      [autreOrg, `autre-${autreOrg.slice(0, 8)}`],
    )
    await client.query(
      `insert into kaissi.restaurants (id, organization_id, name, slug)
       values ($1, $2, 'Autre resto', $3)`,
      [autreResto, autreOrg, `autre-${autreResto.slice(0, 8)}`],
    )
    const etranger = await creer('gerant', autreOrg, autreResto)

    // `security_invoker = true` est ce qui fait tenir cette assertion.
    expect(
      await dansLaPeauDe(etranger, 'select 1 from kaissi.stock_actuel where product_id = $1', [
        produit,
      ]),
    ).toBe('filtre')

    await client.query('delete from kaissi.memberships where restaurant_id = $1', [autreResto])
    await client.query('delete from kaissi.users where organization_id = $1', [autreOrg])
    await client.query('delete from kaissi.restaurants where id = $1', [autreResto])
    await client.query('delete from kaissi.organizations where id = $1', [autreOrg])
  })
})
