/**
 * `supabase/reparer-production.sql` répare-t-il VRAIMENT une production ?
 *
 * Le fichier que le gérant colle dans le SQL Editor quand les caisses
 * gardent leurs ventes. Un fichier de dépannage qui ne dépanne pas est pire
 * que pas de fichier : on le colle en pleine panne, en confiance, et on
 * cherche ailleurs pendant une heure. Ce test le met donc à l'épreuve sur
 * une base ramenée à l'état de la production (0045 absente), en rejouant la
 * situation vue sur le téléphone du gérant — des opérations en attente,
 * une commande envoyée en cuisine, une vente encaissée.
 *
 * Il vérifie les deux moitiés de la promesse : avant, rien n'arrive mais
 * rien n'est perdu ; après, la caisse réessaie SEULE le même lot et tout
 * apparaît — l'écran cuisine ET le back-office — sans doublon ni ressaisie.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ESPECES,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const REPARATION = join(import.meta.dirname, '../../../supabase/reparer-production.sql')
const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })
const client = new Client({ connectionString: URL_TEST })

beforeAll(async () => {
  await client.connect()
  await nettoyer()
})
afterAll(async () => {
  await client.query(readFileSync(REPARATION, 'utf8'))
  await client.end()
  await depot.fermer()
})

function evenement(a: AppareilTest, orderId: string, seq: number, type: string, payload: unknown) {
  return {
    eventId: uuidV7(),
    orderId,
    organizationId: DEMO_ORG,
    restaurantId: DEMO_RESTO,
    deviceId: a.id,
    seqDevice: seq,
    type,
    payload,
    clientTs: new Date(Date.now() + seq).toISOString(),
    actorUserId: null,
  }
}

describe('la situation du téléphone, rejouée de bout en bout', () => {
  it('0045 absente : rien ne remonte — appliquée : tout remonte, sans ressaisie', async () => {
    const a = await creerAppareil('P9')
    let seq = 0
    const e = (orderId: string, type: string, payload: unknown) =>
      evenement(a, orderId, (seq += 1), type, payload)

    // Commande 1 : envoyée en CUISINE, pas encore encaissée.
    const cuisine = uuidV7()
    const ligne1 = uuidV7()
    const ligne2 = uuidV7()
    // Commande 2 : encaissée.
    const encaissee = uuidV7()
    const ligne3 = uuidV7()

    const lot = [
      e(cuisine, 'order.opened', { type: 'dine_in', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'P9-000001' }),
      e(cuisine, 'line.added', {
        ligneId: ligne1,
        produitId: '01930000-0000-7000-8000-000000000200',
        designation: 'Pizza Margherita',
        quantite: 1,
        prixBaseMillimes: millimes(14_500),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      e(cuisine, 'line.added', {
        ligneId: ligne2,
        produitId: '01930000-0000-7000-8000-000000000201',
        designation: 'Couscous poulet',
        quantite: 2,
        prixBaseMillimes: millimes(19_000),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      e(cuisine, 'line.note_set', { ligneId: ligne2, note: 'sans harissa' }),
      e(cuisine, 'order.sent', { stationIds: [] }),

      e(encaissee, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO, numeroTicket: 'P9-000002' }),
      e(encaissee, 'line.added', {
        ligneId: ligne3,
        produitId: '01930000-0000-7000-8000-000000000202',
        designation: 'Ojja merguez',
        quantite: 1,
        prixBaseMillimes: millimes(13_500),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      e(encaissee, 'order.sent', { stationIds: [] }),
      e(encaissee, 'payment.recorded', {
        paiementId: uuidV7(),
        methodeId: ESPECES,
        mode: 'cash',
        montantMillimes: millimes(13_500),
        recuMillimes: millimes(20_000),
        renduMillimes: millimes(6_500),
      }),
      e(encaissee, 'order.closed', { totalMillimes: millimes(13_500), closePar: EMPLOYE_DEMO }),
    ]
    // Onzième opération : la caisse pousse aussi son service (route additive).
    expect(lot).toHaveLength(10)

    const pousser = async () => {
      const r = await app.request('http://test/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
        body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: lot }),
      })
      return { statut: r.status, corps: (await r.json()) as any }
    }

    // ── 1. L'état de la production : 0045 absente ────────────────────────
    await client.query('alter table kaissi.refunds drop column order_id cascade')

    const avant = await pousser()
    expect(avant.statut).toBe(503)
    expect(avant.corps.message).toContain('0045')
    console.log(`  ✗ avant : ${avant.statut} — ${avant.corps.message}`)

    const vides = await client.query(
      'select count(*)::int as n from kaissi.orders where id = any($1::uuid[])',
      [[cuisine, encaissee]],
    )
    expect(vides.rows[0].n, 'rien au back-office, comme sur le téléphone').toBe(0)
    const journal = await client.query(
      'select count(*)::int as n from kaissi.order_events where order_id = any($1::uuid[])',
      [[cuisine, encaissee]],
    )
    expect(journal.rows[0].n, 'mais TOUT est dans le journal : rien de perdu').toBe(10)
    console.log(`  ✓ les ${journal.rows[0].n} opérations sont dans le journal du serveur`)

    // ── 2. Ce que le gérant colle dans le SQL Editor ─────────────────────
    await client.query(readFileSync(REPARATION, 'utf8'))
    console.log('  ✓ fichier de réparation appliqué')

    // ── 3. La caisse réessaie TOUTE SEULE le même lot ────────────────────
    const apres = await pousser()
    expect(apres.statut).toBe(200)
    expect(apres.corps.doublons, 'le même lot : idempotent, aucun double').toHaveLength(10)
    console.log(`  ✓ après : 200 — ${apres.corps.doublons.length} doublons, 0 rejet`)

    // ── 4. L'ÉCRAN CUISINE (back-office /preparation) ────────────────────
    const prepa = await client.query(
      `select o.id, o.ticket_number, o.status,
              (select count(*) from kaissi.order_items i where i.order_id = o.id)::int as lignes
         from kaissi.orders o
        where o.restaurant_id = $1 and o.status = 'envoyee'`,
      [DEMO_RESTO],
    )
    expect(prepa.rows.map((r) => r.id)).toContain(cuisine)
    const enCuisine = prepa.rows.find((r) => r.id === cuisine)!
    expect(enCuisine.lignes).toBe(2)
    console.log(`  ✓ cuisine : ${enCuisine.ticket_number}, ${enCuisine.lignes} lignes, statut « ${enCuisine.status} »`)

    const notes = await client.query(
      'select designation, qty, note from kaissi.order_items where order_id = $1 order by designation',
      [cuisine],
    )
    expect(notes.rows.map((r) => r.designation)).toEqual(['Couscous poulet', 'Pizza Margherita'])
    expect(notes.rows[0].note).toBe('sans harissa')
    console.log(`  ✓ cuisine : « ${notes.rows[0].designation} » porte bien la note « ${notes.rows[0].note} »`)

    // ── 5. LE BACK-OFFICE (ventes et tickets) ────────────────────────────
    const vente = await client.query(
      `select o.ticket_number, o.status, o.total_millimes, o.paid_millimes, o.tax_millimes,
              (select count(*) from kaissi.payments p where p.order_id = o.id)::int as paiements
         from kaissi.orders o where o.id = $1`,
      [encaissee],
    )
    const v = vente.rows[0]
    expect(v.status).toBe('close')
    expect(Number(v.total_millimes)).toBe(13_500)
    expect(Number(v.paid_millimes)).toBe(13_500)
    expect(v.paiements).toBe(1)
    console.log(
      `  ✓ back-office : ${v.ticket_number} — ${Number(v.total_millimes) / 1000} TND, ` +
        `TVA ${Number(v.tax_millimes) / 1000} TND, ${v.paiements} paiement`,
    )

    // ── 6. Aucun doublon après la reprise ────────────────────────────────
    const doublons = await client.query(
      `select count(*)::int as evenements,
              (select count(*) from kaissi.order_items where order_id = any($1::uuid[]))::int as lignes,
              (select count(*) from kaissi.payments where order_id = any($1::uuid[]))::int as paiements
         from kaissi.order_events where order_id = any($1::uuid[])`,
      [[cuisine, encaissee]],
    )
    expect(doublons.rows[0].evenements).toBe(10)
    expect(doublons.rows[0].lignes).toBe(3)
    expect(doublons.rows[0].paiements).toBe(1)
    console.log('  ✓ aucun doublon : 10 événements, 3 lignes, 1 paiement')
  })
})
