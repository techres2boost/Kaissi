/**
 * « Prêt » couvre des ENVOIS, pas une commande pour toujours (0046).
 *
 * PANNE OBSERVÉE en démonstration. Table 1 : la cuisine prépare, marque
 * « prêt ». Le serveur ajoute deux plats à la même table et les envoie. La
 * cuisine les reçoit… déjà cochés « prêt » — ils ne seront jamais préparés.
 *
 * On rejoue exactement ce service, contre la vraie base, et on lit ce que
 * lit l'écran de préparation : le rang du dernier envoi de la commande, le
 * rang du « prêt », et le rang de l'envoi qui a porté chaque ligne.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres, envoisEnCuisine } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })
const client = new Client({ connectionString: URL_TEST })
await client.connect()

beforeEach(nettoyer)
afterAll(async () => {
  await client.query('delete from kaissi.kitchen_ready where restaurant_id = $1', [DEMO_RESTO])
  await client.end()
  await depot.fermer()
})

function caisse(a: AppareilTest) {
  let seq = 0
  return (orderId: string, type: string, payload: unknown) => ({
    eventId: uuidV7(),
    orderId,
    organizationId: DEMO_ORG,
    restaurantId: DEMO_RESTO,
    deviceId: a.id,
    seqDevice: (seq += 1),
    type,
    payload,
    clientTs: new Date(Date.UTC(2026, 9, 18, 20) + seq).toISOString(),
    actorUserId: null,
  })
}

const plat = (ligneId: string, designation: string) => ({
  ligneId,
  produitId: '01930000-0000-7000-8000-000000000200',
  designation,
  quantite: 1,
  prixBaseMillimes: millimes(19_000),
  modificateursMillimes: millimes(0),
  tauxTaxeId: TVA_19,
})

async function pousser(a: AppareilTest, evenements: unknown[]) {
  const r = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  expect(r.status).toBe(200)
}

/** Ce que l'écran de préparation calcule, et rien d'autre. */
async function ecranCuisine(orderId: string) {
  const { rows: [c] } = await client.query(
    'select status, last_sent_seq from kaissi.orders where id = $1',
    [orderId],
  )
  const { rows: [m] } = await client.query(
    'select sent_seq from kaissi.kitchen_ready where order_id = $1 and cleared_at is null',
    [orderId],
  )
  const { rows: lignes } = await client.query(
    'select designation, sent_seq from kaissi.order_items where order_id = $1 order by position',
    [orderId],
  )
  const dernier = c.last_sent_seq === null ? null : Number(c.last_sent_seq)
  const rangPret = m ? (m.sent_seq === null ? null : Number(m.sent_seq)) : undefined
  const prete = rangPret !== undefined && (rangPret === null || rangPret >= (dernier ?? 0))
  return {
    statut: c.status as string,
    dernier,
    prete,
    nouvelles: lignes
      .filter((l) => rangPret != null && l.sent_seq !== null && Number(l.sent_seq) > rangPret)
      .map((l) => l.designation as string),
  }
}

/** Le geste de la cuisine : « prêt », jusqu'au rang qu'elle a À L'ÉCRAN. */
async function marquerPrete(orderId: string, rangVu: number | null) {
  await client.query(
    `insert into kaissi.kitchen_ready (order_id, organization_id, restaurant_id, sent_seq)
     values ($1, $2, $3, $4)
     on conflict (order_id) do update set sent_seq = excluded.sent_seq,
       ready_at = now(), cleared_at = null`,
    [orderId, DEMO_ORG, DEMO_RESTO, rangVu ?? 0],
  )
}

describe('« prêt » couvre des envois', () => {
  it('table 1 : prête, puis un ajout envoyé la ROUVRE, avec ses seuls plats nouveaux', async () => {
    const a = await creerAppareil('P1')
    const e = caisse(a)
    const table = uuidV7()

    // 1. Deux plats, envoyés en cuisine.
    await pousser(a, [
      e(table, 'order.opened', { type: 'dine_in', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'P1-000004' }),
      e(table, 'line.added', plat(uuidV7(), 'Couscous poulet')),
      e(table, 'line.added', plat(uuidV7(), 'Steak de bœuf')),
      e(table, 'order.sent', { stationIds: [] }),
    ])
    let ecran = await ecranCuisine(table)
    expect(ecran.statut).toBe('envoyee')
    expect(ecran.prete).toBe(false)

    // 2. La cuisine les prépare, et dit « prêt ».
    await marquerPrete(table, ecran.dernier)
    expect((await ecranCuisine(table)).prete).toBe(true)

    // 3. Le serveur ajoute deux plats à la même table et les ENVOIE.
    await pousser(a, [
      e(table, 'line.added', plat(uuidV7(), 'Couscous poulet')),
      e(table, 'line.added', plat(uuidV7(), 'Penne aux saumon')),
      e(table, 'order.sent', { stationIds: [] }),
    ])
    ecran = await ecranCuisine(table)
    expect(ecran.prete, 'la table doit revenir en cuisine, à préparer').toBe(false)
    expect(ecran.nouvelles, 'et seuls les plats AJOUTÉS sont à faire').toEqual([
      'Couscous poulet',
      'Penne aux saumon',
    ])

    // 4. La cuisine prépare l'ajout : prête de nouveau.
    await marquerPrete(table, ecran.dernier)
    expect((await ecranCuisine(table)).prete).toBe(true)
  })

  it('un ajout NON envoyé ne rouvre rien : la cuisine ne l’a pas reçu', async () => {
    const a = await creerAppareil('P2')
    const e = caisse(a)
    const table = uuidV7()
    await pousser(a, [
      e(table, 'order.opened', { type: 'dine_in', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'P2-000001' }),
      e(table, 'line.added', plat(uuidV7(), 'Ojja')),
      e(table, 'order.sent', { stationIds: [] }),
    ])
    await marquerPrete(table, (await ecranCuisine(table)).dernier)
    await pousser(a, [e(table, 'line.added', plat(uuidV7(), 'Dessert'))])
    expect((await ecranCuisine(table)).prete).toBe(true)
  })

  it('un envoi arrivé ENTRE l’affichage et le clic « prêt » n’est pas couvert', async () => {
    const a = await creerAppareil('P3')
    const e = caisse(a)
    const table = uuidV7()
    await pousser(a, [
      e(table, 'order.opened', { type: 'dine_in', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'P3-000001' }),
      e(table, 'line.added', plat(uuidV7(), 'Brik')),
      e(table, 'order.sent', { stationIds: [] }),
    ])
    const rangAffiche = (await ecranCuisine(table)).dernier
    // Pendant que la cuisine regarde son écran, un ajout arrive.
    await pousser(a, [
      e(table, 'line.added', plat(uuidV7(), 'Salade')),
      e(table, 'order.sent', { stationIds: [] }),
    ])
    await marquerPrete(table, rangAffiche)
    const ecran = await ecranCuisine(table)
    expect(ecran.prete).toBe(false)
    expect(ecran.nouvelles).toEqual(['Salade'])
  })
})

describe('envoisEnCuisine — lecture du journal dans l’ordre du serveur', () => {
  it('chaque ligne prend le rang du PREMIER envoi qui la suit', () => {
    const r = envoisEnCuisine([
      { type: 'order.opened', server_seq: 1, payload: {} },
      { type: 'line.added', server_seq: 2, payload: { ligneId: 'a' } },
      { type: 'order.sent', server_seq: 3, payload: {} },
      { type: 'line.added', server_seq: 4, payload: { ligneId: 'b' } },
      { type: 'line.added', server_seq: 5, payload: { ligneId: 'c' } },
      { type: 'order.sent', server_seq: 6, payload: {} },
      { type: 'line.added', server_seq: 7, payload: { ligneId: 'd' } },
    ])
    expect(r.dernier).toBe(6)
    expect(Object.fromEntries(r.parLigne)).toEqual({ a: 3, b: 6, c: 6 })
    expect(r.parLigne.has('d')).toBe(false)
  })

  it('sans envoi, pas de rang', () => {
    const r = envoisEnCuisine([{ type: 'line.added', server_seq: '9', payload: { ligneId: 'x' } }])
    expect(r.dernier).toBeNull()
    expect(r.parLigne.size).toBe(0)
  })
})
