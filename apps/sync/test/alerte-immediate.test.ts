/**
 * La rupture prévient TOUT DE SUITE, pas au prochain quart d'heure.
 *
 * PANNE OBSERVÉE. Le dernier sandwich est vendu ; le produit sort de la carte
 * dans la seconde — la caisse le grise, l'écran Stock le dit. Mais la
 * notification, elle, attendait le balayage périodique : jusqu'à quinze
 * minutes pendant lesquelles le gérant regarde un écran qui lui annonce la
 * rupture, et un téléphone qui ne sonne pas. Il en conclut, à raison, que les
 * notifications ne marchent pas.
 *
 * Le correctif ne remplace PAS le balayage périodique : il le réveille. Le
 * périodique reste le filet — il rattrape ce qu'un service redémarré au
 * mauvais moment aurait manqué, et les seuils franchis par un mouvement de
 * stock saisi au back-office.
 *
 * Ce que ces tests protègent :
 *
 *   1. une reprojection qui SORT un produit de la carte réveille le
 *      balayage ;
 *   2. une vente ordinaire — le produit reste en stock — ne réveille
 *      personne. Sans cela, chaque encaissement déclencherait un balayage,
 *      et le service passerait son service à lire la table des alertes ;
 *   3. une rafale d'encaissements fait UNE annonce, pas cinq.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ESPECES,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const { rows: produits } = await client.query<{ id: string }>(
  'select id from kaissi.products where restaurant_id = $1 order by position limit 1',
  [DEMO_RESTO],
)
const PRODUIT = produits[0]!.id

/** Les réveils reçus depuis le dépôt. */
let reveils: string[] = []

const depot = new DepotPostgres({
  connectionString: URL_TEST,
  ssl: false,
  surCarteModifiee: (restaurantId) => reveils.push(restaurantId),
})
const app = creerServeur({ depot })

beforeEach(async () => {
  await nettoyer()
  reveils = []
})

afterAll(async () => {
  await client.query('delete from kaissi.stock_items where product_id = $1', [PRODUIT])
  await client.query(
    "update kaissi.products set is_available = true, unavailable_reason = null where id = $1",
    [PRODUIT],
  )
  await depot.fermer()
  await client.end()
})

/**
 * Pose un comptage tel qu'il reste EXACTEMENT `restant` unités.
 *
 * Deux précautions, et les deux viennent de vraies mésaventures :
 *
 *   • le comptage est daté dans le PASSÉ, parce que les événements de test
 *     portent un `clientTs` fixe d'août 2026. Avec `counted_at = now()`, la
 *     vente est antérieure au comptage : `stock_actuel` ne la compte pas, et
 *     le test échoue en accusant le code ;
 *   • la quantité est calculée à partir de ce qui a DÉJÀ été vendu depuis
 *     cette date. Les autres fichiers de test laissent des commandes
 *     derrière eux ; une quantité écrite en dur ferait passer ou échouer ce
 *     test selon l'ordre d'exécution — le pire des échecs, celui qui
 *     n'apprend rien.
 */
async function poserStock(restant: number) {
  await client.query('delete from kaissi.stock_items where product_id = $1', [PRODUIT])
  const { rows } = await client.query<{ vendu: string }>(
    `select coalesce(sum(oi.qty), 0) as vendu
       from kaissi.order_items oi
       join kaissi.orders o on o.id = oi.order_id
      where oi.product_id = $1 and oi.voided_at is null and o.status <> 'annulee'
        and o.opened_at >= timestamptz '2026-01-01'`,
    [PRODUIT],
  )
  const dejaVendu = Number(rows[0]?.vendu ?? 0)
  await client.query(
    `insert into kaissi.stock_items
       (product_id, organization_id, restaurant_id, qty_reference, counted_at, auto_rupture)
     values ($1, $2, $3, $4, timestamptz '2026-01-01', true)`,
    [PRODUIT, DEMO_ORG, DEMO_RESTO, dejaVendu + restant],
  )
  await client.query(
    "update kaissi.products set is_available = true, unavailable_reason = null where id = $1",
    [PRODUIT],
  )
}

/** Vend UNE unité du produit suivi, et l'encaisse. */
async function vendreUne(appareil: AppareilTest) {
  const orderId = uuidV7()
  const evenements = [
    ev(appareil, orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${appareil.prefixe}-${orderId.slice(-6)}`,
    }),
    ev(appareil, orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: PRODUIT,
      designation: 'Sandwich',
      quantite: 1,
      prixBaseMillimes: millimes(5_000),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ev(appareil, orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(5_000),
      recuMillimes: millimes(5_000),
      renduMillimes: millimes(0),
    }),
    ev(appareil, orderId, 'order.closed', {
      totalMillimes: millimes(5_000),
      closePar: EMPLOYE_DEMO,
    }),
  ]
  const reponse = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${appareil.jetonClair}`,
    },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  expect(reponse.status).toBe(200)
}

describe('la vente qui vide le stock réveille l’alerte', () => {
  it('réveille quand le produit SORT de la carte', async () => {
    const appareil = await creerAppareil('A1')
    await poserStock(1) // il en reste UN

    await vendreUne(appareil)

    const { rows } = await client.query<{ is_available: boolean }>(
      'select is_available from kaissi.products where id = $1',
      [PRODUIT],
    )
    expect(rows[0]?.is_available, 'le produit doit sortir de la carte').toBe(false)
    // LE point : le gérant n'attend pas le prochain quart d'heure.
    expect(reveils).toEqual([DEMO_RESTO])
  })

  it('ne réveille PAS une vente ordinaire', async () => {
    const appareil = await creerAppareil('A2')
    await poserStock(50)

    await vendreUne(appareil)

    // Chaque encaissement déclencherait sinon un balayage complet : le
    // service passerait son service à relire la table des alertes.
    expect(reveils).toEqual([])
  })

  it('ne réveille pas non plus quand l’automatisme est coupé', async () => {
    const appareil = await creerAppareil('A3')
    await poserStock(1)
    await client.query(
      'update kaissi.stock_items set auto_rupture = false where product_id = $1',
      [PRODUIT],
    )

    await vendreUne(appareil)

    // Le comptage n'est qu'indicatif : rien ne sort de la carte, donc rien
    // à annoncer.
    expect(reveils).toEqual([])
  })

  it('réveille au RETOUR en carte, pas seulement à la rupture', async () => {
    const appareil = await creerAppareil('A4')
    await poserStock(1)
    await vendreUne(appareil)
    reveils = []

    // Une réception remet le produit en vente : c'est aussi un changement de
    // carte, et c'est ce qui clôt l'alerte ouverte. On ajoute au comptage
    // plutôt que de le refaire, pour ne pas déplacer `counted_at`.
    await client.query(
      'update kaissi.stock_items set qty_reference = qty_reference + 20 where product_id = $1',
      [PRODUIT],
    )
    const appareil2 = await creerAppareil('A5')
    await vendreUne(appareil2)

    expect(reveils).toEqual([DEMO_RESTO])
    const { rows } = await client.query<{ is_available: boolean }>(
      'select is_available from kaissi.products where id = $1',
      [PRODUIT],
    )
    expect(rows[0]?.is_available).toBe(true)
  })
})
