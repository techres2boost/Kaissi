/**
 * L'écran Surveillance : ce qu'il mesure, et à qui il le montre.
 *
 * Deux exigences, aussi importantes l'une que l'autre :
 *   • les chiffres sont VRAIS — une vente poussée apparaît dans les compteurs,
 *     une erreur dans les erreurs récentes, un seuil franchi dans les alertes ;
 *   • l'écran est réservé à l'ÉDITEUR. Ces chiffres traversent tous les
 *     restaurants : un client qui les lirait verrait l'activité des autres.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { Metriques, centile, evaluerAlertes, familleDeRoute } from '../src/surveillance.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  ESPECES,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const jetons = new Map<string, string>([
  ['jeton-editeur', 'editeur'],
  ['jeton-client', 'client'],
])
const fetchSimule: typeof fetch = async (_entree, init) => {
  const jeton = (new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '')
  const id = jetons.get(jeton)
  return new Response(
    JSON.stringify(id ? { id: uuidV7(), email: `${id}@res2boost.tn` } : { message: 'invalid' }),
    { status: id ? 200 : 401, headers: { 'content-type': 'application/json' } },
  )
}

const metriques = new Metriques()
const app = creerServeur({
  depot,
  auth: { url: 'https://exemple.supabase.co', cleAnon: 'anon' },
  fetchAuth: fetchSimule,
  cleService: 'service-de-test',
  editeurs: ['editeur@res2boost.tn'],
  metriques,
})

function surveillance(jeton: string) {
  return app.request('http://test/admin/surveillance', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
    body: '{}',
  })
}

function vente(a: AppareilTest) {
  const orderId = uuidV7()
  let seq = 0
  const ev = (type: string, charge: unknown) => ({
    eventId: uuidV7(),
    orderId,
    organizationId: DEMO_ORG,
    restaurantId: DEMO_RESTO,
    deviceId: a.id,
    seqDevice: (seq += 1),
    type,
    payload: charge,
    clientTs: new Date().toISOString(),
    actorUserId: null,
  })
  return [
    ev('order.opened', { type: 'takeaway', ouvertePar: null, numeroTicket: `${a.prefixe}-${orderId.slice(-6)}` }),
    ev('line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000200',
      designation: 'Ojja merguez',
      quantite: 1,
      prixBaseMillimes: millimes(13_500),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ev('payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(13_500),
      recuMillimes: millimes(13_500),
      renduMillimes: millimes(0),
    }),
    ev('order.closed', { totalMillimes: millimes(13_500), closePar: null }),
  ]
}

beforeEach(async () => {
  await nettoyer()
})

afterAll(async () => {
  metriques.arreter()
  await depot.fermer()
})

describe('surveillance — les mesures', () => {
  it('le centile est celui du rang le plus proche', () => {
    const tries = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(centile(tries, 50)).toBe(50)
    expect(centile(tries, 95)).toBe(95)
    expect(centile(tries, 99)).toBe(99)
    expect(centile([], 99)).toBe(0)
  })

  it('une route n’est jamais gardée telle quelle — seulement sa famille', () => {
    expect(familleDeRoute('/sync/push')).toBe('push')
    expect(familleDeRoute('/sync/pull?depuisEvenements=12')).toBe('pull')
    expect(familleDeRoute('/admin/editeur/clients')).toBe('admin')
    expect(familleDeRoute('/n-importe-quoi/0193abcd')).toBe('autre')
  })

  it('une vente poussée apparaît dans les compteurs, la base est mesurée', async () => {
    const a = await creerAppareil('P1')
    const r = await app.request('http://test/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
      body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: vente(a) }),
    })
    expect(r.status).toBe(200)

    const reponse = await surveillance('jeton-editeur')
    expect(reponse.status).toBe(200)
    const corps = (await reponse.json()) as any

    const push = corps.requetes.familles15min.find((f: any) => f.famille === 'push')
    expect(push.requetes).toBeGreaterThanOrEqual(1)
    expect(push.erreurs5xx).toBe(0)

    expect(corps.base.metier.evenements1h).toBe(4)
    expect(corps.base.metier.commandes1h).toBe(1)
    expect(corps.base.metier.projectionsManquantes).toBe(0)
    expect(corps.base.metier.caisses).toBeGreaterThanOrEqual(1)
    expect(corps.base.tailleOctets).toBeGreaterThan(0)
    expect(corps.base.connexionsMax).toBeGreaterThan(0)
    expect(corps.base.pool.max).toBe(10)
    expect(corps.processus.historique.length).toBeGreaterThanOrEqual(1)
    expect(corps.migrationsManquantes).toEqual([])
  })
})

describe('surveillance — à qui elle répond', () => {
  it('refuse un client, même administrateur de son restaurant', async () => {
    const r = await surveillance('jeton-client')
    expect(r.status).toBe(401)
    const corps = (await r.json()) as any
    expect(corps.base).toBeUndefined()
  })

  it('refuse sans jeton, et avec un jeton inventé', async () => {
    const sans = await app.request('http://test/admin/surveillance', { method: 'POST', body: '{}' })
    expect(sans.status).toBe(401)
    const faux = await surveillance('jeton-invente')
    expect(faux.status).toBe(401)
  })
})

describe('surveillance — les seuils deviennent des phrases', () => {
  it('2 envois de ventes sur 10 en échec : alerte critique', () => {
    const m = new Metriques()
    for (let i = 0; i < 8; i++) m.enregistrer('/sync/push', 200, 40)
    for (let i = 0; i < 2; i++) m.enregistrer('/sync/push', 500, 40)
    const alertes = evaluerAlertes(m.instantane(), null, [])
    expect(alertes.some((a) => a.niveau === 'critique' && a.sujet === 'Ventes')).toBe(true)
  })

  it('une migration manquante est TOUJOURS critique, et nommée', () => {
    const alertes = evaluerAlertes(new Metriques().instantane(), null, ['0045'])
    const alerte = alertes.find((a) => a.message.includes('0045'))
    expect(alerte?.niveau).toBe('critique')
  })

  it('un service sain ne crie pas', () => {
    const m = new Metriques()
    for (let i = 0; i < 50; i++) m.enregistrer('/sync/push', 200, 30)
    const base = {
      latenceMs: 3,
      tailleOctets: 1,
      connexions: 5,
      connexionsActives: 1,
      connexionsMax: 100,
      attentesVerrou: 0,
      requetePlusLongueSecondes: 0,
      cachePourcent: 99.8,
      validations: 1,
      annulations: 0,
      interblocages: 0,
      tables: [],
      pool: { total: 2, libres: 2, enAttente: 0, max: 10 },
      metier: {
        evenements1h: 10,
        evenements24h: 10,
        commandes1h: 2,
        rejets24h: 0,
        caisses: 1,
        caissesVues15min: 1,
        caissesMuettes24h: 0,
        projectionsManquantes: 0,
      },
    }
    expect(evaluerAlertes(m.instantane(), base, [])).toEqual([])
  })
})
