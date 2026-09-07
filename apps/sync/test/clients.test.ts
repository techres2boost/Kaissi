/**
 * Le carnet de clients (migration 0031), de bout en bout.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 *
 * Deux choses qui, ratées, donnent un écran qui a l'air de marcher :
 *
 *   1. le carnet DESCEND jusqu'à la caisse par `change_log` — sans quoi le
 *      comptoir ne pourrait rattacher un client qu'avec du réseau, donc pas
 *      au moment où il en a besoin ;
 *   2. la projection écrit `customer_id`, et le nom AU MOMENT de la vente.
 *      Sans l'identifiant, « Total des visites » resterait à zéro pour tout
 *      le monde, sur un écran qui affiche pourtant des fiches — et personne
 *      ne saurait dire si c'est le client qui n'est jamais revenu ou le
 *      logiciel qui ne compte pas.
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

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

const PRODUIT = '01930000-0000-7000-8000-000000000200'

beforeEach(async () => {
  await nettoyer()
  await client.query('delete from kaissi.customers')
  await client.query("delete from kaissi.change_log where entity_type = 'customers'")
})

afterAll(async () => {
  await client.query('delete from kaissi.customers')
  await client.query("delete from kaissi.change_log where entity_type = 'customers'")
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

async function creerFiche(nom: string, telephone: string | null): Promise<string> {
  const id = uuidV7()
  await client.query(
    `insert into kaissi.customers (id, organization_id, restaurant_id, name, phone)
     values ($1,$2,$3,$4,$5)`,
    [id, DEMO_ORG, DEMO_RESTO, nom, telephone],
  )
  return id
}

/** Une vente de 20 dinars, encaissée, éventuellement au nom d'un client. */
async function vendre(
  appareil: AppareilTest,
  client_: { id: string; nom: string } | null,
): Promise<string> {
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
      designation: 'Ojja merguez',
      quantite: 1,
      prixBaseMillimes: millimes(20_000),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    }),
    ...(client_
      ? [
          ev(appareil, orderId, 'customer.attached', {
            clientId: client_.id as never,
            nom: client_.nom,
          }),
        ]
      : []),
    ev(appareil, orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(20_000),
      recuMillimes: millimes(20_000),
      renduMillimes: millimes(0),
    }),
    ev(appareil, orderId, 'order.closed', {
      totalMillimes: millimes(20_000),
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
  return orderId
}

describe('le carnet descend par le catalogue', () => {
  it('journalise une fiche créée au back-office', async () => {
    const depuis = await curseur()
    const id = await creerFiche('Salem Haddad', '20123456')

    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    const entree = page.find((c) => c.entite === 'customers')
    expect(entree?.entiteId).toBe(id)
    expect(entree?.operation).toBe('insert')
    expect(entree?.donnees).toMatchObject({ name: 'Salem Haddad', phone: '20123456' })
  })

  it('fait descendre l’ARCHIVAGE plutôt que de supprimer la ligne', async () => {
    const id = await creerFiche('De passage', null)
    const depuis = await curseur()
    await client.query('update kaissi.customers set archived_at = now() where id = $1', [id])

    const page = await depot.catalogueDepuis(DEMO_RESTO, depuis, 100)
    const entree = page.find((c) => c.entite === 'customers')
    expect(entree?.operation).toBe('update')
    expect(entree?.donnees?.['archived_at']).not.toBeNull()
  })

  it('refuse DEUX fiches pour le même numéro', async () => {
    // Deux fiches pour la même personne partagent ses visites en deux, et
    // aucun des deux totaux n'est vrai.
    await creerFiche('Salem', '20123456')
    await expect(creerFiche('Salem H.', '20123456')).rejects.toThrow()
  })

  it('laisse le même numéro exister dans DEUX établissements', async () => {
    // Un client peut fréquenter deux restaurants du groupe : chacun tient son
    // carnet, et la contrainte est par établissement.
    const { rows } = await client.query<{ id: string }>(
      'select id from kaissi.restaurants where id <> $1 limit 1',
      [DEMO_RESTO],
    )
    if (rows.length === 0) return
    await creerFiche('Salem', '20123456')
    await expect(
      client.query(
        `insert into kaissi.customers (id, organization_id, restaurant_id, name, phone)
         values ($1,$2,$3,'Salem','20123456')`,
        [uuidV7(), DEMO_ORG, rows[0]!.id],
      ),
    ).resolves.toBeDefined()
    await client.query('delete from kaissi.customers where restaurant_id = $1', [rows[0]!.id])
  })

  it('accepte plusieurs fiches SANS téléphone', async () => {
    // Un client de passage dont on n'a que le prénom reste légitime : l'index
    // unique est partiel, sinon la deuxième fiche sans numéro serait refusée.
    await creerFiche('Monsieur au comptoir', null)
    await expect(creerFiche('Dame de la 4', null)).resolves.toBeDefined()
  })
})

describe('la vente retient à QUI elle a été faite', () => {
  it('inscrit l’identifiant et le nom sur la commande', async () => {
    const appareil = await creerAppareil('C1')
    const id = await creerFiche('Salem Haddad', '20123456')
    const orderId = await vendre(appareil, { id, nom: 'Salem Haddad' })

    const { rows } = await client.query(
      'select customer_id, customer_name from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows[0]?.['customer_id']).toBe(id)
    expect(rows[0]?.['customer_name']).toBe('Salem Haddad')
  })

  it('le nom est RECOPIÉ : corriger la fiche ne réécrit pas le reçu', async () => {
    const appareil = await creerAppareil('C2')
    const id = await creerFiche('Salem', '20123456')
    const orderId = await vendre(appareil, { id, nom: 'Salem' })

    await client.query('update kaissi.customers set name = $2 where id = $1', [
      id,
      'Salem Haddad Becha',
    ])

    const { rows } = await client.query(
      'select customer_name from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows[0]?.['customer_name']).toBe('Salem')
  })

  it('compte les visites et le total dépensé', async () => {
    const appareil = await creerAppareil('C3')
    const id = await creerFiche('Habitué', '20999999')
    await vendre(appareil, { id, nom: 'Habitué' })
    await vendre(appareil, { id, nom: 'Habitué' })
    // Une vente à personne ne doit compter pour personne.
    await vendre(appareil, null)

    const { rows } = await client.query<{
      visites: string
      depense_millimes: string
      premiere_visite: string | null
    }>('select visites, depense_millimes, premiere_visite from kaissi.clients_visites where customer_id = $1', [id])
    expect(Number(rows[0]?.visites)).toBe(2)
    // Le total est comparé à la SOMME des commandes, pas à un nombre écrit
    // ici : recopier un montant attendu, c'est tester mon arithmétique, pas
    // celle de la vue.
    const attendu = await client.query<{ somme: string }>(
      `select coalesce(sum(total_millimes), 0) as somme from kaissi.orders
       where customer_id = $1 and status = 'close'`,
      [id],
    )
    expect(Number(rows[0]?.depense_millimes)).toBe(Number(attendu.rows[0]?.somme))
    expect(Number(rows[0]?.depense_millimes)).toBeGreaterThan(0)
    expect(rows[0]?.premiere_visite).not.toBeNull()
  })

  it('un client sans commande rend ZÉRO, pas une ligne absente', async () => {
    // La vue fait une jointure EXTERNE : sans elle, un client jamais venu
    // disparaîtrait de l'écran au lieu d'y afficher « — ».
    const id = await creerFiche('Jamais venu', '20000001')
    const { rows } = await client.query<{ visites: string; derniere_visite: string | null }>(
      'select visites, derniere_visite from kaissi.clients_visites where customer_id = $1',
      [id],
    )
    expect(Number(rows[0]?.visites)).toBe(0)
    expect(rows[0]?.derniere_visite).toBeNull()
  })

  it('DÉTACHER un client remet la commande à personne', async () => {
    const appareil = await creerAppareil('C4')
    const id = await creerFiche('Erreur de saisie', '20000002')
    const orderId = uuidV7()
    const evenements = [
      ev(appareil, orderId, 'order.opened', {
        type: 'takeaway',
        ouvertePar: EMPLOYE_DEMO,
        numeroTicket: `${appareil.prefixe}-${orderId.slice(-6)}`,
      }),
      ev(appareil, orderId, 'customer.attached', {
        clientId: id as never,
        nom: 'Erreur de saisie',
      }),
      // Le contraire d'un rattachement est un rattachement à personne : il
      // n'existe pas d'événement « détaché », et il n'en faut pas.
      ev(appareil, orderId, 'customer.attached', { clientId: null }),
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

    const { rows } = await client.query(
      'select customer_id, customer_name from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows[0]?.['customer_id']).toBeNull()
    // Le nom part avec l'identifiant : sinon la commande garderait le nom
    // d'un client qu'on vient d'en retirer.
    expect(rows[0]?.['customer_name']).toBeNull()
  })

  it('archiver une fiche ne détache pas les ventes passées', async () => {
    const appareil = await creerAppareil('C5')
    const id = await creerFiche('Parti ailleurs', '20000003')
    const orderId = await vendre(appareil, { id, nom: 'Parti ailleurs' })
    await client.query('update kaissi.customers set archived_at = now() where id = $1', [id])

    const { rows } = await client.query(
      'select customer_id from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows[0]?.['customer_id']).toBe(id)
  })
})
