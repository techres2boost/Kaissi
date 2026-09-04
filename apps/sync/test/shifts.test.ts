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
import {
  creerAppareil,
  nettoyer,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  EMPLOYE_2,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

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
              closed_at, closed_by, counted_millimes, variance_millimes
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

  it('retient QUI A COMPTÉ la caisse, distinct de qui l a ouverte', async () => {
    // Un caissier ouvre à midi, un serveur compte le soir. Devant un écart,
    // le nom qui compte est celui de la personne qui a vu les billets :
    // afficher celui de l'ouverture met en cause quelqu'un qui était parti.
    const a = await creerAppareil('P1')
    const id = uuidV7()

    await envoyer(a, [{ ...shiftOuvert(id), employeId: EMPLOYE_DEMO }])
    const ouvert = await lire(id)
    expect(ouvert.user_id).toBe(EMPLOYE_DEMO)
    expect(ouvert.closed_by).toBeNull()

    await envoyer(a, [
      {
        ...shiftOuvert(id),
        employeId: EMPLOYE_DEMO,
        fermeA: '2026-09-03T23:30:00.000Z',
        fermePar: EMPLOYE_2,
        compteMillimes: 74_000,
        attenduMillimes: 74_200,
        ecartMillimes: -200,
      },
    ])
    const clos = await lire(id)
    expect(clos.user_id).toBe(EMPLOYE_DEMO)
    expect(clos.closed_by).toBe(EMPLOYE_2)
  })

  it('n EFFACE pas le fermeur quand une vieille tablette repousse le service', async () => {
    /*
     * Une tablette antérieure à la migration locale 006 renvoie le MÊME
     * service, sans `fermePar`. Sans le COALESCE de l'upsert, ce renvoi
     * écraserait par nul une information déjà remontée par une tablette à
     * jour — et le nom disparaîtrait du back-office sans que rien ne le dise.
     */
    const a = await creerAppareil('P1')
    const id = uuidV7()
    await envoyer(a, [
      {
        ...shiftOuvert(id),
        fermeA: '2026-09-03T23:30:00.000Z',
        fermePar: EMPLOYE_2,
        compteMillimes: 74_000,
        attenduMillimes: 74_000,
        ecartMillimes: 0,
      },
    ])
    expect((await lire(id)).closed_by).toBe(EMPLOYE_2)

    // La même clôture, vue par une tablette qui ignore la colonne.
    await envoyer(a, [
      {
        ...shiftOuvert(id),
        fermeA: '2026-09-03T23:30:00.000Z',
        compteMillimes: 74_000,
        attenduMillimes: 74_000,
        ecartMillimes: 0,
      },
    ])
    expect((await lire(id)).closed_by).toBe(EMPLOYE_2)
  })

  it('IGNORE un fermeur inconnu du serveur plutôt que de perdre le service', async () => {
    // Même règle que pour l'ouverture : un employé archivé entre-temps ne
    // doit pas faire échouer la remontée d'un service de caisse.
    const a = await creerAppareil('P1')
    const id = uuidV7()
    const reponse = await envoyer(a, [
      {
        ...shiftOuvert(id),
        fermeA: '2026-09-03T23:30:00.000Z',
        fermePar: '01930000-0000-7000-8000-0000000000ff',
        compteMillimes: 1,
        attenduMillimes: 1,
        ecartMillimes: 0,
      },
    ])
    expect(reponse.statut).toBe(200)
    expect((await lire(id)).closed_by).toBeNull()
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
