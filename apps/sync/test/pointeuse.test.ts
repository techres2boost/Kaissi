/**
 * La pointeuse (0048) — contre un VRAI Postgres.
 *
 * Ce que ces tests protègent :
 *   • un pointage arrive à l'ARRIVÉE, puis sa sortie l'enrichit — une seule
 *     ligne, jamais deux ;
 *   • un renvoi tardif de l'arrivée n'efface pas une sortie déjà remontée ;
 *   • un pointage mal formé est écarté sans faire échouer les autres ;
 *   • une caisse ne touche jamais aux pointages d'une autre (RLS) ;
 *   • un employé inconnu du serveur ne fait pas perdre le pointage.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { uuidV7 } from '@kaissi/domain'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { creerAppareil, nettoyer, DEMO_RESTO, EMPLOYE_DEMO, URL_TEST, type AppareilTest } from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

async function envoyer(a: AppareilTest, pointages: unknown[]) {
  const reponse = await app.request('http://test/sync/pointages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, pointages }),
  })
  return { statut: reponse.status, corps: (await reponse.json().catch(() => null)) as any }
}

async function lire(id: string) {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select restaurant_id, device_id, user_id, clock_in_at, clock_out_at
         from kaissi.time_entries where id = $1`,
      [id],
    )
    return rows
  } finally {
    await client.end()
  }
}

const ARRIVEE = '2026-10-21T09:58:00.000Z'
const SORTIE = '2026-10-21T15:04:00.000Z'

beforeEach(nettoyer)
afterAll(async () => {
  await depot.fermer()
})

describe('POST /sync/pointages', () => {
  it('écrit l’arrivée, puis la sortie, sur la MÊME ligne', async () => {
    const a = await creerAppareil('T1')
    const id = uuidV7()
    const r1 = await envoyer(a, [{ id, employeId: EMPLOYE_DEMO, arriveeA: ARRIVEE, sortieA: null }])
    expect(r1.statut).toBe(200)
    expect(r1.corps.enregistres).toEqual([id])

    await envoyer(a, [{ id, employeId: EMPLOYE_DEMO, arriveeA: ARRIVEE, sortieA: SORTIE }])
    const lignes = await lire(id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ restaurant_id: DEMO_RESTO, device_id: a.id, user_id: EMPLOYE_DEMO })
    expect(new Date(lignes[0]!.clock_out_at).toISOString()).toBe(SORTIE)
  })

  it('un renvoi tardif de l’ARRIVÉE n’efface pas la sortie', async () => {
    const a = await creerAppareil('T2')
    const id = uuidV7()
    await envoyer(a, [{ id, employeId: EMPLOYE_DEMO, arriveeA: ARRIVEE, sortieA: SORTIE }])
    await envoyer(a, [{ id, employeId: EMPLOYE_DEMO, arriveeA: ARRIVEE, sortieA: null }])
    expect((await lire(id))[0]!.clock_out_at).not.toBeNull()
  })

  it('écarte un pointage mal formé, et les autres passent', async () => {
    const a = await creerAppareil('T3')
    const bon = uuidV7()
    const r = await envoyer(a, [
      { id: 'pas-un-uuid', employeId: null, arriveeA: ARRIVEE, sortieA: null },
      { id: uuidV7(), employeId: null, arriveeA: 'hier soir', sortieA: null },
      { id: bon, employeId: null, arriveeA: ARRIVEE, sortieA: null },
    ])
    expect(r.statut).toBe(200)
    expect(r.corps.enregistres).toEqual([bon])
  })

  it('un employé inconnu du serveur ne fait pas perdre le pointage', async () => {
    const a = await creerAppareil('T4')
    const id = uuidV7()
    await envoyer(a, [{ id, employeId: uuidV7(), arriveeA: ARRIVEE, sortieA: null }])
    const lignes = await lire(id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]!.user_id).toBeNull()
  })

  it('une caisse ne modifie jamais le pointage d’une autre', async () => {
    const a = await creerAppareil('T5')
    const b = await creerAppareil('T6')
    const id = uuidV7()
    await envoyer(a, [{ id, employeId: EMPLOYE_DEMO, arriveeA: ARRIVEE, sortieA: null }])
    // B renvoie le même identifiant avec une sortie : RLS refuse l'update.
    const autre = uuidV7()
    const r = await envoyer(b, [
      { id, employeId: EMPLOYE_DEMO, arriveeA: ARRIVEE, sortieA: SORTIE },
      { id: autre, employeId: EMPLOYE_DEMO, arriveeA: ARRIVEE, sortieA: null },
    ])
    // Le lot passe : le pointage étranger est ignoré, le sien est écrit.
    expect(r.statut).toBe(200)
    expect(r.corps.enregistres).toEqual([autre])
    expect((await lire(id))[0]!.clock_out_at).toBeNull()
  })
})
