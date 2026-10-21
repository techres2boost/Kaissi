/**
 * Le remboursement d'un ticket payé, de la caisse au rapport.
 *
 * Ce que ces tests prouvent contre un VRAI PostgreSQL :
 *   • l'événement est accepté sur un ticket encaissé, refusé sur une
 *     commande en cours ;
 *   • il est projeté dans `refunds`, avec sa commande et son service de
 *     caisse, sans toucher à la vente ;
 *   • il est idempotent ;
 *   • un remboursement mal formé est REFUSÉ à l'entrée, sans bloquer les
 *     ventes du même lot ;
 *   • un remboursement qui ne trouve pas sa place n'empêche jamais la
 *     projection : il est rattaché et signalé ;
 *   • deux caisses qui rendent la même ligne : les deux sommes comptent,
 *     et l'anomalie remonte au gérant ;
 *   • la ligne « Remboursements » du rapport le compte enfin.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { millimes, uuidV7 } from '@kaissi/domain'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { TYPES_CONNUS } from '../src/service.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  GERANT_DEMO,
  ESPECES,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })
const client = new Client({ connectionString: URL_TEST })
await client.connect()

afterAll(async () => {
  await client.end()
  await depot.fermer?.()
})

async function push(a: AppareilTest, evenements: unknown[]) {
  const reponse = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  return { statut: reponse.status, corps: (await reponse.json()) as any }
}

/** Une vente encaissée : deux lignes, TVA 19 % INCLUSE (jeu de démonstration), payée en espèces. */
function vente(a: AppareilTest) {
  const orderId = uuidV7()
  const pizza = uuidV7()
  const coca = uuidV7()
  const paiementId = uuidV7()
  const evenements = [
    ev(a, orderId, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO, numeroTicket: `${a.prefixe}-000001` }),
    ev(a, orderId, 'line.added', {
      ligneId: pizza,
      produitId: '01930000-0000-7000-8000-000000000100',
      designation: 'Pizza Margherita',
      quantite: 1,
      prixBaseMillimes: millimes(10_000),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ev(a, orderId, 'line.added', {
      ligneId: coca,
      produitId: '01930000-0000-7000-8000-000000000101',
      designation: 'Coca-Cola 33cl',
      quantite: 1,
      prixBaseMillimes: millimes(5_000),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ev(a, orderId, 'payment.recorded', {
      paiementId,
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(15_000),
    }),
    ev(a, orderId, 'order.closed', { totalMillimes: millimes(15_000), closePar: EMPLOYE_DEMO }),
  ]
  return { orderId, pizza, coca, paiementId, evenements }
}

const remboursement = (
  a: AppareilTest,
  orderId: string,
  paiementId: string,
  ligneIds: string[],
  montant: number,
  shiftId: string | null = uuidV7(),
) =>
  ev(a, orderId, 'refund.recorded', {
    remboursementId: uuidV7(),
    paiementId,
    mode: 'cash',
    montantMillimes: millimes(montant),
    ligneIds,
    motif: 'Pizza froide',
    shiftId,
    autorisePar: GERANT_DEMO,
  })

beforeEach(async () => {
  await nettoyer()
})

describe('remboursement — synchronisation', () => {
  it('projette le remboursement, sans toucher à la vente', async () => {
    const a = await creerAppareil('R1')
    const v = vente(a)
    const shiftId = uuidV7()
    const r = remboursement(a, v.orderId, v.paiementId, [v.pizza], 10_000, shiftId)
    const res = await push(a, [...v.evenements, r])
    expect(res.statut).toBe(200)
    expect(res.corps.rejetes).toEqual([])

    const { rows: cmd } = await client.query(
      'select status, total_millimes from kaissi.orders where id = $1',
      [v.orderId],
    )
    expect(cmd[0]).toMatchObject({ status: 'close' })
    expect(Number(cmd[0]!.total_millimes)).toBe(15_000)

    const { rows } = await client.query(
      `select order_id, type, amount_millimes::int as montant, reason, shift_id, device_id,
              items, approved_by, payment_id
         from kaissi.refunds where restaurant_id = $1`,
      [DEMO_RESTO],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      order_id: v.orderId,
      type: 'cash',
      montant: 10_000,
      reason: 'Pizza froide',
      shift_id: shiftId,
      device_id: a.id,
      items: [v.pizza],
      approved_by: GERANT_DEMO,
      payment_id: v.paiementId,
    })
  })

  it('est idempotent : renvoyé trois fois, compté une fois', async () => {
    const a = await creerAppareil('R2')
    const v = vente(a)
    const r = remboursement(a, v.orderId, v.paiementId, [v.pizza], 10_000)
    await push(a, v.evenements)
    // Chaque renvoi REPROJETTE la commande (l'idempotence n'est pas « jamais
    // projeté ») : chacun doit répondre 200, sans quoi la caisse réessaierait
    // sans fin.
    for (let i = 0; i < 3; i += 1) {
      const res = await push(a, [r])
      expect(res.statut).toBe(200)
      expect(res.corps.acceptes).toContain(r.eventId)
    }
    const { rows } = await client.query('select count(*)::int as n from kaissi.refunds')
    expect(rows[0]!.n).toBe(1)
  })

  it('refuse un remboursement sur une commande encore OUVERTE', async () => {
    const a = await creerAppareil('R3')
    const v = vente(a)
    // Ouverture et lignes seulement : pas de paiement, pas de clôture.
    await push(a, v.evenements.slice(0, 3))
    const res = await push(a, [remboursement(a, v.orderId, v.paiementId, [v.pizza], 10_000)])
    expect(res.corps.rejetes).toHaveLength(1)
    expect(res.corps.rejetes[0].message).toMatch(/refund\.recorded|ouverte/)
  })

  it('un remboursement MAL FORMÉ est refusé à l entrée, et les ventes du lot passent', async () => {
    const a = await creerAppareil('R4')
    const v = vente(a)
    const mauvais = ev(a, v.orderId, 'refund.recorded', {
      remboursementId: uuidV7(),
      paiementId: 'pas-un-uuid',
      mode: 'cash',
      montantMillimes: millimes(1_000),
      ligneIds: [v.pizza],
      motif: 'Test',
    })
    const autre = vente(a)
    const res = await push(a, [...v.evenements, mauvais, ...autre.evenements])
    expect(res.statut).toBe(200)
    expect(res.corps.rejetes).toHaveLength(1)
    expect(res.corps.rejetes[0].code).toBe('charge_invalide')
    const { rows } = await client.query(
      'select count(*)::int as n from kaissi.orders where id = any($1::uuid[])',
      [[v.orderId, autre.orderId]],
    )
    expect(rows[0]!.n).toBe(2)
  })

  it('un paiement inconnu ne bloque rien : rattaché au premier, et SIGNALÉ', async () => {
    const a = await creerAppareil('R5')
    const v = vente(a)
    const r = remboursement(a, v.orderId, uuidV7(), [v.pizza], 10_000)
    const res = await push(a, [...v.evenements, r])
    expect(res.statut).toBe(200)
    const { rows } = await client.query('select payment_id from kaissi.refunds')
    expect(rows[0]!.payment_id).toBe(v.paiementId)
    const { rows: cmd } = await client.query('select exceptions from kaissi.orders where id = $1', [
      v.orderId,
    ])
    expect(JSON.stringify(cmd[0]!.exceptions)).toContain('remboursement_paiement_inconnu')
  })

  it('deux caisses qui rendent la MÊME ligne : les deux sommes comptent, l anomalie remonte', async () => {
    const a = await creerAppareil('R6')
    const b = await creerAppareil('R7')
    const v = vente(a)
    await push(a, v.evenements)
    await push(a, [remboursement(a, v.orderId, v.paiementId, [v.pizza], 10_000)])
    // Le second push REPROJETTE une commande déjà remboursée : c'est le cas
    // qui faisait échouer la projection (paiements supprimés avant les
    // remboursements qui les référencent).
    const deB = await push(b, [remboursement(b, v.orderId, v.paiementId, [v.pizza], 10_000)])
    expect(deB.statut).toBe(200)

    const { rows } = await client.query(
      'select sum(amount_millimes)::int as total, count(*)::int as n from kaissi.refunds',
    )
    expect(rows[0]).toEqual({ total: 20_000, n: 2 })
    const { rows: cmd } = await client.query('select exceptions from kaissi.orders where id = $1', [
      v.orderId,
    ])
    expect(JSON.stringify(cmd[0]!.exceptions)).toContain('double_remboursement')
  })

  it('1 pizza sur 3, puis 2 : aucune anomalie ; une unité de trop est SIGNALÉE', async () => {
    const a = await creerAppareil('R8')
    const orderId = uuidV7()
    const pizza = uuidV7()
    const paiementId = uuidV7()
    await push(a, [
      ev(a, orderId, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO, numeroTicket: `${a.prefixe}-000001` }),
      ev(a, orderId, 'line.added', {
        ligneId: pizza,
        produitId: '01930000-0000-7000-8000-000000000100',
        designation: 'Pizza Margherita',
        quantite: 3,
        prixBaseMillimes: millimes(10_000),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      ev(a, orderId, 'payment.recorded', { paiementId, methodeId: ESPECES, mode: 'cash', montantMillimes: millimes(30_000) }),
      ev(a, orderId, 'order.closed', { totalMillimes: millimes(30_000), closePar: EMPLOYE_DEMO }),
    ])
    const partiel = (q: number, montant: number) =>
      ev(a, orderId, 'refund.recorded', {
        remboursementId: uuidV7(),
        paiementId,
        mode: 'cash',
        montantMillimes: millimes(montant),
        ligneIds: [pizza],
        quantites: { [pizza]: q },
        motif: 'Pizza froide',
        shiftId: uuidV7(),
        autorisePar: GERANT_DEMO,
      })
    expect((await push(a, [partiel(1, 10_000)])).corps.rejetes).toEqual([])
    expect((await push(a, [partiel(2, 20_000)])).corps.rejetes).toEqual([])
    const exceptions = async () =>
      JSON.stringify(
        (await client.query('select exceptions from kaissi.orders where id = $1', [orderId])).rows[0]!.exceptions,
      )
    expect(await exceptions()).not.toContain('double_remboursement')

    await push(a, [partiel(1, 10_000)])
    expect(await exceptions()).toContain('double_remboursement')
  })

  it('des quantités MAL FORMÉES sont refusées à l entrée', async () => {
    const a = await creerAppareil('R9')
    const v = vente(a)
    await push(a, v.evenements)
    for (const quantites of [{ [v.pizza]: 0 }, { [v.pizza]: 1.5 }, { [v.coca]: 1 }, [1]]) {
      const res = await push(a, [
        ev(a, v.orderId, 'refund.recorded', {
          remboursementId: uuidV7(),
          paiementId: v.paiementId,
          mode: 'cash',
          montantMillimes: millimes(1_000),
          ligneIds: [v.pizza],
          quantites: quantites as never,
          motif: 'Test',
        }),
      ])
      expect(res.corps.rejetes, JSON.stringify(quantites)).toHaveLength(1)
      expect(res.corps.rejetes[0].code).toBe('charge_invalide')
    }
  })

  it('le rapport compte enfin la ligne « Remboursements »', async () => {
    const a = await creerAppareil('R8')
    const v = vente(a)
    await push(a, [...v.evenements, remboursement(a, v.orderId, v.paiementId, [v.coca], 5_000)])
    const { rows } = await client.query<{ r: { remboursementsMillimes: number; nombreTickets: number } }>(
      'select kaissi.rapport_ventes($1,$2,$3) as r',
      [DEMO_RESTO, '2026-08-25T00:00:00Z', '2026-08-26T00:00:00Z'],
    )
    expect(Number(rows[0]!.r.remboursementsMillimes)).toBe(5_000)
    // La vente reste une vente : le ticket compte toujours.
    expect(rows[0]!.r.nombreTickets).toBe(1)
  })
})

describe('le journal accepte TOUS les types que le service accepte', () => {
  /*
   * La règle, pas l'instance. Le premier remboursement poussé a échoué en
   * 500 parce que `order_events.type` est une liste fermée (0004) qu'aucun
   * test ne confrontait à celle du service : l'événement passait la
   * validation, puis la base le refusait — avec tout le lot, ventes
   * comprises. Le prochain type oublié échouera ICI, pas en production.
   */
  it('chaque type de TYPES_CONNUS figure dans la contrainte order_events_type_check', async () => {
    const { rows } = await client.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'kaissi.order_events'::regclass and conname = 'order_events_type_check'`,
    )
    expect(rows).toHaveLength(1)
    const manquants = [...TYPES_CONNUS].filter((t) => !rows[0]!.def.includes(`'${t}'`))
    expect(manquants).toEqual([])
  })
})
