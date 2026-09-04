/**
 * La rupture automatique (migration 0023).
 *
 * La règle du dépôt reste entière : **le stock ne bloque jamais une vente**.
 * Ce qui change, c'est QUI décide qu'un produit sort de la carte, et SUR
 * QUELLE DONNÉE.
 *
 * Une tablette hors ligne ne connaît qu'un souvenir — la laisser refuser une
 * vente sur cette base serait le pire des deux mondes. Le SERVEUR, lui,
 * travaille sur `stock_actuel` calculé à l'instant : il bascule
 * `products.is_available`, qui redescend aux caisses par le catalogue, comme
 * un changement de prix. La caisse n'arbitre rien ; elle applique un réglage.
 *
 * Ces tests protègent les trois garde-fous sans lesquels l'automatisme
 * deviendrait ingérable :
 *   1. un arrêt MANUEL n'est jamais défait par l'automatisme ;
 *   2. l'automatisme se coupe produit par produit ;
 *   3. le retour en carte est automatique lui aussi, mais seulement pour ce
 *      que l'automatisme avait retiré.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { creerAppareil, ev, ESPECES, TVA_19, DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const { rows: produits } = await client.query<{ id: string }>(
  'select id from kaissi.products where restaurant_id = $1 order by position limit 2',
  [DEMO_RESTO],
)
const produit = produits[0]!.id
const autre = produits[1]!.id

/**
 * Pose un comptage de référence.
 *
 * `compteA` est réglable parce que les événements de test portent un
 * `clientTs` FIXE (août 2026) : la vue ne soustrait que les ventes dont la
 * commande est ouverte APRÈS le comptage. Un comptage à « maintenant »
 * laisserait donc la vente hors du calcul, et le test passerait pour une
 * mauvaise raison.
 */
async function poserStock(
  id: string,
  quantite: number,
  auto = true,
  compteA = "now() - interval '1 hour'",
) {
  await client.query('delete from kaissi.stock_items where product_id = $1', [id])
  await client.query(
    `insert into kaissi.stock_items
       (product_id, organization_id, restaurant_id, qty_reference, counted_at,
        min_qty, auto_rupture)
     values ($1, $2, $3, $4, ${compteA}, 2, $5)`,
    [id, DEMO_ORG, DEMO_RESTO, quantite, auto],
  )
}

async function appliquer(produits: string[] | null = null) {
  const { rows } = await client.query<{ appliquer_rupture_auto: number }>(
    'select kaissi.appliquer_rupture_auto($1, $2::uuid[])',
    [DEMO_RESTO, produits],
  )
  return rows[0]!.appliquer_rupture_auto
}

async function carte(id: string) {
  const { rows } = await client.query<{
    is_available: boolean
    unavailable_reason: string | null
  }>('select is_available, unavailable_reason from kaissi.products where id = $1', [id])
  return rows[0]!
}

beforeEach(async () => {
  for (const id of [produit, autre]) {
    await client.query('delete from kaissi.stock_movements where product_id = $1', [id])
    await client.query('delete from kaissi.stock_items where product_id = $1', [id])
    await client.query(
      'update kaissi.products set is_available = true, unavailable_reason = null where id = $1',
      [id],
    )
  }
})

afterAll(async () => {
  for (const id of [produit, autre]) {
    await client.query('delete from kaissi.stock_movements where product_id = $1', [id])
    await client.query('delete from kaissi.stock_items where product_id = $1', [id])
    await client.query(
      'update kaissi.products set is_available = true, unavailable_reason = null where id = $1',
      [id],
    )
  }
  await client.end()
})

describe('rupture automatique', () => {
  it('retire de la carte un produit suivi tombé à zéro', async () => {
    await poserStock(produit, 0)
    expect(await appliquer()).toBe(1)
    expect(await carte(produit)).toEqual({ is_available: false, unavailable_reason: 'stock' })
  })

  it('retire aussi un stock NÉGATIF — zéro et négatif sont le même état', async () => {
    await poserStock(produit, -3)
    await appliquer()
    expect((await carte(produit)).is_available).toBe(false)
  })

  it('laisse en carte un produit qui a du stock', async () => {
    await poserStock(produit, 4)
    expect(await appliquer()).toBe(0)
    expect((await carte(produit)).is_available).toBe(true)
  })

  it('ne touche PAS un produit sans suivi de stock', async () => {
    // Un café, une bouteille d'eau du frigo : rien n'est compté, donc rien
    // ne doit disparaître de la carte.
    expect(await appliquer()).toBe(0)
    expect((await carte(produit)).is_available).toBe(true)
  })

  it('remet en vente à la première réception', async () => {
    await poserStock(produit, 0)
    await appliquer()
    expect((await carte(produit)).is_available).toBe(false)

    await client.query(
      `insert into kaissi.stock_movements
         (organization_id, restaurant_id, product_id, qty_delta, reason)
       values ($1, $2, $3, 24, 'reception')`,
      [DEMO_ORG, DEMO_RESTO, produit],
    )
    expect(await appliquer()).toBe(1)
    expect(await carte(produit)).toEqual({ is_available: true, unavailable_reason: null })
  })

  it('ne défait JAMAIS un arrêt décidé par le gérant', async () => {
    // Le cas qui rendrait l'automatisme inacceptable : « on ne fait plus de
    // brik ce soir », et une réception de pâte le remet en vente tout seul.
    await poserStock(produit, 50)
    await client.query(
      `update kaissi.products
          set is_available = false, unavailable_reason = 'manuel' where id = $1`,
      [produit],
    )
    expect(await appliquer()).toBe(0)
    expect(await carte(produit)).toEqual({ is_available: false, unavailable_reason: 'manuel' })
  })

  it('respecte l automatisme coupé produit par produit', async () => {
    await poserStock(produit, 0, false)
    expect(await appliquer()).toBe(0)
    expect((await carte(produit)).is_available).toBe(true)
  })

  it('ne travaille que sur les produits qu on lui nomme', async () => {
    await poserStock(produit, 0)
    await poserStock(autre, 0)
    expect(await appliquer([produit])).toBe(1)
    expect((await carte(produit)).is_available).toBe(false)
    expect((await carte(autre)).is_available).toBe(true)
  })

  it('est idempotente : la rejouer ne change plus rien', async () => {
    await poserStock(produit, 0)
    expect(await appliquer()).toBe(1)
    expect(await appliquer()).toBe(0)
    expect(await appliquer()).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Efface tout ce qu'un terminal de test a produit, dans l'ordre des clés
 * étrangères. `devices` est unique par (restaurant, préfixe) : sans ce ménage,
 * un test interrompu laisse un terminal derrière lui et le suivant échoue
 * pour une raison sans rapport avec ce qu'il vérifie.
 */
async function purgerTerminal(prefixe: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    'select id from kaissi.devices where ticket_prefix = $1 and restaurant_id = $2',
    [prefixe, DEMO_RESTO],
  )
  if (rows.length === 0) return
  const ids = rows.map((r) => r.id)
  await client.query('alter table kaissi.order_events disable trigger order_events_immuable')
  try {
    await client.query(
      `delete from kaissi.payments p using kaissi.orders o
        where o.id = p.order_id and o.device_id = any($1::uuid[])`,
      [ids],
    )
    await client.query(
      `delete from kaissi.order_items i using kaissi.orders o
        where o.id = i.order_id and o.device_id = any($1::uuid[])`,
      [ids],
    )
    await client.query('delete from kaissi.order_events where device_id = any($1::uuid[])', [ids])
    await client.query('delete from kaissi.orders where device_id = any($1::uuid[])', [ids])
    await client.query('delete from kaissi.shifts where device_id = any($1::uuid[])', [ids])
    await client.query('delete from kaissi.sync_mutations where device_id = any($1::uuid[])', [ids])
    await client.query('delete from kaissi.sync_cursors where device_id = any($1::uuid[])', [ids])
    await client.query('delete from kaissi.devices where id = any($1::uuid[])', [ids])
  } finally {
    await client.query('alter table kaissi.order_events enable trigger order_events_immuable')
  }
}

describe('de bout en bout : la vente qui vide le stock retire le produit', () => {
  const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
  const app = creerServeur({ depot })

  afterAll(async () => {
    await depot.fermer()
  })

  it('sort le produit de la carte au moment même où la vente est projetée', async () => {
    // Deux unités en stock, on en vend deux : c'est le cycle complet, du
    // push de la tablette jusqu'au réglage de catalogue qui lui reviendra.
    await poserStock(produit, 2, true, "timestamptz '2026-01-01T00:00:00Z'")
    /*
     * La référence se pose AU-DESSUS de ce qui a déjà été vendu.
     *
     * `stock_actuel` compte toutes les ventes depuis le comptage, et le
     * comptage est ici volontairement ancien (janvier) pour que la vente de
     * ce test — horodatée par l'événement, donc dans le passé — soit
     * comptée. Il attrape du même coup les commandes laissées par les
     * autres fichiers de test sur ce même produit : sans cette correction,
     * ce test mesurait l'historique du voisin et échouait selon l'ordre
     * d'exécution, ce qui est le pire des échecs — il n'apprend rien, et on
     * finit par l'ignorer.
     */
    const { rows: dejaVendu } = await client.query<{ qty_vendue: string }>(
      'select qty_vendue from kaissi.stock_actuel where product_id = $1',
      [produit],
    )
    await client.query(
      'update kaissi.stock_items set qty_reference = 2 + $2 where product_id = $1',
      [produit, Number(dejaVendu[0]?.qty_vendue ?? 0)],
    )
    // Un préfixe propre à ce test : `devices` est unique par (restaurant,
    // préfixe), et un test qui échoue en cours de route laisserait sinon un
    // terminal derrière lui — le suivant échouerait alors pour une raison
    // sans rapport avec ce qu'il vérifie.
    await purgerTerminal('PR')
    const a = await creerAppareil('PR')
    const orderId = uuidV7()

    const reponse = await app.request('http://test/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
      body: JSON.stringify({
        protocolVersion: 1,
        batchId: uuidV7(),
        evenements: [
          ev(a, orderId, 'order.opened', {
            type: 'takeaway',
            ouvertePar: null as never,
            numeroTicket: `${a.prefixe}-${orderId.slice(-6)}`,
          }),
          ev(a, orderId, 'line.added', {
            ligneId: uuidV7(),
            produitId: produit,
            designation: 'Produit suivi',
            quantite: 2,
            prixBaseMillimes: millimes(5_000),
            modificateursMillimes: millimes(0),
            tauxTaxeId: TVA_19,
          }),
          ev(a, orderId, 'payment.recorded', {
            paiementId: uuidV7(),
            methodeId: ESPECES,
            mode: 'cash',
            montantMillimes: millimes(10_000),
            recuMillimes: millimes(10_000),
            renduMillimes: millimes(0),
          }),
          ev(a, orderId, 'order.closed', {
            totalMillimes: millimes(10_000),
            closePar: null as never,
          }),
        ],
      }),
    })
    expect(reponse.status).toBe(200)

    const { rows } = await client.query<{ qty_on_hand: string }>(
      'select qty_on_hand from kaissi.stock_actuel where product_id = $1',
      [produit],
    )
    expect(Number(rows[0]!.qty_on_hand)).toBe(0)
    expect(await carte(produit)).toEqual({ is_available: false, unavailable_reason: 'stock' })

    // Ménage : la commande de ce test ne doit pas fausser les suivants.
    await purgerTerminal('PR')
  })
})
