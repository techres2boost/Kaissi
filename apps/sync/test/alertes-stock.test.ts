/**
 * Les alertes de stock (migration 0028).
 *
 * Ce qui se casse en premier dans un mécanisme d'alerte, ce n'est pas
 * l'envoi : c'est la RÉPÉTITION. Une alerte qui revient toutes les
 * demi-heures se coupe, et on coupe alors aussi les vraies. Ces tests
 * protègent donc surtout le journal :
 *
 *   1. une alerte n'est annoncée qu'UNE fois ;
 *   2. une AGGRAVATION passe quand même — « faible » puis zéro sont deux
 *      nouvelles différentes ;
 *   3. la clôture à la réception est ce qui autorise la suivante ;
 *   4. un comptage indicatif (`auto_rupture` coupé) n'alerte pas.
 *
 * Et un point qui n'a rien d'évident : l'alerte est journalisée MÊME quand
 * aucun canal n'a abouti. Sans cela, un service mal configuré retenterait
 * indéfiniment.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { balayerAlertesStock, messageAlerte } from '../src/alertes.js'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const { rows: produits } = await client.query<{ id: string; name: string }>(
  'select id, name from kaissi.products where restaurant_id = $1 order by position limit 2',
  [DEMO_RESTO],
)
const produit = produits[0]!.id
const autre = produits[1]!.id

async function poserStock(id: string, quantite: number, seuil: number | null, auto = true) {
  await client.query('delete from kaissi.stock_items where product_id = $1', [id])
  await client.query(
    `insert into kaissi.stock_items
       (product_id, organization_id, restaurant_id, qty_reference, counted_at,
        min_qty, auto_rupture)
     values ($1, $2, $3, $4, now(), $5, $6)`,
    [id, DEMO_ORG, DEMO_RESTO, quantite, seuil, auto],
  )
}

/** Les alertes ouvertes, du plus ancien au plus récent. */
async function ouvertes() {
  const { rows } = await client.query<{ product_id: string; niveau: string; canaux: string }>(
    `select product_id, niveau, canaux from kaissi.stock_alerts
      where resolue_a is null order by envoyee_a`,
  )
  return rows
}

/*
 * Aucune clé VAPID, aucun fournisseur d'e-mail : on teste le JOURNAL, qui
 * est la partie qui décide. Les canaux sont explicitement neutralisés
 * (`null` et non « absent ») pour qu'une variable d'environnement traînant
 * sur la machine de test ne fasse pas partir de vraies notifications.
 */
const muet = { vapid: null, email: null, journaliser: () => {} } as const

beforeEach(async () => {
  await client.query('delete from kaissi.stock_alerts')
  for (const id of [produit, autre]) {
    await client.query('delete from kaissi.stock_items where product_id = $1', [id])
    await client.query('delete from kaissi.stock_movements where product_id = $1', [id])
  }
})

afterAll(async () => {
  await client.query('delete from kaissi.stock_alerts')
  await depot.fermer()
  await client.end()
})

describe('balayage des alertes de stock', () => {
  it('annonce une rupture UNE seule fois', async () => {
    await poserStock(produit, 0, 2)

    const premier = await balayerAlertesStock(depot, muet)
    expect(premier.ouvertes).toBe(1)
    expect((await ouvertes())[0]).toMatchObject({ product_id: produit, niveau: 'rupture' })

    // Le deuxième tour ne doit RIEN annoncer : c'est tout l'objet du journal.
    const second = await balayerAlertesStock(depot, muet)
    expect(second.ouvertes).toBe(0)
    expect(await ouvertes()).toHaveLength(1)
  })

  it('journalise même quand aucun canal n’a abouti', async () => {
    await poserStock(produit, 0, 2)
    await balayerAlertesStock(depot, muet)
    // `canaux` vide : rien n'est parti, et c'est écrit noir sur blanc. Le
    // back-office montre l'alerte de toute façon.
    expect((await ouvertes())[0]!.canaux).toBe('')
  })

  it('laisse passer une AGGRAVATION du seuil vers la rupture', async () => {
    await poserStock(produit, 2, 2)
    await balayerAlertesStock(depot, muet)
    expect((await ouvertes())[0]).toMatchObject({ niveau: 'faible' })

    // Le stock tombe à zéro : c'est une nouvelle différente, elle doit partir.
    await client.query(
      `update kaissi.stock_items set qty_reference = 0 where product_id = $1`,
      [produit],
    )
    const tour = await balayerAlertesStock(depot, muet)
    expect(tour.ouvertes).toBe(1)
    const restantes = await ouvertes()
    // L'ancienne a cédé la place : l'index unique partiel n'en admet qu'une.
    expect(restantes).toHaveLength(1)
    expect(restantes[0]).toMatchObject({ niveau: 'rupture' })

    // L'historique, lui, garde les deux : une annulation n'efface jamais rien.
    const { rows } = await client.query<{ n: string }>(
      'select count(*) as n from kaissi.stock_alerts where product_id = $1',
      [produit],
    )
    expect(Number(rows[0]!.n)).toBe(2)
  })

  it('ne re-alerte PAS quand un produit déjà en rupture reste en rupture', async () => {
    await poserStock(produit, 0, 2)
    await balayerAlertesStock(depot, muet)
    // Il s'enfonce encore : le stock négatif est le cas normal d'une vente
    // hors ligne arrivée après coup, ce n'est pas une nouvelle information.
    await client.query(
      `update kaissi.stock_items set qty_reference = -3 where product_id = $1`,
      [produit],
    )
    expect((await balayerAlertesStock(depot, muet)).ouvertes).toBe(0)
  })

  it('clôt l’alerte à la réception, et n’en rouvre une qu’après une nouvelle chute', async () => {
    await poserStock(produit, 0, 2)
    await balayerAlertesStock(depot, muet)

    // Réception de 10 : le motif disparaît.
    await client.query(
      `insert into kaissi.stock_movements
         (organization_id, restaurant_id, product_id, qty_delta, reason)
       values ($1, $2, $3, 10, 'reception')`,
      [DEMO_ORG, DEMO_RESTO, produit],
    )
    const tour = await balayerAlertesStock(depot, muet)
    expect(tour.closes).toBe(1)
    expect(await ouvertes()).toHaveLength(0)

    // Et une nouvelle chute redevient annonçable — c'est la clôture qui
    // l'autorise. Sans elle, ce produit ne serait plus jamais alerté.
    await client.query(
      `update kaissi.stock_movements set qty_delta = -10 where product_id = $1`,
      [produit],
    )
    expect((await balayerAlertesStock(depot, muet)).ouvertes).toBe(1)
  })

  it('n’alerte pas sur un comptage indicatif (auto_rupture coupé)', async () => {
    await poserStock(produit, 0, 2, false)
    expect((await balayerAlertesStock(depot, muet)).ouvertes).toBe(0)
  })

  it('clôt une alerte dont le suivi de stock a été arrêté', async () => {
    await poserStock(produit, 0, 2)
    await balayerAlertesStock(depot, muet)
    // Le gérant arrête de suivre ce produit. Sans cette clôture, l'alerte
    // resterait ouverte POUR TOUJOURS : plus rien ne pourrait la fermer.
    await client.query('delete from kaissi.stock_items where product_id = $1', [produit])
    expect((await balayerAlertesStock(depot, muet)).closes).toBe(1)
    expect(await ouvertes()).toHaveLength(0)
  })

  it('groupe les produits d’un même établissement en une annonce', async () => {
    await poserStock(produit, 0, 2)
    await poserStock(autre, 0, 2)
    const tour = await balayerAlertesStock(depot, muet)
    expect(tour.ouvertes).toBe(2)
    // Deux lignes au journal — une par produit, pour que chacune se referme
    // séparément — mais un seul message, vérifié ci-dessous.
    expect(await ouvertes()).toHaveLength(2)
  })

  it('n’envoie qu’aux gérants et administrateurs actifs', async () => {
    /*
     * On crée NOS destinataires plutôt que de compter ceux du jeu de
     * démonstration : les autres fichiers de test ajoutent des membres au
     * même établissement, et une assertion sur la liste ENTIÈRE dépendrait
     * de l'ordre d'exécution. Ce qui doit être vrai, c'est qu'un gérant y
     * est et qu'un caissier n'y est pas.
     */
    const gerant = uuidV7()
    const caissier = uuidV7()
    const poser = async (id: string, role: string) => {
      await client.query(
        `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name)
         values ($1, $2, null, $3, $4)`,
        [id, DEMO_ORG, `${id}@alertes.essai`, `Essai ${role}`],
      )
      await client.query(
        `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
         values ($1, $2, $3, $4)`,
        [DEMO_ORG, id, DEMO_RESTO, role],
      )
    }
    await poser(gerant, 'gerant')
    await poser(caissier, 'caissier')

    try {
      const destinataires = await depot.emailsGestionnaires(DEMO_RESTO)
      expect(destinataires).toContain(`${gerant}@alertes.essai`)
      // Le point qui compte : un caissier ne commande pas les
      // réapprovisionnements, et une alerte qui ne s'adresse à personne se
      // range dans les indésirables.
      expect(destinataires).not.toContain(`${caissier}@alertes.essai`)
      // Aucune adresse vide : les employés du jeu de démonstration n'en ont
      // pas, et « envoyer à rien » ferait échouer tout l'envoi.
      expect(destinataires.every((e) => e.trim() !== '')).toBe(true)

      // Un gérant SUSPENDU ne reçoit plus rien : son adresse a pu être
      // rendue, et le stock ne le regarde plus.
      await client.query(`update kaissi.users set status = 'suspendu' where id = $1`, [gerant])
      expect(await depot.emailsGestionnaires(DEMO_RESTO)).not.toContain(
        `${gerant}@alertes.essai`,
      )

      // Une appartenance RÉVOQUÉE non plus — l'employé est parti.
      await client.query(`update kaissi.users set status = 'actif' where id = $1`, [gerant])
      await client.query(
        `update kaissi.memberships set revoked_at = now() where user_id = $1`,
        [gerant],
      )
      expect(await depot.emailsGestionnaires(DEMO_RESTO)).not.toContain(
        `${gerant}@alertes.essai`,
      )
    } finally {
      await client.query('delete from kaissi.memberships where user_id = any($1::uuid[])', [
        [gerant, caissier],
      ])
      await client.query('delete from kaissi.users where id = any($1::uuid[])', [
        [gerant, caissier],
      ])
    }
  })
})

describe('le message', () => {
  it('nomme le produit quand il est seul', () => {
    const { titre, corps } = messageAlerte([
      {
        restaurantId: DEMO_RESTO,
        organizationId: DEMO_ORG,
        productId: produit,
        nom: 'Ojja merguez',
        niveau: 'rupture',
        qty: 0,
        seuil: 2,
      },
    ])
    expect(titre).toBe('Rupture — Ojja merguez')
    expect(corps).toContain('il n’en reste plus')
  })

  it('dit qu’une réception manque quand la quantité est NÉGATIVE', () => {
    // Une quantité négative ne se borne pas à zéro : c'est le seul signal qui
    // dise « il manque une réception, ou le comptage est faux ».
    const { corps } = messageAlerte([
      {
        restaurantId: DEMO_RESTO,
        organizationId: DEMO_ORG,
        productId: produit,
        nom: 'Ojja merguez',
        niveau: 'rupture',
        qty: -3,
        seuil: null,
      },
    ])
    expect(corps).toContain('-3')
    expect(corps).toContain('réception')
  })

  it('résume quand il y en a plusieurs, plutôt que de vibrer dix fois', () => {
    const { titre, corps } = messageAlerte(
      ['Ojja', 'Brik', 'Lablabi'].map((nom) => ({
        restaurantId: DEMO_RESTO,
        organizationId: DEMO_ORG,
        productId: produit,
        nom,
        niveau: 'rupture' as const,
        qty: 0,
        seuil: null,
      })),
    )
    expect(titre).toBe('3 ruptures de stock')
    expect(corps.split('\n')).toHaveLength(3)
  })
})
