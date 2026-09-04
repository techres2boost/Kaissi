/**
 * « Prêt » redescend jusqu'à la caisse (migration 0029).
 *
 * La cuisine marquait un plateau prêt sur son écran, et le marqueur restait
 * au back-office : le serveur en salle repassait devant la cuisine « au cas
 * où » — exactement ce que l'écran devait supprimer.
 *
 * Le marqueur descend par `change_log`, le canal qui porte déjà le catalogue.
 * Ces tests vérifient les deux choses qui rendent cela utilisable :
 *
 *   1. poser un « prêt » écrit bien une entrée journalisée, avec
 *      l'identifiant de la COMMANDE — c'est lui qui allume le badge ;
 *   2. le RETRAIT descend aussi. C'est le point qui se casse en premier :
 *      supprimer la ligne aurait été le geste naturel, et une suppression
 *      ne descend pas — le badge serait resté allumé pour toujours sur un
 *      plat qui ne l'est pas.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { reparerProjectionsOrphelines } from '../src/reparation.js'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

let appareil: string
let commande: string

beforeAll(async () => {
  appareil = uuidV7()
  await client.query(
    `insert into kaissi.devices
       (id, organization_id, restaurant_id, label, type, ticket_prefix,
        token_hash, app_version, protocol_version)
     values ($1,$2,$3,'Terminal prêt','pos','KP','EMPREINTE','0.2.0',1)`,
    [appareil, DEMO_ORG, DEMO_RESTO],
  )
})

beforeEach(async () => {
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
  await client.query('delete from kaissi.orders where device_id = $1', [appareil])
  await client.query('delete from kaissi.devices where id = $1', [appareil])
  await depot.fermer()
  await client.end()
})

/** Le curseur de tête, pour ne lire que ce qui arrive APRÈS. */
async function curseur(): Promise<number> {
  const { rows } = await client.query<{ seq: string | null }>(
    'select max(seq) as seq from kaissi.change_log where restaurant_id = $1',
    [DEMO_RESTO],
  )
  return Number(rows[0]?.seq ?? 0)
}

async function marquerPrete() {
  await client.query(
    `insert into kaissi.kitchen_ready (order_id, organization_id, restaurant_id)
     values ($1, $2, $3)
     on conflict (order_id) do update
       set ready_at = now(), cleared_at = null, cleared_by = null`,
    [commande, DEMO_ORG, DEMO_RESTO],
  )
}

describe('« prêt » descend par le catalogue', () => {
  it('journalise le marqueur sous l’identifiant de la COMMANDE', async () => {
    const depuis = await curseur()
    await marquerPrete()

    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    const entree = page.find((c) => c.entite === 'kitchen_ready')
    expect(entree).toBeDefined()
    // `entity_id` porte l'identifiant de la commande, et non un `id` de
    // ligne : c'est celui dont la tablette a besoin pour allumer le bon
    // badge, et `kitchen_ready` n'a de toute façon pas de colonne `id`.
    expect(entree!.entiteId).toBe(commande)
    expect(entree!.operation).toBe('insert')
    expect(entree!.donnees).toMatchObject({ order_id: commande, cleared_at: null })
  })

  it('fait DESCENDRE le retrait, au lieu de faire disparaître la ligne', async () => {
    await marquerPrete()
    const depuis = await curseur()

    await client.query(
      `update kaissi.kitchen_ready set cleared_at = now() where order_id = $1`,
      [commande],
    )

    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    const entree = page.find((c) => c.entite === 'kitchen_ready')
    expect(entree).toBeDefined()
    expect(entree!.operation).toBe('update')
    // La donnée qui éteint le badge. Une suppression n'aurait rien envoyé de
    // tel : le POS ne saurait jamais que le plat n'est plus prêt.
    expect(entree!.donnees?.['cleared_at']).not.toBeNull()
  })

  it('ne réveille pas les curseurs des autres établissements', async () => {
    // RÈGLE 3 : la tenance est portée par la ligne elle-même, donc le
    // journal l'est aussi. Un « prêt » chez un client n'a rien à faire dans
    // la page d'un autre.
    const depuis = await curseur()
    await marquerPrete()
    const { rows } = await client.query<{ restaurant_id: string }>(
      'select distinct restaurant_id from kaissi.change_log where seq > $1',
      [depuis],
    )
    expect(rows.map((r) => r.restaurant_id)).toEqual([DEMO_RESTO])
  })

  it('reprend le même marqueur quand la cuisine le repose', async () => {
    await marquerPrete()
    await client.query(
      `update kaissi.kitchen_ready set cleared_at = now() where order_id = $1`,
      [commande],
    )
    const depuis = await curseur()

    await marquerPrete()

    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    const entree = page.find((c) => c.entite === 'kitchen_ready')
    // Une seule ligne par commande, remise à zéro : si le conflit était
    // ignoré, `cleared_at` resterait posé et le plat resterait éteint en
    // salle alors que la cuisine vient de le déclarer prêt.
    expect(entree!.donnees).toMatchObject({ order_id: commande, cleared_at: null })
    const { rows } = await client.query<{ n: string }>(
      'select count(*) as n from kaissi.kitchen_ready where order_id = $1',
      [commande],
    )
    expect(Number(rows[0]!.n)).toBe(1)
  })

  it('purge les vieux marqueurs du journal, et RIEN d’autre', async () => {
    await marquerPrete()
    // On les vieillit de dix jours : la purge se règle sur `created_at`, pas
    // sur le curseur — un seq est monotone, il ne dit pas l'âge.
    await client.query(
      `update kaissi.change_log set created_at = now() - interval '10 days'
        where entity_type = 'kitchen_ready' and entity_id = $1`,
      [commande],
    )
    // Un changement de CATALOGUE du même âge : il doit survivre. Le purger
    // ferait manquer un changement de prix à un appareil en retard.
    const { rows: temoin } = await client.query<{ seq: string }>(
      `insert into kaissi.change_log
         (organization_id, restaurant_id, entity_type, entity_id, op, payload, created_at)
       values ($1, $2, 'products', $3, 'update', '{}'::jsonb, now() - interval '10 days')
       returning seq`,
      [DEMO_ORG, DEMO_RESTO, uuidV7()],
    )

    await reparerProjectionsOrphelines(depot, { journaliser: () => {} })

    const { rows: restants } = await client.query<{ n: string }>(
      `select count(*) as n from kaissi.change_log
        where entity_type = 'kitchen_ready' and entity_id = $1`,
      [commande],
    )
    expect(Number(restants[0]!.n)).toBe(0)

    const { rows: survivant } = await client.query<{ n: string }>(
      'select count(*) as n from kaissi.change_log where seq = $1',
      [temoin[0]!.seq],
    )
    expect(Number(survivant[0]!.n)).toBe(1)
    await client.query('delete from kaissi.change_log where seq = $1', [temoin[0]!.seq])
  })
})
