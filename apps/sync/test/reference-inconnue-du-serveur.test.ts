/**
 * Une référence que le serveur ne connaît pas ne bloque JAMAIS la caisse.
 *
 * ── PANNE OBSERVÉE EN PRODUCTION (septembre 2026) ─────────────────────────
 *
 * Une caissière applique « Happy hour » à une commande, encaisse, et plus
 * RIEN ne remonte : « 11 opérations en attente », « Erreur interne du
 * serveur de synchronisation », à chaque cycle, réseau parfait. Le journal
 * PostgreSQL disait :
 *
 *   invalid input syntax for type uuid: "01930000-0000-7000-8000-00000000960"
 *
 * Trente-cinq caractères au lieu de trente-six : la graine locale du POS
 * fabriquait les identifiants de ses réductions avec un suffixe de TROIS
 * chiffres là où le gabarit en attend quatre. L'identifiant voyage dans
 * l'événement `discount.applied`, et la projection le passait tel quel à la
 * colonne `orders.discount_id` (uuid, clé étrangère) : erreur, 500, file
 * gelée — exactement la panne que `client-inconnu-du-serveur.test.ts` avait
 * déjà corrigée, pour les seuls clients.
 *
 * ── Ce qu'on corrige : la RÈGLE, pas le cas ──────────────────────────────
 *
 * Toute référence qu'une caisse écrit dans un événement vient d'un appareil
 * qui pouvait être hors ligne, sur un référentiel périmé, ou d'une version
 * boguée. Aucune ne doit pouvoir faire échouer la projection. Elle est
 * ARBITRÉE : une référence mal formée, inconnue, ou d'un autre établissement
 * devient nulle, le LIBELLÉ recopié est conservé, et l'anomalie est inscrite
 * dans `orders.exceptions`.
 *
 * Le dernier test fait la vente la plus hostile possible — TOUTES les
 * références fausses à la fois — et exige un 200. C'est lui qui attrapera la
 * prochaine colonne ajoutée sans passer par l'arbitrage.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7, type EvenementCommande } from '@kaissi/domain'
import { creerServeur } from '../src/serveur.js'
import { DepotPostgres } from '../src/depot-postgres.js'
import {
  creerAppareil,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ESPECES,
  ev,
  nettoyer,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot, auth: null })

/** L'identifiant EXACT relevé dans le journal de production. */
const REDUCTION_MAL_FORMEE = '01930000-0000-7000-8000-00000000960'
const PIZZA = '01930000-0000-7000-8000-000000000200'

let appareil: AppareilTest

async function sql(texte: string, valeurs: unknown[] = []) {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    return await client.query(texte, valeurs)
  } finally {
    await client.end()
  }
}

beforeEach(async () => {
  await nettoyer()
  await sql('delete from kaissi.discounts')
  appareil = await creerAppareil('RI')
})

async function pousser(evenements: readonly EvenementCommande[]) {
  return app.request('http://test/sync/push', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${appareil.jetonClair}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ batchId: uuidV7(), evenements, protocolVersion: 1 }),
  })
}

/** Une pizza, une remise GLOBALE de 10 %, payée en espèces. */
function venteRemisee(orderId: string, reductionId: string) {
  const ligneId = uuidV7()
  return [
    ev(appareil, orderId, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO }),
    ev(appareil, orderId, 'line.added', {
      ligneId,
      produitId: PIZZA,
      designation: 'Pizza Margherita',
      quantite: 1,
      prixBaseMillimes: millimes(14500),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ev(appareil, orderId, 'discount.applied', {
      remise: { type: 'pourcentage', valeurBp: 1000 as never, motif: 'Happy hour', reductionId },
    }),
    ev(appareil, orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(13050),
    }),
    ev(appareil, orderId, 'order.closed', { totalMillimes: millimes(13050), closePar: EMPLOYE_DEMO }),
  ]
}

describe('une réduction que le serveur ne connaît pas', () => {
  it('ne fait pas échouer le push — identifiant MAL FORMÉ, celui de la production', async () => {
    const orderId = uuidV7()
    const reponse = await pousser(venteRemisee(orderId, REDUCTION_MAL_FORMEE))

    expect(reponse.status).toBe(200)

    const { rows } = await sql(
      `select discount_id, discount_label, discount_millimes, total_millimes, exceptions
         from kaissi.orders where id = $1`,
      [orderId],
    )
    expect(rows, 'la vente doit exister dans la projection').toHaveLength(1)
    /*
     * La remise, elle, a bel et bien été ACCORDÉE : le client a payé
     * 13,050 et non 14,500. Écarter l'identifiant ne doit rien changer au
     * montant — seul le rattachement au référentiel est perdu.
     */
    expect(rows[0].discount_id).toBeNull()
    expect(rows[0].discount_label).toBe('Happy hour')
    expect(Number(rows[0].discount_millimes)).toBe(1450)
    expect(Number(rows[0].total_millimes)).toBe(13050)
    expect(rows[0].exceptions).toContainEqual(
      expect.objectContaining({ type: 'reference_inconnue', colonne: 'orders.discount_id' }),
    )
  })

  it('ne fait pas échouer le push — identifiant bien formé mais inconnu, sur une LIGNE', async () => {
    const orderId = uuidV7()
    const ligneId = uuidV7()
    const reponse = await pousser([
      ev(appareil, orderId, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO }),
      ev(appareil, orderId, 'line.added', {
        ligneId,
        produitId: PIZZA,
        designation: 'Pizza Margherita',
        quantite: 1,
        prixBaseMillimes: millimes(14500),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      ev(appareil, orderId, 'discount.applied', {
        ligneId,
        remise: { type: 'montant', valeurMillimes: millimes(2000), motif: 'Geste commercial', reductionId: uuidV7() },
      }),
    ])

    expect(reponse.status).toBe(200)
    const { rows } = await sql(
      'select discount_id, discount_label, line_discount_millimes from kaissi.order_items where id = $1',
      [ligneId],
    )
    expect(rows[0].discount_id).toBeNull()
    expect(rows[0].discount_label).toBe('Geste commercial')
    expect(Number(rows[0].line_discount_millimes)).toBe(2000)
  })

  it('ne gèle PAS les ventes suivantes', async () => {
    const fautive = uuidV7()
    const saine = uuidV7()
    await pousser(venteRemisee(fautive, REDUCTION_MAL_FORMEE))
    const reponse = await pousser([
      ev(appareil, saine, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO }),
      ev(appareil, saine, 'order.closed', { totalMillimes: millimes(0), closePar: EMPLOYE_DEMO }),
    ])

    expect(reponse.status).toBe(200)
    const { rows } = await sql('select id from kaissi.orders where id = any($1)', [[fautive, saine]])
    expect(rows).toHaveLength(2)
  })

  it('GARDE l’identifiant quand la réduction existe — on arbitre, on ne renonce pas', async () => {
    const reductionId = uuidV7()
    await sql(
      `insert into kaissi.discounts (id, organization_id, restaurant_id, name, kind, value_bp)
       values ($1, $2, $3, 'Happy hour', 'pourcentage', 1000)`,
      [reductionId, DEMO_ORG, DEMO_RESTO],
    )
    const orderId = uuidV7()
    const reponse = await pousser(venteRemisee(orderId, reductionId))

    expect(reponse.status).toBe(200)
    const { rows } = await sql('select discount_id, exceptions from kaissi.orders where id = $1', [orderId])
    expect(rows[0].discount_id).toBe(reductionId)
    expect(rows[0].exceptions).toEqual([])
  })
})

describe('la règle : AUCUNE référence ne bloque la projection', () => {
  it('un client à l’identifiant mal formé ne lève pas non plus', async () => {
    const orderId = uuidV7()
    const reponse = await pousser([
      ev(appareil, orderId, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO }),
      ev(appareil, orderId, 'customer.attached', { clientId: '01930000-0000-7000-8000-0000000080', nom: 'Salem Haddad' }),
      ev(appareil, orderId, 'order.closed', { totalMillimes: millimes(0), closePar: EMPLOYE_DEMO }),
    ])

    expect(reponse.status).toBe(200)
    const { rows } = await sql('select customer_id, customer_name from kaissi.orders where id = $1', [orderId])
    expect(rows[0].customer_id).toBeNull()
    expect(rows[0].customer_name).toBe('Salem Haddad')
  })

  it('une vente dont TOUTES les références sont fausses arrive quand même', async () => {
    /*
     * La vente la plus hostile qu'une caisse puisse produire : table,
     * employés, produit, variante, poste, réduction, client et moyen de
     * paiement — tous inconnus, la moitié mal formés. Si une colonne à clé
     * étrangère est un jour ajoutée à la projection sans passer par
     * l'arbitrage, c'est ce test qui tombe, pas la caisse d'un client.
     *
     * ⚑ Le TAUX DE TVA reste valide, à dessein. Un taux inconnu n'est pas
     *   un rattachement qu'on peut écarter : sans lui, `calculerTotaux` ne
     *   sait pas calculer la taxe, et décider d'une taxe de repli est une
     *   règle fiscale — elle appartient à `packages/domain`, pas à
     *   l'arbitrage des références.
     */
    const orderId = uuidV7()
    const ligneId = uuidV7()
    const reponse = await pousser([
      ev(appareil, orderId, 'order.opened', {
        type: 'dine_in',
        tableId: 'pas-un-uuid',
        ouvertePar: uuidV7(),
      }),
      ev(appareil, orderId, 'line.added', {
        ligneId,
        produitId: uuidV7(),
        variantId: '01930000-0000-7000-8000-0000000030',
        designation: 'Plat du jour',
        quantite: 2,
        prixBaseMillimes: millimes(12000),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
        stationId: 'cuisine',
      }),
      ev(appareil, orderId, 'discount.applied', {
        remise: { type: 'montant', valeurMillimes: millimes(1000), motif: 'Geste', reductionId: 'x' },
      }),
      ev(appareil, orderId, 'customer.attached', { clientId: uuidV7(), nom: 'Inconnu' }),
      ev(appareil, orderId, 'payment.recorded', {
        paiementId: uuidV7(),
        methodeId: '01930000-0000-7000-8000-00000000050',
        mode: 'cash',
        montantMillimes: millimes(23000),
      }),
      ev(appareil, orderId, 'order.closed', { totalMillimes: millimes(23000), closePar: 'personne' }),
    ])

    expect(reponse.status).toBe(200)

    const commande = await sql('select total_millimes, exceptions from kaissi.orders where id = $1', [orderId])
    expect(commande.rows, 'la vente doit exister dans la projection').toHaveLength(1)
    expect(Number(commande.rows[0].total_millimes)).toBe(23000)
    // Chaque référence écartée est DITE, pas seulement effacée.
    const colonnes = commande.rows[0].exceptions.map((e: { colonne?: string }) => e.colonne)
    expect(colonnes).toEqual(
      expect.arrayContaining([
        'orders.table_id',
        'orders.opened_by',
        'orders.closed_by',
        'orders.discount_id',
        'orders.customer_id',
        'order_items.product_id',
        'order_items.variant_id',
        'order_items.station_id',
        'payments.method_id',
      ]),
    )

    const ligne = await sql('select designation, qty from kaissi.order_items where id = $1', [ligneId])
    expect(ligne.rows[0].designation).toBe('Plat du jour')

    const paiement = await sql('select amount_millimes from kaissi.payments where order_id = $1', [orderId])
    expect(Number(paiement.rows[0].amount_millimes)).toBe(23000)
  })
})
