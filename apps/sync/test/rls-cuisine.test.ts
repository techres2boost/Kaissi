/**
 * Ce que RLS autorise à l'écran de cuisine (migration 0018).
 *
 * L'écran de cuisine est la première page du back-office ouverte par un rôle
 * qui n'est PAS un gestionnaire. Il fallait donc vérifier les deux bords :
 * qu'un cuisinier peut faire son travail, et qu'il ne peut rien faire
 * d'autre — en particulier chez un autre client.
 *
 * Comme dans `rls-backoffice.test.ts`, ces tests empruntent réellement le
 * rôle `authenticated` et posent la revendication `sub` à la façon de
 * PostgREST. Lire une politique ne prouve rien ; l'exécuter en
 * superutilisateur non plus, puisque le propriétaire contourne tout.
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
    [id, organisation, compte, `${id}@cuisine.tn`, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [organisation, id, restaurant, role],
  )
  comptes.set(id, compte)
  return id
}

let cuisinier: string
let gerant: string
let commande: string
let appareil: string

// L'appareil est créé UNE fois : son préfixe de ticket est unique par
// restaurant, et le recréer à chaque cas violerait cette contrainte — qui est
// précisément là pour qu'aucune numérotation ne se télescope entre terminaux.
beforeAll(async () => {
  appareil = uuidV7()
  await client.query(
    `insert into kaissi.devices
       (id, organization_id, restaurant_id, label, type, ticket_prefix,
        token_hash, app_version, protocol_version)
     values ($1,$2,$3,'Terminal cuisine','pos','KC','EMPREINTE','0.2.0',1)`,
    [appareil, DEMO_ORG, DEMO_RESTO],
  )
})

beforeEach(async () => {
  // Des acteurs et une commande neufs à chaque cas : un test qui laisserait
  // une trace empoisonnerait les suivants sans qu'on comprenne pourquoi.
  cuisinier = await creer('cuisine')
  gerant = await creer('gerant')

  // Une commande ENVOYÉE en cuisine, telle que la projette l'API de sync.
  commande = uuidV7()
  await client.query(
    `insert into kaissi.orders
       (id, organization_id, restaurant_id, device_id, status, opened_at, sent_at)
     values ($1,$2,$3,$4,'envoyee', now(), now())`,
    [commande, DEMO_ORG, DEMO_RESTO, appareil],
  )
})

afterAll(async () => {
  await client.query('delete from kaissi.kitchen_ready')
  await client.query('delete from kaissi.orders where device_id in (select id from kaissi.devices where ticket_prefix = $1)', ['KC'])
  await client.query("delete from kaissi.devices where ticket_prefix = 'KC'")
  await client.query("delete from kaissi.users where email like '%@cuisine.tn'")
  await client.end()
})

const MARQUER = `insert into kaissi.kitchen_ready
                   (order_id, organization_id, restaurant_id) values ($1, $2, $3)`

describe('un cuisinier fait son travail', () => {
  it('voit les commandes envoyées de son restaurant', async () => {
    expect(
      await dansLaPeauDe(cuisinier, 'select 1 from kaissi.orders where id = $1', [commande]),
    ).toBe('applique')
  })

  it('annonce une commande prête', async () => {
    expect(
      await dansLaPeauDe(cuisinier, MARQUER, [commande, DEMO_ORG, DEMO_RESTO]),
    ).toBe('applique')
  })

  it('retire un « prêt » posé par erreur, sans attendre un gérant', async () => {
    // Attendre l'encadrement pour défaire un clic ferait sortir un plat en
    // retard, et l'écran perdrait sa crédibilité dès le premier service.
    await client.query(MARQUER, [commande, DEMO_ORG, DEMO_RESTO])
    expect(
      await dansLaPeauDe(cuisinier, 'delete from kaissi.kitchen_ready where order_id = $1', [
        commande,
      ]),
    ).toBe('applique')
    await client.query('delete from kaissi.kitchen_ready where order_id = $1', [commande])
  })

  it('un gérant voit ce que la cuisine a annoncé', async () => {
    await client.query(MARQUER, [commande, DEMO_ORG, DEMO_RESTO])
    expect(
      await dansLaPeauDe(gerant, 'select 1 from kaissi.kitchen_ready where order_id = $1', [
        commande,
      ]),
    ).toBe('applique')
    await client.query('delete from kaissi.kitchen_ready where order_id = $1', [commande])
  })
})

describe('cloisonnement — l’écran de cuisine ne traverse pas les clients', () => {
  it('un cuisinier d’un autre restaurant ne voit ni la commande, ni le « prêt »', async () => {
    const autreOrg = uuidV7()
    const autreResto = uuidV7()
    await client.query(
      "insert into kaissi.organizations (id, name, slug) values ($1, 'Autre', $2)",
      [autreOrg, `autre-${autreOrg.slice(0, 8)}`],
    )
    await client.query(
      `insert into kaissi.restaurants (id, organization_id, name, slug)
       values ($1, $2, 'Autre resto', $3)`,
      [autreResto, autreOrg, `autre-resto-${autreResto.slice(0, 8)}`],
    )
    const etranger = await creer('cuisine', autreOrg, autreResto)
    await client.query(MARQUER, [commande, DEMO_ORG, DEMO_RESTO])

    expect(
      await dansLaPeauDe(etranger, 'select 1 from kaissi.orders where id = $1', [commande]),
    ).toBe('filtre')
    expect(
      await dansLaPeauDe(etranger, 'select 1 from kaissi.kitchen_ready where order_id = $1', [
        commande,
      ]),
    ).toBe('filtre')
    // Et il ne peut pas non plus en poser un chez le voisin : c'est la clause
    // WITH CHECK qui refuse, pas un filtre silencieux.
    expect(
      await dansLaPeauDe(etranger, MARQUER, [commande, DEMO_ORG, DEMO_RESTO]),
    ).toBe('refuse')

    await client.query('delete from kaissi.kitchen_ready where order_id = $1', [commande])
    await client.query('delete from kaissi.memberships where restaurant_id = $1', [autreResto])
    await client.query('delete from kaissi.users where organization_id = $1', [autreOrg])
    await client.query('delete from kaissi.restaurants where id = $1', [autreResto])
    await client.query('delete from kaissi.organizations where id = $1', [autreOrg])
  })
})
