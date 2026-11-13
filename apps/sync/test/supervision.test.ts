/**
 * Supervision — l'historique, les incidents, le journal de sécurité (0050).
 *
 * Ce que ces tests protègent, au-delà du « ça s'affiche » :
 *
 *   1. LES CHIFFRES SONT VRAIS. Chaque requête envoyée au serveur doit se
 *      retrouver comptée dans `supervision_points`, ni plus ni moins. Un
 *      tableau de bord dont les compteurs dérivent est pire que pas de
 *      tableau de bord : on finit par croire ce qu'il dit.
 *   2. LES DONNÉES SENSIBLES N'Y ENTRENT PAS. Aucune adresse IP complète,
 *      aucun mot de passe, aucun jeton.
 *   3. UNE ALERTE PERSISTANTE RESTE UN INCIDENT — et se résout seule quand
 *      sa cause disparaît.
 *   4. SEUL UN ÉDITEUR LIT. Ces chiffres traversent tous les restaurants.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { Supervision, masquerEmail, nettoyer, tronquerIp } from '../src/supervision.js'
import type { Alerte } from '../src/surveillance.js'
import type { ChangementIncident, Notificateur } from '../src/alertes-externes.js'
import { DEMO_RESTO, URL_TEST, creerAppareil, nettoyer as nettoyerBase } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()
const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const AUTH = { url: 'https://exemple.supabase.co', cleAnon: 'anon-de-test' }
const EDITEUR = 'editeur@res2boost.tn'
const jetons = new Map<string, { id: string; email: string }>([
  ['jeton-editeur', { id: '01930000-0000-7000-8000-00000000e001', email: EDITEUR }],
  ['jeton-client', { id: '01930000-0000-7000-8000-00000000e002', email: 'gerant@client.tn' }],
])

const fetchSimule: typeof fetch = async (entree, init) => {
  const url = String(entree)
  const json = (corps: unknown, statut = 200) =>
    new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/auth/v1/user')) {
    const jeton = (new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '')
    const qui = jetons.get(jeton)
    return qui ? json(qui) : json({ message: 'invalid token' }, 401)
  }
  // Tout mot de passe est FAUX : c'est le cas qu'on veut observer.
  if (url.includes('/auth/v1/token')) return json({ msg: 'invalid' }, 400)
  return json({ message: 'route non simulée' }, 500)
}

let alertesAFournir: Alerte[] = []
let notifies: ChangementIncident[] = []
const notificateurTest: Notificateur = {
  envoyer: async (c) => {
    notifies.push(c)
    return { envoye: true }
  },
}
function nouveauServeur() {
  const supervision = new Supervision(depot, {
    notificateur: notificateurTest,
    // Écriture déclenchée À LA MAIN par les tests (`vider()`), et une
    // période courte pour que la résolution automatique soit testable.
    intervalleMs: 400,
    instance: `test-${Math.random().toString(36).slice(2, 8)}`,
    alertes: async () => alertesAFournir,
  })
  const app = creerServeur({
    depot,
    auth: AUTH,
    fetchAuth: fetchSimule,
    cleService: 'service-de-test',
    editeurs: [EDITEUR],
    supervision,
  })
  return { app, supervision }
}

async function points(instance: string) {
  const { rows } = await client.query(
    'select * from kaissi.supervision_points where instance = $1 order by minute',
    [instance],
  )
  return rows
}

beforeEach(async () => {
  await nettoyerBase()
  await client.query('delete from kaissi.supervision_points')
  await client.query('delete from kaissi.supervision_evenements')
  await client.query('delete from kaissi.supervision_incidents')
  alertesAFournir = []
  notifies = []
})

afterAll(async () => {
  await depot.fermer()
  await client.end()
})

describe('ce qui n’entre jamais dans la supervision', () => {
  it('une adresse IP est TRONQUÉE à son réseau', () => {
    expect(tronquerIp('203.0.113.42')).toBe('203.0.113.0/24')
    expect(tronquerIp('::ffff:198.51.100.7')).toBe('198.51.100.0/24')
    expect(tronquerIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::/48')
    expect(tronquerIp('inconnue')).toBeNull()
  })

  it('une adresse e-mail est masquée, un jeton est retiré', () => {
    expect(masquerEmail('Salma@Resto.tn')).toBe('s•••@resto.tn')
    const brut = 'échec pour gerant@resto.tn avec le jeton abcdefghijklmnopqrstuvwxyz0123456789ABCD'
    const propre = nettoyer(brut)
    expect(propre).not.toContain('gerant@')
    expect(propre).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(propre).toContain('g•••@resto.tn')
  })
})

describe('les compteurs sont EXACTS', () => {
  it('chaque requête est comptée une fois, et les refus sont classés', async () => {
    const { app, supervision } = nouveauServeur()
    const caisse = await creerAppareil('SV1')
    const appeler = (chemin: string, init: RequestInit = {}) =>
      app.request(`http://test${chemin}`, {
        ...init,
        headers: { 'x-forwarded-for': '203.0.113.42', 'content-type': 'application/json', ...(init.headers ?? {}) },
      })

    // 5 synchronisations réussies.
    for (let i = 0; i < 5; i += 1) {
      const r = await appeler('/sync/pull?protocolVersion=1&depuisCatalogue=0&depuisEvenements=0', {
        headers: { authorization: `Bearer ${caisse.jetonClair}` },
      })
      expect(r.status).toBe(200)
    }
    // 3 jetons d'appareil inventés.
    for (let i = 0; i < 3; i += 1) {
      const r = await appeler('/sync/pull?protocolVersion=1', {
        headers: { authorization: 'Bearer jeton-invente-0000000000000000' },
      })
      expect(r.status).toBe(401)
    }
    // 2 mots de passe faux.
    for (let i = 0; i < 2; i += 1) {
      const r = await appeler('/appairage', {
        method: 'POST',
        body: JSON.stringify({ email: 'gerant@resto.tn', motDePasse: 'faux-mot-de-passe' }),
      })
      expect(r.status).toBe(401)
    }

    await supervision.vider()
    const [p] = await points(supervision.instance)
    expect(p, 'une ligne de points écrite').toBeTruthy()
    expect(Number(p.requetes)).toBe(10)
    expect(Number(p.erreurs_4xx)).toBe(5)
    expect(Number(p.erreurs_5xx)).toBe(0)
    expect(Number(p.echecs_authentification)).toBe(5)
    expect(p.redemarrage).toBe(true)
    expect(Number(p.cpu_pourcent)).toBeGreaterThanOrEqual(0)
    expect(Number(p.rss_octets)).toBeGreaterThan(0)
    expect(Number(p.base_latence_ms)).toBeGreaterThanOrEqual(0)

    const { rows: ev } = await client.query(
      'select type, categorie, origine, message, detail from kaissi.supervision_evenements order by id',
    )
    const types = ev.map((e) => e.type)
    expect(types.filter((t) => t === 'jeton_appareil_refuse')).toHaveLength(3)
    expect(types.filter((t) => t === 'echec_authentification')).toHaveLength(2)
    expect(types).toContain('demarrage')
    // L'adresse est TRONQUÉE, et aucune trace du mot de passe ni du jeton.
    const texte = JSON.stringify(ev)
    expect(texte).not.toContain('203.0.113.42')
    expect(texte).toContain('203.0.113.0/24')
    expect(texte).not.toContain('faux-mot-de-passe')
    expect(texte).not.toContain('jeton-invente')
  })

  it('une seconde période ne recompte pas la première', async () => {
    const { app, supervision } = nouveauServeur()
    await app.request('http://test/sante')
    await supervision.vider()
    await new Promise((f) => setTimeout(f, 1_100))
    await app.request('http://test/sante')
    await app.request('http://test/sante')
    await supervision.vider()
    const lignes = await points(supervision.instance)
    expect(lignes.map((l) => Number(l.requetes)).reduce((a, b) => a + b, 0)).toBe(3)
    expect(lignes.filter((l) => l.redemarrage)).toHaveLength(1)
  })
})

describe('les erreurs vues chez le client', () => {
  it('une erreur de caisse entre au journal, nettoyée, rattachée à son terminal', async () => {
    const { app, supervision } = nouveauServeur()
    const caisse = await creerAppareil('SV4')
    const envoyer = (corps: unknown) =>
      app.request('http://test/sync/erreurs', {
        method: 'POST',
        headers: { authorization: `Bearer ${caisse.jetonClair}`, 'content-type': 'application/json' },
        body: JSON.stringify(corps),
      })
    const r = await envoyer({
      erreurs: [
        {
          signature: 'a1b2c3',
          type: 'erreur',
          message: 'Cannot read properties of undefined (reading "prix") — gerant@resto.tn',
          pile: 'TypeError at Encaissement (index.js:1:2) jeton abcdefghijklmnopqrstuvwxyz0123456789',
          ecran: 'Encaissement',
          version: '1.4.2',
          nombre: 3,
        },
        { signature: 'pas valide !', message: 'ignorée' },
        { signature: 'sansmessage' },
      ],
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ enregistres: ['a1b2c3'] })
    await supervision.vider()
    const { rows } = await client.query(
      "select categorie, device_id, message, detail from kaissi.supervision_evenements where type = 'erreur_caisse'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].categorie).toBe('terminal')
    expect(rows[0].device_id).toBe(caisse.id)
    expect(rows[0].message).toContain('(×3)')
    expect(rows[0].detail).toMatchObject({ ecran: 'Encaissement', version: '1.4.2', nombre: 3 })
    const texte = JSON.stringify(rows)
    expect(texte).not.toContain('gerant@')
    expect(texte).not.toContain('abcdefghijklmnopqrstuvwxyz')

    // Plus de vingt : refusé, et la caisse les garde pour le cycle suivant.
    const trop = await envoyer({ erreurs: Array.from({ length: 21 }, (_, i) => ({ signature: `s${i}`, message: 'x' })) })
    expect(trop.status).toBe(400)
  })

  it('sans jeton d’appareil, rien n’entre', async () => {
    const { app } = nouveauServeur()
    const r = await app.request('http://test/sync/erreurs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ erreurs: [{ signature: 'x', message: 'y' }] }),
    })
    expect(r.status).toBe(401)
  })

  it('une page d’erreur du back-office : chemin réduit à sa forme, plafond par période', async () => {
    const { app, supervision } = nouveauServeur()
    const signaler = () =>
      app.request('http://test/admin/erreur-ecran', {
        method: 'POST',
        headers: { authorization: 'Bearer jeton-client', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({
          chemin: '/01930000-0000-7000-8000-000000000002/ventes?du=2026-11-01',
          digest: '1234567890',
          message: '',
        }),
      })
    expect((await signaler()).status).toBe(200)
    for (let i = 0; i < 40; i += 1) await signaler()
    await supervision.vider()
    const { rows } = await client.query(
      "select message, origine, detail from kaissi.supervision_evenements where type = 'erreur_backoffice'",
    )
    expect(rows).toHaveLength(30)
    expect(rows[0].detail).toEqual({ chemin: '/‹id›/ventes', digest: '1234567890' })
    expect(rows[0].origine).toBe('203.0.113.0/24')
    // Sans session valide : refusé.
    const anonyme = await app.request('http://test/admin/erreur-ecran', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chemin: '/' }),
    })
    expect(anonyme.status).toBe(401)
  })
})

describe('les alertes qui sortent du service', () => {
  it('UNE notification par transition — ouverture, aggravation, résolution — jamais par période', async () => {
    const { supervision } = nouveauServeur()
    const alerte = (niveau: 'attention' | 'critique'): Alerte => ({ cle: 'test.astreinte', niveau, sujet: 'Astreinte', message: niveau })

    alertesAFournir = [alerte('attention')]
    await supervision.vider()
    await supervision.vider()
    await supervision.attendreNotifications()
    expect(notifies.map((n) => n.transition)).toEqual(['ouvert'])

    alertesAFournir = [alerte('critique')]
    await supervision.vider()
    await supervision.vider()
    await supervision.attendreNotifications()
    expect(notifies.map((n) => n.transition)).toEqual(['ouvert', 'aggrave'])

    alertesAFournir = []
    await new Promise((f) => setTimeout(f, 1_200))
    await supervision.vider()
    await supervision.attendreNotifications()
    expect(notifies.map((n) => [n.transition, n.niveau])).toEqual([
      ['ouvert', 'attention'],
      ['aggrave', 'critique'],
      ['resolu', 'critique'],
    ])

    // Et l'envoi est inscrit au journal, pour qu'on sache que l'astreinte a été prévenue.
    await supervision.vider()
    const { rows } = await client.query(
      "select count(*)::int as n from kaissi.supervision_evenements where type = 'alerte_envoyee'",
    )
    expect(rows[0].n).toBe(3)
  })

  it('un webhook qui échoue ne bloque pas l’écriture, et se voit au journal', async () => {
    const supervision = new Supervision(depot, {
      intervalleMs: 400,
      instance: 'test-echec-webhook',
      alertes: async () => [{ cle: 'test.webhook', niveau: 'critique', sujet: 'Webhook', message: 'x' }],
      notificateur: { envoyer: async () => ({ envoye: false, raison: 'echec', detail: 'HTTP 500' }) },
    })
    await supervision.vider()
    await supervision.attendreNotifications()
    await supervision.vider()
    const { rows } = await client.query(
      "select message from kaissi.supervision_evenements where type = 'alerte_non_envoyee'",
    )
    expect(rows.map((r) => r.message)).toEqual(['L’alerte n’a pas pu partir (HTTP 500) : Webhook.'])
  })
})

describe('la synchronisation et les terminaux', () => {
  it('des rejets du même code font UN événement, avec leur nombre', async () => {
    const { supervision } = nouveauServeur()
    const caisse = await creerAppareil('SV3')
    supervision.rejetsSynchronisation(
      { restaurantId: DEMO_RESTO, deviceId: caisse.id },
      [{ code: 'transition_invalide' }, { code: 'transition_invalide' }, { code: 'forme_invalide' }],
    )
    await supervision.vider()
    const { rows } = await client.query(
      "select detail, device_id from kaissi.supervision_evenements where type = 'operation_rejetee' order by detail->>'code'",
    )
    expect(rows.map((r) => [r.detail.code, r.detail.n])).toEqual([
      ['forme_invalide', 1],
      ['transition_invalide', 2],
    ])
    expect(rows.every((r) => r.device_id === caisse.id)).toBe(true)
  })
})

describe('les incidents', () => {
  it('une alerte persistante reste UN incident, puis se résout seule', async () => {
    const { supervision } = nouveauServeur()
    alertesAFournir = [{ cle: 'test.condition', niveau: 'critique', sujet: 'Test', message: 'première' }]
    await supervision.vider()
    alertesAFournir = [{ cle: 'test.condition', niveau: 'critique', sujet: 'Test', message: 'seconde' }]
    await supervision.vider()

    let { rows } = await client.query("select * from kaissi.supervision_incidents where cle = 'test.condition'")
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences).toBe(2)
    expect(rows[0].message).toBe('seconde')
    expect(rows[0].statut).toBe('ouvert')

    // La cause disparaît : au-delà de deux périodes et demie, résolution d'office.
    alertesAFournir = []
    await new Promise((f) => setTimeout(f, 1_200))
    await supervision.vider()
    ;({ rows } = await client.query("select * from kaissi.supervision_incidents where cle = 'test.condition'"))
    expect(rows[0].statut).toBe('resolu')
    expect(rows[0].resolution).toBe('automatique')

    // Elle revient : un NOUVEL incident, l'ancien reste dans l'historique.
    alertesAFournir = [{ cle: 'test.condition', niveau: 'attention', sujet: 'Test', message: 'retour' }]
    await supervision.vider()
    ;({ rows } = await client.query(
      "select statut from kaissi.supervision_incidents where cle = 'test.condition' order by ouvert_le",
    ))
    expect(rows.map((r) => r.statut)).toEqual(['resolu', 'ouvert'])
  })

  it('les refus massifs ouvrent un incident de sécurité', async () => {
    const { app, supervision } = nouveauServeur()
    for (let i = 0; i < 12; i += 1) {
      await app.request('http://test/sync/pull?protocolVersion=1', {
        headers: { authorization: 'Bearer jeton-invente-0000000000000000', 'x-forwarded-for': '198.51.100.9' },
      })
    }
    await supervision.vider()
    const { rows } = await client.query(
      "select cle, niveau from kaissi.supervision_incidents where cle like 'securite.%'",
    )
    expect(rows.map((r) => r.cle)).toContain('securite.source:198.51.100.0/24')
  })
})

describe('POST /admin/supervision et /admin/supervision/incident', () => {
  const lire = (app: ReturnType<typeof nouveauServeur>['app'], jeton: string, corps: unknown) =>
    app.request('http://test/admin/supervision', {
      method: 'POST',
      headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    })

  it('refuse un compte qui n’est pas éditeur', async () => {
    const { app } = nouveauServeur()
    const r = await lire(app, 'jeton-client', { fenetre: '24h' })
    expect(r.status).toBe(401)
  })

  it('rend l’état vivant, la série, les incidents, le journal et les terminaux', async () => {
    const { app, supervision } = nouveauServeur()
    await creerAppareil('SV2')
    alertesAFournir = [{ cle: 'test.ecran', niveau: 'attention', sujet: 'Test', message: 'à l’écran' }]
    await app.request('http://test/sante')
    await supervision.vider()

    const r = await lire(app, 'jeton-editeur', { fenetre: '1h', categorie: 'application' })
    expect(r.status).toBe(200)
    const corps = (await r.json()) as {
      vivant: { alertes: unknown[] }
      historique: {
        serie: { requetes: number }[]
        incidentsOuverts: { cle: string; id: string }[]
        evenements: { categorie: string }[]
        terminaux: { libelle: string }[]
        totaux: { requetes: number }
      } | null
      erreurHistorique: string | null
    }
    expect(corps.erreurHistorique).toBeNull()
    expect(corps.historique!.serie.length).toBeGreaterThanOrEqual(1)
    expect(corps.historique!.totaux.requetes).toBeGreaterThanOrEqual(1)
    expect(corps.historique!.incidentsOuverts.map((i) => i.cle)).toContain('test.ecran')
    expect(corps.historique!.evenements.every((e) => e.categorie === 'application')).toBe(true)
    expect(corps.historique!.terminaux.map((t) => t.libelle)).toContain('Terminal SV2')
    expect(Array.isArray(corps.vivant.alertes)).toBe(true)

    // Prise en charge, puis résolution — et un second « résoudre » est refusé.
    const id = corps.historique!.incidentsOuverts.find((i) => i.cle === 'test.ecran')!.id
    const agir = (action: string) =>
      app.request('http://test/admin/supervision/incident', {
        method: 'POST',
        headers: { authorization: 'Bearer jeton-editeur', 'content-type': 'application/json' },
        body: JSON.stringify({ id, action, note: 'vu, je regarde' }),
      })
    expect((await agir('prendre_en_charge')).status).toBe(200)
    const resolu = await agir('resoudre')
    expect(resolu.status).toBe(200)
    expect(((await resolu.json()) as { incident: { statut: string; resolu_par?: string; resoluPar: string } }).incident)
      .toMatchObject({ statut: 'resolu', resoluPar: EDITEUR })
    expect((await agir('resoudre')).status).toBe(409)
  })
})
