/**
 * Le ménage du registre d'idempotence ne rouvre JAMAIS la porte au double
 * encaissement.
 *
 * Question posée en démonstration : « il n'y a pas de purge ? la base va
 * déborder ». Les ventes ne se purgent pas — ce sont des pièces comptables.
 * Ce qui grossit sans rien protéger, c'est `sync_mutations` : un reçu par
 * événement, alors que l'idempotence des ventes est tenue par la clé
 * primaire de `order_events`.
 *
 * Ce test vérifie, contre un vrai PostgreSQL, les trois choses qui rendent
 * ce ménage sûr :
 *
 *   1. une vente dont les reçus ont été purgés, RENVOYÉE par une caisse
 *      sortie d'une longue panne, n'est comptée qu'une fois — au millime ;
 *   2. le registre du CATALOGUE, lui, qui est la seule garantie des
 *      créations depuis la caisse, survit bien plus longtemps ;
 *   3. la vente elle-même — journal et projection — n'est jamais touchée.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7, type Millimes } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  RETENTION_REGISTRE_DEFAUT,
  oublierDernierMenage,
  reparerProjectionsOrphelines,
} from '../src/reparation.js'
import {
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ESPECES,
  TVA_19,
  URL_TEST,
  creerAppareil,
  ev,
  nettoyer,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })
const silence = () => {}

async function sql(texte: string, valeurs: unknown[] = []) {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    return await client.query(texte, valeurs)
  } finally {
    await client.end()
  }
}

function vente(a: AppareilTest, prix: Millimes) {
  const orderId = uuidV7()
  return {
    orderId,
    evenements: [
      ev(a, orderId, 'order.opened', {
        type: 'takeaway',
        ouvertePar: EMPLOYE_DEMO,
        numeroTicket: `${a.prefixe}-${orderId.slice(-6)}`,
      }),
      ev(a, orderId, 'line.added', {
        ligneId: uuidV7(),
        produitId: '01930000-0000-7000-8000-000000000200',
        designation: 'Ojja merguez',
        quantite: 1,
        prixBaseMillimes: prix,
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      ev(a, orderId, 'payment.recorded', {
        paiementId: uuidV7(),
        methodeId: ESPECES,
        mode: 'cash',
        montantMillimes: prix,
        recuMillimes: prix,
      }),
      ev(a, orderId, 'order.closed', { totalMillimes: prix, closePar: EMPLOYE_DEMO }),
    ],
  }
}

async function pousser(a: AppareilTest, evenements: unknown[]) {
  const r = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  expect(r.status).toBe(200)
  return (await r.json()) as { rejetes: unknown[] }
}

/** Fait vieillir les reçus d'un appareil — comme s'ils dataient de `jours`. */
async function vieillir(deviceId: string, jours: number, ou = 'true') {
  await sql(
    `update kaissi.sync_mutations set received_at = now() - ($2 || ' days')::interval
      where device_id = $1 and ${ou}`,
    [deviceId, String(jours)],
  )
}

beforeEach(async () => {
  await nettoyer()
  oublierDernierMenage()
})
afterAll(() => depot.fermer())

describe('ménage du registre de synchronisation', () => {
  it('une vente renvoyée APRÈS la purge de ses reçus reste comptée une fois', async () => {
    const a = await creerAppareil('M1')
    const { orderId, evenements } = vente(a, millimes(13_500))
    expect((await pousser(a, evenements)).rejetes).toEqual([])

    await vieillir(a.id, 40)
    const retirees = await depot.purgerRegistreSynchronisation(RETENTION_REGISTRE_DEFAUT)
    expect(retirees).toBe(4)

    // La caisse sort d'une longue panne et renvoie tout son lot.
    expect((await pousser(a, evenements)).rejetes).toEqual([])

    const { rows } = await sql(
      `select (select count(*) from kaissi.order_events where order_id = $1) as evenements,
              (select count(*) from kaissi.payments where order_id = $1) as paiements,
              (select total_millimes from kaissi.orders where id = $1) as total`,
      [orderId],
    )
    expect(Number(rows[0].evenements), 'aucun événement inséré deux fois').toBe(4)
    expect(Number(rows[0].paiements), 'aucun double encaissement').toBe(1)
    expect(Number(rows[0].total)).toBe(13_500)
  })

  it('ne retire que ce qui a dépassé SA durée — et jamais le catalogue récent', async () => {
    const a = await creerAppareil('M2')
    expect((await pousser(a, vente(a, millimes(4_200)).evenements)).rejetes).toEqual([])

    const catalogueRecent = uuidV7()
    const catalogueAncien = uuidV7()
    const rejetRecent = uuidV7()
    const rejetAncien = uuidV7()
    for (const [id, kind, statut] of [
      [catalogueRecent, 'catalogue', 'accepte'],
      [catalogueAncien, 'catalogue', 'accepte'],
      [rejetRecent, 'order_event', 'rejete'],
      [rejetAncien, 'order_event', 'rejete'],
    ] as const) {
      await sql(
        `insert into kaissi.sync_mutations
           (event_id, organization_id, restaurant_id, device_id, kind, status)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, DEMO_ORG, DEMO_RESTO, a.id, kind, statut],
      )
    }
    // Les reçus de vente : 10 jours, sous les 30 → ils restent.
    await vieillir(a.id, 10, "kind = 'order_event' and status <> 'rejete'")
    await vieillir(a.id, 90, `event_id = '${catalogueRecent}'`)
    await vieillir(a.id, 200, `event_id = '${catalogueAncien}'`)
    await vieillir(a.id, 90, `event_id = '${rejetRecent}'`)
    await vieillir(a.id, 200, `event_id = '${rejetAncien}'`)

    expect(await depot.purgerRegistreSynchronisation(RETENTION_REGISTRE_DEFAUT)).toBe(2)

    const { rows } = await sql(
      'select event_id from kaissi.sync_mutations where device_id = $1',
      [a.id],
    )
    const restants = new Set(rows.map((r) => r.event_id as string))
    expect(restants.has(catalogueRecent), 'une création de catalogue de 90 jours garde sa garantie').toBe(true)
    expect(restants.has(rejetRecent)).toBe(true)
    expect(restants.has(catalogueAncien)).toBe(false)
    expect(restants.has(rejetAncien)).toBe(false)
    expect(restants.size).toBe(6) // 4 reçus de vente + 2 récents
  })

  it('le balayage de 30 minutes ne fait le ménage qu’une fois par jour', async () => {
    const espion = vi.spyOn(depot, 'purgerRegistreSynchronisation')
    let maintenant = Date.UTC(2026, 9, 19, 3)
    const horloge = () => maintenant

    await reparerProjectionsOrphelines(depot, { journaliser: silence, horloge })
    maintenant += 30 * 60_000
    await reparerProjectionsOrphelines(depot, { journaliser: silence, horloge })
    expect(espion).toHaveBeenCalledTimes(1)

    maintenant += 24 * 60 * 60_000
    await reparerProjectionsOrphelines(depot, { journaliser: silence, horloge })
    expect(espion).toHaveBeenCalledTimes(2)
    espion.mockRestore()
  })
})
