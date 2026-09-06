/**
 * Le référentiel de réductions (migration 0030), de bout en bout.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 *
 * Une remise est de l'argent qui sort sans qu'aucun billet ne bouge. Le seul
 * endroit où elle se voit est le rapport — et un rapport qui ne sait pas
 * NOMMER la remise ne dit rien : « 340 dinars de réductions » ne distingue
 * pas un happy hour quotidien d'un geste commercial répété chez la même
 * personne.
 *
 * Deux choses doivent donc tenir :
 *
 *   1. le référentiel DESCEND jusqu'à la caisse, par `change_log` — le canal
 *      qui porte déjà le catalogue. Aucune nouvelle voie de synchronisation :
 *      une réduction se propage exactement comme un changement de prix ;
 *   2. la projection RECOPIE le libellé dans la vente, en plus de
 *      l'identifiant. C'est le point contre-intuitif : une jointure aurait
 *      paru plus propre, et elle aurait réécrit les rapports de l'an dernier
 *      le jour où l'on renomme « Happy hour ». Un historique qui change
 *      quand on modifie un réglage n'est plus un historique.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, pointsDeBase, uuidV7 } from '@kaissi/domain'
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

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

const PRODUIT = '01930000-0000-7000-8000-000000000200'

beforeEach(async () => {
  await nettoyer()
  await client.query('delete from kaissi.discounts')
  await client.query("delete from kaissi.change_log where entity_type = 'discounts'")
})

afterAll(async () => {
  await client.query('delete from kaissi.discounts')
  await client.query("delete from kaissi.change_log where entity_type = 'discounts'")
  await depot.fermer()
  await client.end()
})

async function curseur(): Promise<number> {
  const { rows } = await client.query<{ seq: string | null }>(
    'select max(seq) as seq from kaissi.change_log where restaurant_id = $1',
    [DEMO_RESTO],
  )
  return Number(rows[0]?.seq ?? 0)
}

async function creerReduction(nom: string, pourcentageBp: number): Promise<string> {
  const id = uuidV7()
  await client.query(
    `insert into kaissi.discounts
       (id, organization_id, restaurant_id, name, kind, value_bp, position)
     values ($1,$2,$3,$4,'pourcentage',$5,0)`,
    [id, DEMO_ORG, DEMO_RESTO, nom, pourcentageBp],
  )
  return id
}

/** Une vente d'un plat à 20 dinars, remisée puis encaissée. */
async function vendreAvecRemise(
  appareil: AppareilTest,
  remise: { valeurBp: number; motif?: string; reductionId?: string },
  cible: { ligne: boolean },
) {
  const orderId = uuidV7()
  const ligneId = uuidV7()
  const evenements = [
    ev(appareil, orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${appareil.prefixe}-${orderId.slice(-6)}`,
    }),
    ev(appareil, orderId, 'line.added', {
      ligneId,
      produitId: PRODUIT,
      designation: 'Ojja merguez',
      quantite: 1,
      prixBaseMillimes: millimes(20_000),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ev(appareil, orderId, 'discount.applied', {
      ...(cible.ligne ? { ligneId } : {}),
      remise: {
        type: 'pourcentage',
        valeurBp: pointsDeBase(remise.valeurBp),
        ...(remise.motif ? { motif: remise.motif } : {}),
        ...(remise.reductionId ? { reductionId: remise.reductionId } : {}),
      },
    }),
    ev(appareil, orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(18_000),
      recuMillimes: millimes(18_000),
      renduMillimes: millimes(0),
    }),
    ev(appareil, orderId, 'order.closed', { totalMillimes: millimes(18_000), closePar: EMPLOYE_DEMO }),
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
  return orderId
}

describe('le référentiel descend par le catalogue', () => {
  it('journalise une réduction créée au back-office', async () => {
    const depuis = await curseur()
    const id = await creerReduction('Happy hour', 1000)

    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    const entree = page.find((c) => c.entite === 'discounts')
    expect(entree).toBeDefined()
    expect(entree!.entiteId).toBe(id)
    expect(entree!.operation).toBe('insert')
    // 10 %, en POINTS DE BASE entiers. Un `0.1` ici finirait dans un calcul
    // de monnaie, et RÈGLE 1 l'interdit.
    expect(entree!.donnees).toMatchObject({ name: 'Happy hour', value_bp: 1000 })
  })

  it('fait descendre l’ARCHIVAGE, au lieu de supprimer la ligne', async () => {
    const id = await creerReduction('Fin de série', 2500)
    const depuis = await curseur()

    await client.query('update kaissi.discounts set archived_at = now() where id = $1', [id])

    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    const entree = page.find((c) => c.entite === 'discounts')
    expect(entree?.operation).toBe('update')
    // Une suppression n'aurait rien envoyé : la caisse continuerait de
    // proposer une réduction retirée, indéfiniment.
    expect(entree?.donnees?.['archived_at']).not.toBeNull()
  })

  it('n’envoie pas les réductions d’un autre établissement', async () => {
    // RÈGLE 3 : la tenance est portée par la ligne, donc par son journal.
    const depuis = await curseur()
    await creerReduction('Happy hour', 1000)
    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    expect(page.length).toBeGreaterThan(0)
    for (const changement of page) {
      const { rows } = await client.query(
        'select restaurant_id from kaissi.change_log where seq = $1',
        [changement.seq],
      )
      expect(rows[0]?.['restaurant_id']).toBe(DEMO_RESTO)
    }
  })
})

describe('la projection retient le motif de la remise', () => {
  it('inscrit l’identifiant ET le libellé sur la COMMANDE', async () => {
    const appareil = await creerAppareil('R1')
    const id = await creerReduction('Happy hour', 1000)
    const orderId = await vendreAvecRemise(
      appareil,
      { valeurBp: 1000, motif: 'Happy hour', reductionId: id },
      { ligne: false },
    )

    const { rows } = await client.query(
      'select discount_id, discount_label, discount_millimes from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows[0]?.['discount_id']).toBe(id)
    expect(rows[0]?.['discount_label']).toBe('Happy hour')
    expect(Number(rows[0]?.['discount_millimes'])).toBe(2000)
  })

  it('le libellé est RECOPIÉ : renommer le réglage ne réécrit pas l’historique', async () => {
    const appareil = await creerAppareil('R2')
    const id = await creerReduction('Happy hour', 1000)
    const orderId = await vendreAvecRemise(
      appareil,
      { valeurBp: 1000, motif: 'Happy hour', reductionId: id },
      { ligne: false },
    )

    await client.query('update kaissi.discounts set name = $2 where id = $1', [
      id,
      'Apéro du soir',
    ])

    const { rows } = await client.query(
      'select discount_label from kaissi.orders where id = $1',
      [orderId],
    )
    // C'est tout le sujet. Une jointure aurait rendu « Apéro du soir » pour
    // une vente accordée sous « Happy hour ».
    expect(rows[0]?.['discount_label']).toBe('Happy hour')
  })

  it('distingue la remise de LIGNE de la remise globale', async () => {
    const appareil = await creerAppareil('R3')
    const id = await creerReduction('Personnel', 1000)
    const orderId = await vendreAvecRemise(
      appareil,
      { valeurBp: 1000, motif: 'Personnel', reductionId: id },
      { ligne: true },
    )

    const commande = await client.query(
      'select discount_id from kaissi.orders where id = $1',
      [orderId],
    )
    // « −10 % sur le dessert » n'est pas « −10 % sur la table » : la
    // commande, elle, n'a reçu aucune remise globale.
    expect(commande.rows[0]?.['discount_id']).toBeNull()

    const ligne = await client.query(
      'select discount_id, discount_label, line_discount_millimes from kaissi.order_items where order_id = $1',
      [orderId],
    )
    expect(ligne.rows[0]?.['discount_id']).toBe(id)
    expect(ligne.rows[0]?.['discount_label']).toBe('Personnel')
    expect(Number(ligne.rows[0]?.['line_discount_millimes'])).toBe(2000)
  })

  it('accepte une remise SANS motif — le geste commercial reste possible', async () => {
    const appareil = await creerAppareil('R4')
    const orderId = await vendreAvecRemise(appareil, { valeurBp: 1000 }, { ligne: false })

    const { rows } = await client.query(
      'select discount_id, discount_label, discount_millimes from kaissi.orders where id = $1',
      [orderId],
    )
    // Borner la caisse au référentiel obligerait à créer une réduction
    // devant un client qui attend. Le rapport regroupe ces lignes sous
    // « Sans motif » — les faire disparaître donnerait un total juste et
    // une répartition fausse.
    expect(rows[0]?.['discount_id']).toBeNull()
    expect(rows[0]?.['discount_label']).toBeNull()
    expect(Number(rows[0]?.['discount_millimes'])).toBe(2000)
  })
})
