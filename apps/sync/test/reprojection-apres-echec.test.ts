/**
 * Une reprojection ratée ne doit pas effacer une vente du back-office.
 *
 * PANNE OBSERVÉE EN PRODUCTION. Deux ventes avaient TOUS leurs événements
 * dans `order_events`, `order.closed` compris, et AUCUNE ligne dans
 * `orders`. La caisse affichait « À jour, 0 opération en attente ». Le
 * gérant ne les a jamais vues.
 *
 * L'enchaînement :
 *   1. les événements sont insérés et validés dans leur transaction ;
 *   2. la reprojection, qui a la sienne, échoue → 500 ;
 *   3. la caisse garde son outbox et réessaie, comme elle doit ;
 *   4. au second passage l'idempotence reconnaît TOUT le lot, donc plus
 *      aucun événement n'est « recevable » — et la reprojection n'était
 *      rappelée que pour ceux-là ;
 *   5. le serveur répond 200, la caisse vide son outbox.
 *
 * La vente survit dans le journal — rien n'est perdu — mais elle n'entre
 * jamais dans la projection. Définitivement.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import type { DepotSync } from '../src/depot.js'
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

const reel = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

/** Nombre de reprojections qu'il reste à faire échouer. */
let echecsAProvoquer = 0

/**
 * Le vrai dépôt, dont la SEULE reprojection est rendue faillible.
 *
 * On ne simule rien d'autre : les événements sont réellement insérés dans
 * PostgreSQL, l'idempotence est la vraie. C'est exactement la situation de
 * production — une transaction qui passe, l'autre qui tombe.
 */
const depot: DepotSync = new Proxy(reel, {
  get(cible, propriete, recepteur) {
    if (propriete === 'reprojeter') {
      return async (restaurantId: string, orderIds: readonly string[]) => {
        if (echecsAProvoquer > 0) {
          echecsAProvoquer -= 1
          throw new Error('verrou indisponible — panne passagère simulée')
        }
        return reel.reprojeter(restaurantId, orderIds)
      }
    }
    return Reflect.get(cible, propriete, recepteur)
  },
}) as DepotSync

const app = creerServeur({ depot })

function commande(a: AppareilTest, prix: number) {
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
  return {
    orderId,
    evenements: [
      ev('order.opened', {
        type: 'takeaway',
        ouvertePar: null,
        numeroTicket: `${a.prefixe}-${orderId.slice(-6)}`,
      }),
      ev('line.added', {
        ligneId: uuidV7(),
        produitId: '01930000-0000-7000-8000-000000000200',
        designation: 'Ojja merguez',
        quantite: 1,
        prixBaseMillimes: millimes(prix),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      ev('payment.recorded', {
        paiementId: uuidV7(),
        methodeId: ESPECES,
        mode: 'cash',
        montantMillimes: millimes(prix),
        recuMillimes: millimes(prix),
        renduMillimes: millimes(0),
      }),
      ev('order.closed', { totalMillimes: millimes(prix), closePar: null }),
    ] as never[],
  }
}

async function push(a: AppareilTest, evenements: never[]) {
  const reponse = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  return { statut: reponse.status, corps: (await reponse.json().catch(() => null)) as any }
}

beforeEach(async () => {
  echecsAProvoquer = 0
  await nettoyer()
})

afterAll(async () => {
  await reel.fermer()
})

describe('reprojection après un échec passager', () => {
  it('la RETENTATIVE reprojette, même si tout le lot est déjà connu', async () => {
    const a = await creerAppareil('P1')
    const { orderId, evenements } = commande(a, 13_500)

    // 1. La reprojection tombe : le serveur le dit franchement.
    echecsAProvoquer = 1
    const premier = await push(a, evenements)
    expect(premier.statut).toBe(500)

    // Les événements, eux, SONT là — ils ont leur propre transaction.
    const apresEchec = await reel.evenementsConnus(
      DEMO_RESTO,
      evenements.map((e: any) => e.eventId),
    )
    expect(apresEchec.size).toBe(4)

    // 2. La caisse réessaie le MÊME lot. Tout est déjà connu.
    const second = await push(a, evenements)
    expect(second.statut).toBe(200)
    expect(second.corps.doublons).toHaveLength(4)

    // 3. Et c'est le point : la commande DOIT exister dans la projection.
    const projete = await reel.statutsDesCommandes(DEMO_RESTO, [orderId])
    expect(
      projete.get(orderId),
      "La vente est restée invisible au back-office : la reprojection n'a " +
        'pas été rappelée pour un lot entièrement composé de doublons.',
    ).toBe('close')
  })

  it('un lot normal reste projeté du premier coup', async () => {
    const a = await creerAppareil('P2')
    const { orderId, evenements } = commande(a, 24_500)

    const r = await push(a, evenements)
    expect(r.statut).toBe(200)
    expect((await reel.statutsDesCommandes(DEMO_RESTO, [orderId])).get(orderId)).toBe(
      'close',
    )
  })
})
