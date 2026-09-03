/**
 * Remontée des services de caisse — contre un VRAI Postgres.
 *
 * Ce que ces tests protègent : l'écran « Journée » du back-office lit
 * `kaissi.shifts`. Tant que la tablette gardait ses shifts pour elle, ce
 * tableau restait vide même après une prise de poste et une clôture — et
 * l'ÉCART de caisse, le chiffre pour lequel on tient une caisse, n'existait
 * nulle part hors de la tablette.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { uuidV7 } from '@kaissi/domain'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { creerAppareil, nettoyer, DEMO_RESTO, URL_TEST, type AppareilTest } from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

async function envoyer(a: AppareilTest, shifts: unknown[]) {
  const reponse = await app.request('http://test/sync/shifts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${a.jetonClair}`,
    },
    body: JSON.stringify({ protocolVersion: 1, shifts }),
  })
  return { statut: reponse.status, corps: (await reponse.json().catch(() => null)) as any }
}

async function lire(id: string) {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select restaurant_id, device_id, user_id, opening_float_millimes,
              closed_at, counted_millimes, variance_millimes
         from kaissi.shifts where id = $1`,
      [id],
    )
    return rows[0] ?? null
  } finally {
    await client.end()
  }
}

function shiftOuvert(id: string) {
  return {
    id,
    employeId: null,
    ouvertA: '2026-09-03T08:00:00.000Z',
    fondDeCaisseMillimes: 50_000,
    fermeA: null,
    compteMillimes: null,
    attenduMillimes: null,
    ecartMillimes: null,
  }
}

beforeEach(nettoyer)
afterAll(async () => {
  await depot.fermer()
})

describe('POST /sync/shifts', () => {
  it('écrit le service, puis sa clôture, sans le dupliquer', async () => {
    const a = await creerAppareil('P1')
    const id = uuidV7()

    const ouverture = await envoyer(a, [shiftOuvert(id)])
    expect(ouverture.statut).toBe(200)
    expect(ouverture.corps.enregistres).toEqual([id])

    const ouvert = await lire(id)
    expect(ouvert.restaurant_id).toBe(DEMO_RESTO)
    expect(ouvert.device_id).toBe(a.id)
    expect(Number(ouvert.opening_float_millimes)).toBe(50_000)
    expect(ouvert.closed_at).toBeNull()

    // La clôture ENRICHIT le même shift : elle n'en crée pas un second.
    await envoyer(a, [
      {
        ...shiftOuvert(id),
        fermeA: '2026-09-03T23:30:00.000Z',
        compteMillimes: 74_000,
        attenduMillimes: 74_200,
        ecartMillimes: -200,
      },
    ])
    const clos = await lire(id)
    expect(clos.closed_at).not.toBeNull()
    // L'écart PEUT être négatif : c'est tout son intérêt.
    expect(Number(clos.variance_millimes)).toBe(-200)
  })

  it('renvoyer dix fois le même service n en écrit qu un (RÈGLE 5)', async () => {
    const a = await creerAppareil('P1')
    const id = uuidV7()
    for (let i = 0; i < 10; i += 1) await envoyer(a, [shiftOuvert(id)])

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const { rows } = await client.query('select count(*)::int as n from kaissi.shifts')
    await client.end()
    expect(rows[0].n).toBe(1)
  })

  it('IGNORE l employé inconnu du serveur plutôt que de perdre le service', async () => {
    // Un employé qui n'existe que dans la graine locale de la tablette
    // ferait échouer la clé étrangère. Un service sans nom vaut mieux qu'un
    // service perdu.
    const a = await creerAppareil('P1')
    const id = uuidV7()
    const reponse = await envoyer(a, [{ ...shiftOuvert(id), employeId: uuidV7() }])
    expect(reponse.statut).toBe(200)
    expect((await lire(id)).user_id).toBeNull()
  })

  it('IMPOSE le restaurant du jeton, quoi que prétende le corps', async () => {
    // Défense en profondeur : RLS refuserait déjà, mais le service ne lit
    // même pas ces champs.
    const a = await creerAppareil('P1')
    const id = uuidV7()
    await envoyer(a, [
      {
        ...shiftOuvert(id),
        restaurantId: uuidV7(),
        organizationId: uuidV7(),
        deviceId: uuidV7(),
      },
    ])
    const ligne = await lire(id)
    expect(ligne.restaurant_id).toBe(DEMO_RESTO)
    expect(ligne.device_id).toBe(a.id)
  })

  it('ignore une ligne mal formée sans perdre les bonnes du même lot', async () => {
    const a = await creerAppareil('P1')
    const bon = uuidV7()
    const reponse = await envoyer(a, [
      { id: 'pas-un-uuid', ouvertA: '2026-09-03T08:00:00.000Z' },
      shiftOuvert(bon),
    ])
    expect(reponse.statut).toBe(200)
    expect(reponse.corps.enregistres).toEqual([bon])
  })

  it('refuse un jeton absent', async () => {
    const reponse = await app.request('http://test/sync/shifts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, shifts: [] }),
    })
    expect(reponse.status).toBe(401)
  })
})
