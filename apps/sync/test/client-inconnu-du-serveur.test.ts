/**
 * Un client que le serveur ne connaît pas ne doit pas bloquer la caisse.
 *
 * ── PANNE OBSERVÉE EN PRODUCTION ─────────────────────────────────────────
 *
 * Le gérant attache un client à une commande, encaisse, et la vente n'arrive
 * jamais au back-office. Pire : plus RIEN n'arrive ensuite. L'écran de
 * synchronisation affiche « 18 opérations en attente », « 5 tentatives
 * échouées » et « Erreur interne du serveur de synchronisation », en boucle,
 * alors que le réseau est parfaitement là.
 *
 * La chaîne, mesurée : `orders.customer_id` porte une clé étrangère vers
 * `kaissi.customers` (migration 0031). La graine de démonstration, elle,
 * écrit ses clients UNIQUEMENT dans la base locale — la table `customers`
 * n'existait pas encore quand la migration 0007 a posé les données de
 * démonstration. Attacher l'un d'eux produit donc un `customer_id` que le
 * serveur ne connaît pas ; la projection viole la contrainte, `reprojeter`
 * lève, et le push répond 500.
 *
 * ── Ce qui rend la panne DÉFINITIVE, et qui est le vrai défaut ───────────
 *
 * Les événements, eux, sont bien insérés — dans leur propre transaction. Le
 * journal est donc complet et rien n'est perdu. Mais la projection échoue à
 * chaque tentative, sur le même événement, pour toujours : la caisse réessaie
 * comme elle doit, et le mur est identique à chaque fois. Une seule commande
 * fautive gèle la file de TOUTES les suivantes.
 *
 * C'est cela qu'on corrige, et pas seulement le cas du client : un événement
 * que le serveur ne sait pas projeter doit être ARBITRÉ — ici, en retenant le
 * nom du client sans son identifiant — jamais laissé bloquer la file. Le nom
 * est déjà stocké à part (`orders.customer_name`) ; c'est tout ce que le
 * ticket et les rapports utilisent.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { creerServeur } from '../src/serveur.js'
import { DepotPostgres } from '../src/depot-postgres.js'
import {
  creerAppareil,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ev,
  nettoyer,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot, auth: null })

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

/*
 * L'appareil est recréé APRÈS le nettoyage : `nettoyer()` vide aussi la table
 * des terminaux, donc un jeton obtenu une fois pour toutes serait refusé 401
 * dès le second test.
 */
beforeEach(async () => {
  await nettoyer()
  await sql('delete from kaissi.customers')
  appareil = await creerAppareil('PC')
})

/** Une vente complète, avec un client attaché dont l'identifiant est donné. */
function venteAvecClient(orderId: string, clientId: string | null, nom: string) {
  return [
    ev(appareil, orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
    }),
    ev(appareil, orderId, 'customer.attached', { clientId, nom }),
    ev(appareil, orderId, 'order.closed', {
      totalMillimes: 0 as never,
      closePar: EMPLOYE_DEMO,
    }),
  ]
}

async function pousser(evenements: unknown[]) {
  return app.request('http://test/sync/push', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${appareil.jetonClair}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ batchId: uuidV7(), evenements, protocolVersion: 1 }),
  })
}

describe('un client inconnu du serveur', () => {
  it('ne fait pas échouer le push — la vente arrive, le NOM est conservé', async () => {
    const orderId = uuidV7()
    const clientFantome = uuidV7() // n'existe dans aucune table `customers`

    const reponse = await pousser(venteAvecClient(orderId, clientFantome, 'Amine Ben Youssef'))

    /*
     * 200, et pas 500. C'est toute la panne : un 500 ici fait réessayer la
     * caisse indéfiniment, sur le même mur, et GÈLE la file de toutes les
     * ventes suivantes.
     */
    expect(reponse.status).toBe(200)

    const { rows } = await sql(
      'select customer_id, customer_name, status from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows, 'la commande doit exister dans la projection').toHaveLength(1)
    /*
     * L'identifiant est écarté — il ne désigne rien ici. Le NOM reste : c'est
     * lui qui figure sur le ticket et dans les rapports, et le perdre ferait
     * disparaître du back-office une information que le caissier a bel et
     * bien saisie.
     */
    expect(rows[0].customer_id).toBeNull()
    expect(rows[0].customer_name).toBe('Amine Ben Youssef')
  })

  it('ne gèle PAS les ventes suivantes', async () => {
    /*
     * Le cœur du défaut. La vente fautive est poussée d'abord ; une vente
     * parfaitement ordinaire suit. Avec le 500, la seconde n'arrivait jamais
     * — non pas parce qu'elle était mauvaise, mais parce que la première
     * revenait en tête de file à chaque cycle.
     */
    const fautive = uuidV7()
    const saine = uuidV7()
    await pousser(venteAvecClient(fautive, uuidV7(), 'Client fantôme'))
    const reponse = await pousser(venteAvecClient(saine, null, 'Client de passage'))

    expect(reponse.status).toBe(200)
    const { rows } = await sql('select id from kaissi.orders where id = any($1)', [
      [fautive, saine],
    ])
    expect(rows.map((l: { id: string }) => l.id).sort()).toEqual([fautive, saine].sort())
  })

  it('garde l’identifiant quand le client EXISTE — on n’écarte pas par précaution', async () => {
    /*
     * Le pendant du premier test, et il compte autant : écarter tous les
     * identifiants aurait fait passer les deux premiers tests en cassant la
     * base clients. Ce qu'on veut est un arbitrage, pas un renoncement.
     */
    const clientId = uuidV7()
    await sql(
      `insert into kaissi.customers (id, organization_id, restaurant_id, name)
       values ($1, $2, $3, $4)`,
      [clientId, DEMO_ORG, DEMO_RESTO, 'Leïla Ben Ammar'],
    )

    const orderId = uuidV7()
    const reponse = await pousser(venteAvecClient(orderId, clientId, 'Leïla Ben Ammar'))
    expect(reponse.status).toBe(200)

    const { rows } = await sql(
      'select customer_id, customer_name from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows[0].customer_id).toBe(clientId)
    expect(rows[0].customer_name).toBe('Leïla Ben Ammar')
  })
})
