/**
 * La cuisine et le bar notifiés à l'ARRIVÉE d'un envoi (0047).
 *
 * Demandé en démonstration : un téléphone de cuisine posé écran éteint ne
 * sonnait pas. On vérifie ici, contre la vraie base, les quatre règles qui
 * rendent la notification digne de confiance :
 *
 *   1. un envoi en cuisine NOUVEAU notifie, avec ses plats ;
 *   2. un RENVOI du même lot (réseau qui hoquette) ne notifie pas deux fois ;
 *   3. un AJOUT est annoncé comme tel, avec ses seuls plats nouveaux ;
 *   4. une vente envoyée ET encaissée dans le même lot ne sonne pas — il n'y
 *      a plus rien à préparer ;
 *
 * et que le bon POSTE est visé : le barman ne reçoit pas les pizzas.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { messagePreparation } from '../src/alertes.js'
import type { EnvoiCuisine } from '../src/depot.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_2,
  EMPLOYE_DEMO,
  ESPECES,
  GERANT_DEMO,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const CUISINE = '01930000-0000-7000-8000-000000000030'
const BAR = '01930000-0000-7000-8000-000000000031'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const recus: EnvoiCuisine[][] = []
const app = creerServeur({
  depot,
  surEnvoiCuisine: async (envois) => {
    recus.push([...envois])
  },
})
const client = new Client({ connectionString: URL_TEST })
await client.connect()

beforeEach(async () => {
  recus.length = 0
  await nettoyer()
})
afterAll(async () => {
  await client.query("delete from kaissi.push_subscriptions where endpoint like 'https://test.push/%'")
  await client.query('update kaissi.memberships set station_id = null where user_id = $1', [EMPLOYE_2])
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
    clientTs: new Date(Date.UTC(2026, 9, 18, 21) + seq).toISOString(),
    actorUserId: null,
  })
}

const plat = (designation: string, stationId: string | null = null, quantite = 1) => ({
  ligneId: uuidV7(),
  produitId: '01930000-0000-7000-8000-000000000200',
  designation,
  quantite,
  prixBaseMillimes: millimes(10_000),
  modificateursMillimes: millimes(0),
  tauxTaxeId: TVA_19,
  ...(stationId ? { stationId } : {}),
})

async function pousser(a: AppareilTest, evenements: unknown[]) {
  const r = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  expect(r.status).toBe(200)
  // La notification part sans être attendue : on lui laisse le temps.
  await new Promise((fin) => setTimeout(fin, 20))
}

describe('notification à l’arrivée en préparation', () => {
  it('un envoi neuf notifie une fois — un renvoi du même lot, jamais', async () => {
    const a = await creerAppareil('N1')
    const e = caisse(a)
    const table = uuidV7()
    const lot = [
      e(table, 'order.opened', { type: 'dine_in', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'N1-000001' }),
      e(table, 'line.added', plat('Couscous poulet', CUISINE, 2)),
      e(table, 'line.added', plat('Citronnade', BAR)),
      e(table, 'order.sent', { stationIds: [CUISINE, BAR] }),
    ]
    await pousser(a, lot)
    expect(recus).toHaveLength(1)
    const [envoi] = recus[0]!
    expect(envoi!.ajout).toBe(false)
    expect(envoi!.lignes.map((l) => `${l.quantite}× ${l.designation}`)).toEqual([
      '2× Couscous poulet',
      '1× Citronnade',
    ])

    await pousser(a, lot)
    expect(recus, 'le renvoi d’un lot déjà reçu ne doit pas re-sonner').toHaveLength(1)
  })

  it('un ajout est annoncé comme tel, avec ses SEULS plats nouveaux', async () => {
    const a = await creerAppareil('N2')
    const e = caisse(a)
    const table = uuidV7()
    await pousser(a, [
      e(table, 'order.opened', { type: 'dine_in', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'N2-000001' }),
      e(table, 'line.added', plat('Steak de bœuf', CUISINE)),
      e(table, 'order.sent', { stationIds: [CUISINE] }),
    ])
    await pousser(a, [
      e(table, 'line.added', plat('Penne au saumon', CUISINE)),
      e(table, 'order.sent', { stationIds: [CUISINE] }),
    ])
    expect(recus).toHaveLength(2)
    const ajout = recus[1]![0]!
    expect(ajout.ajout).toBe(true)
    expect(ajout.lignes.map((l) => l.designation)).toEqual(['Penne au saumon'])
    expect(messagePreparation(ajout).titre).toMatch(/^Ajout — /)
  })

  it('envoyée ET encaissée dans le même lot : rien à préparer, rien ne sonne', async () => {
    const a = await creerAppareil('N3')
    const e = caisse(a)
    const vente = uuidV7()
    await pousser(a, [
      e(vente, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'N3-000001' }),
      e(vente, 'line.added', plat('Ojja', CUISINE)),
      e(vente, 'order.sent', { stationIds: [CUISINE] }),
      e(vente, 'payment.recorded', {
        paiementId: uuidV7(),
        methodeId: ESPECES,
        mode: 'cash',
        montantMillimes: millimes(10_000),
        recuMillimes: millimes(10_000),
        renduMillimes: millimes(0),
      }),
      e(vente, 'order.closed', { totalMillimes: millimes(10_000), closePar: EMPLOYE_DEMO }),
    ])
    expect(recus).toHaveLength(0)
  })

  it('le message ne porte aucun montant, et nomme la table', () => {
    const m = messagePreparation({
      restaurantId: DEMO_RESTO,
      orderId: uuidV7(),
      numero: 'P1-000004',
      table: '3',
      type: 'dine_in',
      ajout: false,
      lignes: [
        { designation: 'Couscous', quantite: 2, stationId: null },
        { designation: 'Coca', quantite: 1, stationId: null },
      ],
    })
    expect(m).toEqual({ titre: 'Nouvelle commande — Table 3', corps: '2× Couscous, 1× Coca' })
    expect(JSON.stringify(m)).not.toMatch(/TND|\d+,\d{3}/)
  })
})

describe('le bon POSTE reçoit, et lui seul', () => {
  it('le barman ne reçoit pas les plats de la cuisine ; le gérant reçoit tout', async () => {
    await client.query('update kaissi.memberships set station_id = $2 where user_id = $1', [EMPLOYE_2, BAR])
    for (const [user, endpoint] of [
      [GERANT_DEMO, 'https://test.push/gerant'],
      [EMPLOYE_2, 'https://test.push/barman'],
    ]) {
      await client.query(
        `insert into kaissi.push_subscriptions
           (organization_id, restaurant_id, user_id, endpoint, p256dh, auth,
            alertes_stock, alertes_preparation)
         values ($1, $2, $3, $4, 'cle', 'auth', false, true)
         on conflict (endpoint) do update set alertes_preparation = true`,
        [DEMO_ORG, DEMO_RESTO, user, endpoint],
      )
    }
    const pourCuisine = await depot.abonnementsPreparation(DEMO_RESTO, [CUISINE])
    const pourBar = await depot.abonnementsPreparation(DEMO_RESTO, [BAR])
    expect(pourCuisine.map((a) => a.endpoint).sort()).toEqual(['https://test.push/gerant'])
    expect(pourBar.map((a) => a.endpoint).sort()).toEqual([
      'https://test.push/barman',
      'https://test.push/gerant',
    ])
  })

  it('un navigateur qui n’a rien demandé ne reçoit rien', async () => {
    await client.query(
      `insert into kaissi.push_subscriptions
         (organization_id, restaurant_id, user_id, endpoint, p256dh, auth)
       values ($1, $2, $3, 'https://test.push/stock-seulement', 'cle', 'auth')
       on conflict (endpoint) do nothing`,
      [DEMO_ORG, DEMO_RESTO, GERANT_DEMO],
    )
    const tous = await depot.abonnementsPreparation(DEMO_RESTO, [CUISINE, BAR])
    expect(tous.map((a) => a.endpoint)).not.toContain('https://test.push/stock-seulement')
  })
})
