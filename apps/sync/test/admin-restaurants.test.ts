/**
 * Ouvrir un NOUVEL établissement (route POST /admin/restaurants).
 *
 * ── Pourquoi cette route existe côté service ──────────────────────────────
 *
 * La toute PREMIÈRE appartenance à un établissement ne peut pas être créée
 * sous RLS : il faudrait déjà appartenir à l'établissement pour s'y
 * rattacher. Un restaurant créé sans appartenance serait invisible de tout le
 * monde — y compris de son auteur — et irrattrapable depuis l'interface.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 *
 * Le service parle à Postgres avec un rôle privilégié : RLS ne le filtre pas.
 * Ce sont donc CES contrôles-là qui tiennent la frontière :
 *
 *   1. seul un ADMINISTRATEUR ouvre un établissement — un gérant exploite le
 *      sien ;
 *   2. l'organisation est dérivée d'un établissement que l'appelant
 *      administre DÉJÀ, jamais du corps de la requête : sans cela, un
 *      administrateur ouvrirait un restaurant chez un autre client ;
 *   3. la création est ATOMIQUE — établissement, réglages et appartenance,
 *      ou rien.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const AUTH = { url: 'https://exemple.supabase.co', cleAnon: 'anon-de-test' }
const jetons = new Map<string, string>()

/** Supabase est simulé : ces tests vérifient NOS décisions, pas les siennes. */
const fetchSimule: typeof fetch = async (entree, init) => {
  if (String(entree).endsWith('/auth/v1/user')) {
    const jeton = (new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '')
    const id = jetons.get(jeton)
    return new Response(
      JSON.stringify(id ? { id, email: `${id}@compte.tn` } : { message: 'invalid token' }),
      { status: id ? 200 : 401, headers: { 'content-type': 'application/json' } },
    )
  }
  return new Response('{}', { status: 500 })
}

const app = creerServeur({
  depot,
  auth: AUTH,
  fetchAuth: fetchSimule,
  cleService: 'service-de-test',
})

const SUFFIXE = '@ouverture-test.tn'
const crees: string[] = []

async function acteur(role: string, restaurantId = DEMO_RESTO) {
  const compte = uuidV7()
  const employeId = uuidV7()
  const jeton = `jeton-${compte}`
  await client.query('insert into auth.users (id) values ($1)', [compte])
  await client.query(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name)
     values ($1, $2, $3, $4, $5)`,
    [employeId, DEMO_ORG, compte, `${employeId}${SUFFIXE}`, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [DEMO_ORG, employeId, restaurantId, role],
  )
  jetons.set(jeton, compte)
  return { jeton, employeId }
}

function ouvrir(jeton: string | null, corps: unknown) {
  return app.request('http://test/admin/restaurants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: JSON.stringify(corps),
  })
}

let admin: { jeton: string; employeId: string }
let gerant: { jeton: string; employeId: string }

beforeAll(async () => {
  admin = await acteur('admin')
  gerant = await acteur('gerant')
})

afterAll(async () => {
  for (const id of crees) {
    await client.query('delete from kaissi.memberships where restaurant_id = $1', [id])
    await client.query('delete from kaissi.tax_rates where restaurant_id = $1', [id])
    await client.query('delete from kaissi.payment_methods where restaurant_id = $1', [id])
    await client.query('delete from kaissi.stations where restaurant_id = $1', [id])
    await client.query('delete from kaissi.restaurants where id = $1', [id])
  }
  await client.query(`delete from kaissi.memberships where user_id in
    (select id from kaissi.users where email like '%${SUFFIXE}')`)
  await client.query(`delete from kaissi.users where email like '%${SUFFIXE}'`)
  await depot.fermer()
  await client.end()
})

describe('POST /admin/restaurants', () => {
  it('un ADMINISTRATEUR ouvre un établissement, avec ses réglages et son accès', async () => {
    const reponse = await ouvrir(admin.jeton, { nom: 'Snack Lac 2' })
    expect(reponse.status).toBe(200)
    const corps = (await reponse.json()) as { restaurantId: string; reglagesCopies: number }
    crees.push(corps.restaurantId)

    const { rows } = await client.query<{ name: string; slug: string; organization_id: string }>(
      'select name, slug, organization_id from kaissi.restaurants where id = $1',
      [corps.restaurantId],
    )
    expect(rows[0]?.name).toBe('Snack Lac 2')
    // Le slug est DÉRIVÉ : le demander ajouterait un champ que personne ne
    // sait remplir, pour une valeur qui n'apparaît nulle part.
    expect(rows[0]?.slug).toBe('snack-lac-2')
    // L'organisation vient du modèle, jamais du client.
    expect(rows[0]?.organization_id).toBe(DEMO_ORG)

    // Sans taux de taxe ni mode de paiement, une caisse ne peut RIEN
    // encaisser — elle refuserait la première vente sans dire pourquoi.
    const taxes = await client.query(
      'select 1 from kaissi.tax_rates where restaurant_id = $1',
      [corps.restaurantId],
    )
    const paiements = await client.query(
      'select 1 from kaissi.payment_methods where restaurant_id = $1',
      [corps.restaurantId],
    )
    expect(taxes.rowCount, 'des taux de taxe').toBeGreaterThan(0)
    expect(paiements.rowCount, 'des modes de paiement').toBeGreaterThan(0)
    expect(corps.reglagesCopies).toBe((taxes.rowCount ?? 0) + (paiements.rowCount ?? 0) +
      ((await client.query('select 1 from kaissi.stations where restaurant_id = $1',
        [corps.restaurantId])).rowCount ?? 0))

    // Et l'appartenance de son auteur : sans elle, RLS ne lui rendrait pas
    // l'établissement qu'il vient de créer.
    const { rows: appartenance } = await client.query<{ role: string }>(
      'select role from kaissi.memberships where restaurant_id = $1 and user_id = $2',
      [corps.restaurantId, admin.employeId],
    )
    expect(appartenance[0]?.role).toBe('admin')
  })

  it('la CARTE n’est pas copiée — on ne devine pas un menu', async () => {
    const reponse = await ouvrir(admin.jeton, { nom: 'Sans carte' })
    const corps = (await reponse.json()) as { restaurantId: string }
    crees.push(corps.restaurantId)

    const produits = await client.query(
      'select 1 from kaissi.products where restaurant_id = $1',
      [corps.restaurantId],
    )
    expect(produits.rowCount).toBe(0)
  })

  it('désambiguïse un nom déjà pris plutôt que de refuser', async () => {
    // Deux établissements peuvent porter le même nom — deux « Chez Ali » dans
    // deux quartiers. Refuser la création pour une contrainte technique
    // invisible serait incompréhensible.
    const a = (await (await ouvrir(admin.jeton, { nom: 'Chez Ali' })).json()) as {
      restaurantId: string
    }
    const b = (await (await ouvrir(admin.jeton, { nom: 'Chez Ali' })).json()) as {
      restaurantId: string
    }
    crees.push(a.restaurantId, b.restaurantId)
    const { rows } = await client.query<{ slug: string }>(
      'select slug from kaissi.restaurants where id = any($1::uuid[]) order by slug',
      [[a.restaurantId, b.restaurantId]],
    )
    expect(rows.map((r) => r.slug)).toEqual(['chez-ali', 'chez-ali-2'])
  })

  it('REFUSE un gérant — il exploite le sien, il n’en ouvre pas un second', async () => {
    const reponse = await ouvrir(gerant.jeton, { nom: 'Interdit' })
    expect(reponse.status).toBe(401)
    const { rowCount } = await client.query(
      "select 1 from kaissi.restaurants where name = 'Interdit'",
    )
    expect(rowCount).toBe(0)
  })

  it('REFUSE un jeton inconnu', async () => {
    expect((await ouvrir('jeton-inventé', { nom: 'Pirate' })).status).toBe(401)
    expect((await ouvrir(null, { nom: 'Pirate' })).status).toBe(401)
  })

  it('IGNORE une organisation soufflée par le client', async () => {
    // Le point qui compte : le service contourne RLS. Accepter un
    // `organizationId` du corps ouvrirait un établissement chez un autre
    // client, et rien ne l'arrêterait.
    const autreOrg = uuidV7()
    await client.query(
      "insert into kaissi.organizations (id, name, slug) values ($1, 'Ailleurs', $2)",
      [autreOrg, `ailleurs-${autreOrg.slice(0, 8)}`],
    )
    const reponse = await ouvrir(admin.jeton, {
      nom: 'Tentative',
      organizationId: autreOrg,
    })
    const corps = (await reponse.json()) as { restaurantId: string }
    crees.push(corps.restaurantId)

    const { rows } = await client.query<{ organization_id: string }>(
      'select organization_id from kaissi.restaurants where id = $1',
      [corps.restaurantId],
    )
    expect(rows[0]?.organization_id).toBe(DEMO_ORG)
    await client.query('delete from kaissi.organizations where id = $1', [autreOrg])
  })

  it('REFUSE un modèle que l’appelant n’administre pas', async () => {
    const reponse = await ouvrir(admin.jeton, {
      nom: 'Tentative 2',
      modeleRestaurantId: uuidV7(),
    })
    expect(reponse.status).toBe(401)
  })

  it('refuse un nom vide, et une bascule mal écrite', async () => {
    expect((await ouvrir(admin.jeton, { nom: ' ' })).status).toBe(401)
    expect((await ouvrir(admin.jeton, { nom: 'Ok', bascule: '4h' })).status).toBe(401)
  })
})
