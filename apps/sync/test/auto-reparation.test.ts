/**
 * Le serveur répare ses projections tout seul, au démarrage.
 *
 * ── Ce que ce test protège ────────────────────────────────────────────────
 *
 * Deux ventes réellement encaissées ont été invisibles au back-office : tous
 * leurs événements étaient sur le serveur, `order.closed` compris, mais
 * aucune ligne dans `orders`. La cause est corrigée ; restait la question
 * qui compte pour un restaurateur : QUI répare celles qui sont déjà là ?
 *
 * La réponse ne peut pas être « il lance une commande ». Il ne la lancera
 * pas, il n'a pas la chaîne de connexion à la base de production, et il n'a
 * aucune raison de soupçonner le trou. Le serveur balaie donc au démarrage.
 *
 * Le test tape dans un VRAI PostgreSQL : c'est la requête d'anti-jointure et
 * la reprojection qu'on vérifie, pas notre idée de ce qu'elles font.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7, type Millimes } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { reparerProjectionsOrphelines } from '../src/reparation.js'
import {
  EMPLOYE_DEMO,
  ESPECES,
  TVA_19,
  URL_TEST,
  creerAppareil,
  ev,
  nettoyer,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

/** Muet : ce test vérifie l'effet, pas le texte du journal. */
const silence = () => {}

async function sql(texte: string, valeurs: unknown[] = []) {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    return await client.query(texte, valeurs)
  } finally {
    await client.end()
  }
}

/** Une vente complète : ouverture, une ligne, encaissement, clôture. */
async function encaisser(a: AppareilTest, prixMillimes: Millimes): Promise<string> {
  const orderId = uuidV7()
  const evenements = [
    ev(a, orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${a.prefixe}-${orderId.slice(-6)}`,
    }),
    ev(a, orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000200',
      designation: 'Ojja merguez',
      quantite: 1,
      prixBaseMillimes: prixMillimes,
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ev(a, orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: prixMillimes,
      recuMillimes: prixMillimes,
    }),
    ev(a, orderId, 'order.closed', { totalMillimes: prixMillimes, closePar: EMPLOYE_DEMO }),
  ]

  const reponse = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  const corps = (await reponse.json()) as { rejetes: unknown[] }
  expect(corps.rejetes).toEqual([])
  return orderId
}

beforeEach(nettoyer)
afterAll(() => depot.fermer())

describe('balayage des projections orphelines', () => {
  it('reconstruit une vente dont la projection a disparu', async () => {
    const a = await creerAppareil('P1')
    const orderId = await encaisser(a, millimes(15))

    // On simule EXACTEMENT l'état de production : les événements sont là,
    // la projection ne l'est pas. Supprimer la projection est légitime —
    // c'est de la donnée dérivée ; supprimer un événement ne le serait pas,
    // et les déclencheurs d'immuabilité l'interdisent.
    await sql('delete from kaissi.orders where id = $1', [orderId])
    const avant = await sql('select 1 from kaissi.orders where id = $1', [orderId])
    expect(avant.rowCount).toBe(0)

    const resultat = await reparerProjectionsOrphelines(depot, { journaliser: silence })
    expect(resultat.reparees).toBe(1)

    const apres = await sql(
      `select o.status, o.total_millimes,
              (select count(*) from kaissi.order_items i where i.order_id = o.id) as lignes
         from kaissi.orders o where o.id = $1`,
      [orderId],
    )
    expect(apres.rowCount).toBe(1)
    // Reconstruite JUSTE : le statut, le total au millime, et les lignes.
    // Une projection réapparue mais fausse serait pire que pas de projection.
    expect(apres.rows[0].status).toBe('close')
    expect(Number(apres.rows[0].total_millimes)).toBe(millimes(15))
    expect(Number(apres.rows[0].lignes)).toBe(1)
  })

  it('ne touche pas aux commandes déjà projetées', async () => {
    // Rejouer tout l'historique à chaque démarrage est une opération
    // d'heures creuses, pas de démarrage — et sur une base de production
    // en heure de pointe, ce serait une panne.
    const a = await creerAppareil('P1')
    await encaisser(a, millimes(15))

    const resultat = await reparerProjectionsOrphelines(depot, { journaliser: silence })
    expect(resultat.examinees).toBe(0)
    expect(resultat.reparees).toBe(0)
  })

  it('respecte le plafond, et le dit', async () => {
    const a = await creerAppareil('P1')
    const un = await encaisser(a, millimes(15))
    const deux = await encaisser(a, millimes(20))
    await sql('delete from kaissi.orders where id = any($1)', [[un, deux]])

    const resultat = await reparerProjectionsOrphelines(depot, {
      plafond: 1,
      journaliser: silence,
    })
    expect(resultat.reparees).toBe(1)

    // Le suivant rattrape le reste : un plafond ne perd rien, il étale.
    const suite = await reparerProjectionsOrphelines(depot, { journaliser: silence })
    expect(suite.reparees).toBe(1)

    const restant = await sql('select count(*)::int as n from kaissi.orders where id = any($1)', [
      [un, deux],
    ])
    expect(restant.rows[0].n).toBe(2)
  })

  it('ne fait JAMAIS tomber le démarrage quand la base refuse', async () => {
    // Un service qui refuse de servir parce qu'une réparation facultative a
    // échoué serait un remède pire que le mal : les ventes sont dans le
    // journal, et la caisse doit pouvoir continuer à pousser.
    const casse = {
      projectionsOrphelines: () => Promise.reject(new Error('base indisponible')),
      reprojeter: () => Promise.reject(new Error('jamais appelé')),
    } as never

    const resultat = await reparerProjectionsOrphelines(casse, { journaliser: silence })
    expect(resultat.erreur).toContain('base indisponible')
    expect(resultat.reparees).toBe(0)
  })
})
