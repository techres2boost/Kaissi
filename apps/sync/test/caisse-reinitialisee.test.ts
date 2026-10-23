/**
 * Une caisse RÉINITIALISÉE doit pouvoir remonter ses ventes — contre un vrai
 * PostgreSQL.
 *
 * ── La panne que ce fichier fige (production, 23 octobre) ─────────────────
 *
 * Une caisse n'arrivait plus à remonter la moindre vente : « Erreur. Le
 * serveur répond, mais n'a pas pu enregistrer ces opérations », 8 opérations
 * en attente, et dans les journaux Postgres, à chaque essai :
 *
 *     duplicate key value violates unique constraint
 *     "order_events_device_id_seq_device_key"
 *
 * L'enchaînement était INÉVITABLE, et aucun test ne le couvrait :
 *
 *   1. `seq_device` est un compteur LOCAL, dans la base SQLite de la
 *      tablette ; vider cette base le remet à zéro ;
 *   2. mais le terminal garde son `installation_id`, et le serveur lui rend
 *      alors le MÊME `device_id` (0021) — c'est voulu ;
 *   3. il réémet donc `seq_device = 1, 2, 3…` avec des `event_id` NEUFS.
 *
 * L'idempotence ne voit rien (ce ne sont pas des doublons), l'ancienne
 * contrainte d'unicité levait, et comme l'insertion se fait dans UNE
 * transaction, tout le lot tombait — y compris les ventes saines. Une caisse
 * réinitialisée ne remontait donc plus jamais rien.
 *
 * Deux corrections, et ce fichier vérifie les deux :
 *   • Postgres 0049 retire l'unicité : les ventes passent ;
 *   • l'appairage rend le compteur connu du serveur, et le POS reprend
 *     au-dessus — la cause, et non seulement le symptôme.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { millimes, uuidV7 } from '@kaissi/domain'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ESPECES,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

async function push(a: AppareilTest, evenements: unknown[]) {
  const reponse = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  return { statut: reponse.status, corps: (await reponse.json().catch(() => null)) as any }
}

/**
 * Une vente complète, dont les numéros de séquence commencent à `depuis`.
 * C'est tout l'enjeu : une caisse réinitialisée recommence à 1.
 */
function vente(a: AppareilTest, depuis: number, numero: string) {
  const orderId = uuidV7()
  const ligneId = uuidV7()
  const paiementId = uuidV7()
  let seq = depuis
  const ev = (type: string, payload: unknown) => ({
    eventId: uuidV7(),
    orderId,
    restaurantId: DEMO_RESTO,
    organizationId: '01930000-0000-7000-8000-000000000001',
    deviceId: a.id,
    seqDevice: seq++,
    clientTs: new Date().toISOString(),
    serverSeq: null,
    type,
    payload,
    acteurId: EMPLOYE_DEMO,
  })
  return {
    orderId,
    evenements: [
      ev('order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO, numeroTicket: numero }),
      ev('line.added', {
        ligneId,
        produitId: '01930000-0000-7000-8000-000000000100',
        designation: 'Pizza Margherita',
        quantite: 1,
        prixBaseMillimes: millimes(10_000),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      ev('payment.recorded', {
        paiementId,
        methodeId: ESPECES,
        mode: 'cash',
        montantMillimes: millimes(10_000),
      }),
      ev('order.closed', { totalMillimes: millimes(10_000), closePar: EMPLOYE_DEMO }),
    ],
  }
}

beforeEach(nettoyer)
afterAll(async () => {
  await depot.fermer()
})

describe('caisse réinitialisée — même device_id, compteur reparti à 1', () => {
  it('remonte ses ventes, et ne perd rien de ce qui était déjà là', async () => {
    const a = await creerAppareil('Z1')

    // Sa PREMIÈRE vie : quatre événements, seq 1 à 4.
    const avant = vente(a, 1, `${a.prefixe}-000001`)
    const premier = await push(a, avant.evenements)
    expect(premier.statut).toBe(200)
    expect(premier.corps.rejetes).toEqual([])

    // Base locale vidée : le compteur repart à 1, les event_id sont neufs.
    const apres = vente(a, 1, `${a.prefixe}-000002`)
    const second = await push(a, apres.evenements)

    // C'est ICI que tout tombait : 500, et les 4 événements perdus en route.
    expect(second.statut).toBe(200)
    expect(second.corps.rejetes).toEqual([])
    expect(second.corps.acceptes).toHaveLength(4)

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    try {
      // Les DEUX ventes sont là : celle d'avant la réinitialisation aussi.
      const { rows } = await client.query(
        `select count(*)::int as n from kaissi.order_events where device_id = $1`,
        [a.id],
      )
      expect(rows[0]!.n).toBe(8)

      const { rows: commandes } = await client.query(
        `select id, status from kaissi.orders where id = any($1::uuid[]) order by ticket_number`,
        [[avant.orderId, apres.orderId]],
      )
      expect(commandes.map((c) => c.status)).toEqual(['close', 'close'])
    } finally {
      await client.end()
    }
  })

  it('l’appairage rend le compteur du serveur : la caisse reprend AU-DESSUS', async () => {
    const a = await creerAppareil('Z2')
    const v = vente(a, 1, `${a.prefixe}-000001`)
    await push(a, v.evenements)

    // Le terminal revient, reconnu par son installation_id (0021).
    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const installationId = uuidV7()
    try {
      await client.query('update kaissi.devices set installation_id = $2 where id = $1', [
        a.id,
        installationId,
      ])
    } finally {
      await client.end()
    }

    const enrole = await depot.enrolerAppareil({
      restaurantId: DEMO_RESTO,
      libelle: 'Terminal',
      installationId,
    })

    expect(enrole.reprise).toBe(true)
    expect(enrole.deviceId).toBe(a.id)
    // 4 événements poussés : le compteur du serveur est à 4, et le POS
    // reprendra donc à 5 — jamais à 1.
    expect(enrole.seqDevice).toBe(4)
  })

  it('un terminal NEUF reçoit un compteur à zéro', async () => {
    const enrole = await depot.enrolerAppareil({
      restaurantId: DEMO_RESTO,
      libelle: 'Terminal',
      installationId: uuidV7(),
    })
    expect(enrole.reprise).toBe(false)
    expect(enrole.seqDevice).toBe(0)
  })
})
