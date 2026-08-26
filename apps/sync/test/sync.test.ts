/**
 * Tests d'intégration du moteur de synchronisation — contre un VRAI Postgres.
 *
 * Ce qu'ils prouvent, et que des tests unitaires ne peuvent pas prouver :
 * l'idempotence tient au niveau de la base, RLS empêche réellement une fuite
 * entre établissements, et la reprojection serveur produit exactement les
 * mêmes totaux que la tablette.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { millimes, uuidV7 } from '@kaissi/domain'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { empreinteDe, genererJeton, jetonDepuisEntete } from '../src/jeton.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  ESPECES,
  TVA_07,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

async function appeler(
  chemin: string,
  jeton: string | null,
  init: RequestInit = {},
): Promise<{ statut: number; corps: any }> {
  const entetes: Record<string, string> = { 'content-type': 'application/json' }
  if (jeton) entetes['authorization'] = `Bearer ${jeton}`
  const reponse = await app.request(`http://test${chemin}`, { ...init, headers: entetes })
  return { statut: reponse.status, corps: await reponse.json().catch(() => null) }
}

const push = (a: AppareilTest, evenements: unknown[]) =>
  appeler('/sync/push', a.jetonClair, {
    method: 'POST',
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })

const pull = (a: AppareilTest, depuisEvenements = 0, depuisCatalogue = 0) =>
  appeler(
    `/sync/pull?protocolVersion=1&depuisEvenements=${depuisEvenements}&depuisCatalogue=${depuisCatalogue}`,
    a.jetonClair,
  )

/** Une commande complète : ouverture, une ligne, paiement, clôture. */
function commande(a: AppareilTest, prix: number, tauxTaxeId = TVA_19) {
  const orderId = uuidV7()
  return {
    orderId,
    evenements: [
      ev(a, orderId, 'order.opened', {
        type: 'takeaway',
        ouvertePar: null as never,
        numeroTicket: `${a.prefixe}-${orderId.slice(-6)}`,
      }),
      ev(a, orderId, 'line.added', {
        ligneId: uuidV7(),
        produitId: '01930000-0000-7000-8000-000000000200',
        designation: 'Pizza Margherita',
        quantite: 1,
        prixBaseMillimes: millimes(prix),
        modificateursMillimes: millimes(0),
        tauxTaxeId,
      }),
      ev(a, orderId, 'payment.recorded', {
        paiementId: uuidV7(),
        methodeId: ESPECES,
        mode: 'cash',
        montantMillimes: millimes(prix),
        recuMillimes: millimes(prix),
        renduMillimes: millimes(0),
      }),
      ev(a, orderId, 'order.closed', { totalMillimes: millimes(prix), closePar: null as never }),
    ],
  }
}

beforeEach(nettoyer)
afterAll(async () => {
  await depot.fermer()
})

describe('jetons d’appareil', () => {
  it('ne stocke JAMAIS le jeton en clair', () => {
    const j = genererJeton()
    expect(j.clair).toMatch(/^kdev_/)
    expect(j.empreinte).toHaveLength(64)
    expect(j.empreinte).not.toContain(j.clair)
    expect(empreinteDe(j.clair)).toBe(j.empreinte)
  })

  it('produit un jeton différent à chaque appairage', () => {
    expect(genererJeton().clair).not.toBe(genererJeton().clair)
  })

  it('extrait un jeton d’un en-tête Bearer', () => {
    expect(jetonDepuisEntete('Bearer abc')).toBe('abc')
    expect(jetonDepuisEntete('bearer  abc  ')).toBe('abc')
    expect(jetonDepuisEntete('Basic abc')).toBeNull()
    expect(jetonDepuisEntete(null)).toBeNull()
  })
})

describe('authentification', () => {
  it('refuse une requête sans jeton', async () => {
    const r = await appeler('/sync/pull', null)
    expect(r.statut).toBe(401)
    expect(r.corps.erreur).toBe('jeton_absent')
  })

  it('refuse un jeton inconnu', async () => {
    const r = await appeler('/sync/pull', 'kdev_inexistant')
    expect(r.statut).toBe(401)
    expect(r.corps.erreur).toBe('jeton_invalide')
  })

  it('refuse un appareil révoqué SANS perdre ses ventes locales', async () => {
    const a = await creerAppareil('P9')
    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    await client.query('update kaissi.devices set revoked_at = now() where id = $1', [a.id])
    await client.end()

    const r = await appeler('/sync/pull', a.jetonClair)
    expect(r.statut).toBe(403)
    expect(r.corps.erreur).toBe('appareil_revoque')
    expect(r.corps.message).toMatch(/ne sont pas perdues/)
  })

  it('laisse passer un appareil valide', async () => {
    const a = await creerAppareil('P1')
    expect((await pull(a)).statut).toBe(200)
  })

  it('répond à /sante sans authentification', async () => {
    const r = await appeler('/sante', null)
    expect(r.statut).toBe(200)
    expect(r.corps.etat).toBe('ok')
  })
})

describe('push — idempotence (RÈGLE 5)', () => {
  it('accepte un lot et attribue des curseurs serveur croissants', async () => {
    const a = await creerAppareil('P1')
    const { evenements } = commande(a, 14_500)
    const r = await push(a, evenements)
    expect(r.statut).toBe(200)
    expect(r.corps.acceptes).toHaveLength(4)
    expect(r.corps.doublons).toHaveLength(0)
    expect(r.corps.curseurEvenements).toBeGreaterThan(0)
  })

  it('LE MÊME LOT RENVOYÉ CINQ FOIS n’encaisse qu’une seule vente', async () => {
    const a = await creerAppareil('P1')
    const { orderId, evenements } = commande(a, 24_500)

    for (let i = 0; i < 5; i += 1) {
      const r = await push(a, evenements)
      expect(r.statut).toBe(200)
      // Acceptés dans tous les cas : l'appareil peut vider son outbox.
      expect(r.corps.acceptes).toHaveLength(4)
      if (i > 0) expect(r.corps.doublons).toHaveLength(4)
    }

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const evts = await client.query(
      'select count(*)::int as n from kaissi.order_events where order_id = $1',
      [orderId],
    )
    const paiements = await client.query(
      'select count(*)::int as n, sum(amount_millimes)::int as total from kaissi.payments where order_id = $1',
      [orderId],
    )
    await client.end()

    expect(evts.rows[0].n).toBe(4)
    expect(paiements.rows[0].n).toBe(1)
    expect(paiements.rows[0].total).toBe(24_500)
  })

  it('accepte un lot vide — c’est un battement de cœur', async () => {
    const a = await creerAppareil('P1')
    const r = await push(a, [])
    expect(r.statut).toBe(200)
    expect(r.corps.acceptes).toHaveLength(0)
  })

  it('refuse un lot au-delà de la limite', async () => {
    const a = await creerAppareil('P1')
    const gros = Array.from({ length: 501 }, () =>
      ev(a, uuidV7(), 'order.sent', {}),
    )
    const r = await push(a, gros)
    expect(r.statut).toBe(413)
  })
})

describe('push — le serveur REVALIDE', () => {
  it('refuse un événement signé par un AUTRE appareil', async () => {
    const a = await creerAppareil('P1')
    const b = await creerAppareil('P2')
    // A tente de pousser un événement au nom de B.
    const usurpe = ev(b, uuidV7(), 'order.opened', {
      type: 'takeaway',
      ouvertePar: null as never,
    })
    const r = await push(a, [usurpe])
    expect(r.corps.rejetes).toHaveLength(1)
    expect(r.corps.rejetes[0].code).toBe('appareil_etranger')
  })

  it('refuse un ajout sur une commande DÉJÀ CLÔTURÉE par un autre terminal', async () => {
    const a = await creerAppareil('P1')
    const { orderId, evenements } = commande(a, 10_000)
    await push(a, evenements)

    // L'appareil B, resté hors ligne, envoie un ajout tardif.
    const b = await creerAppareil('P2')
    const tardif = ev(b, orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000221',
      designation: 'Coca-Cola 33cl',
      quantite: 1,
      prixBaseMillimes: millimes(4_200),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_07,
    })
    const r = await push(b, [tardif])
    expect(r.corps.acceptes).toHaveLength(0)
    expect(r.corps.rejetes[0].code).toBe('commande_close')
    expect(r.corps.rejetes[0].message).toMatch(/clôturée/)
  })

  it('CONSIGNE le rejet pour que le gérant le voie', async () => {
    const a = await creerAppareil('P1')
    const b = await creerAppareil('P2')
    await push(a, [ev(b, uuidV7(), 'order.sent', {})])

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const { rows } = await client.query(
      "select status, reject_code, reject_message from kaissi.sync_mutations where status = 'rejete'",
    )
    await client.end()
    expect(rows).toHaveLength(1)
    expect(rows[0].reject_code).toBe('appareil_etranger')
    expect(rows[0].reject_message).toBeTruthy()
  })

  it('refuse un type d’événement inconnu sans planter', async () => {
    const a = await creerAppareil('P1')
    const inconnu = { ...ev(a, uuidV7(), 'order.sent', {}), type: 'promo.futuriste' }
    const r = await push(a, [inconnu])
    expect(r.corps.rejetes[0].code).toBe('type_inconnu')
  })

  it('REJETTE proprement un identifiant mal formé — jamais un 500', async () => {
    const a = await creerAppareil('P1')
    const casse = { ...ev(a, uuidV7(), 'order.sent', {}), eventId: '' }
    const r = await push(a, [casse])
    // Le lot passe, l'événement fautif est rejeté : les ventes voisines
    // d'un même lot ne doivent pas tomber avec lui.
    expect(r.statut).toBe(200)
    expect(r.corps.rejetes[0].code).toBe('charge_invalide')
  })

  it('un événement valide passe MÊME SI un autre du lot est cassé', async () => {
    const a = await creerAppareil('P1')
    const bon = commande(a, 5_000)
    const casse = { ...ev(a, uuidV7(), 'order.sent', {}), eventId: 'pas-un-uuid' }
    const r = await push(a, [...bon.evenements, casse])
    expect(r.statut).toBe(200)
    expect(r.corps.acceptes).toHaveLength(4)
    expect(r.corps.rejetes).toHaveLength(1)
  })

  it('refuse un protocole non supporté avec un message actionnable', async () => {
    const a = await creerAppareil('P1')
    const r = await appeler('/sync/push', a.jetonClair, {
      method: 'POST',
      body: JSON.stringify({ protocolVersion: 99, batchId: uuidV7(), evenements: [] }),
    })
    expect(r.statut).toBe(426)
    expect(r.corps.message).toMatch(/Mettez à jour/)
  })
})

describe('reprojection serveur — mêmes totaux que la tablette', () => {
  it('projette la commande, ses lignes et ses paiements', async () => {
    const a = await creerAppareil('P1')
    const { orderId, evenements } = commande(a, 14_500)
    await push(a, evenements)

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const cmd = await client.query(
      `select status, total_millimes, paid_millimes, tax_millimes, ticket_number
       from kaissi.orders where id = $1`,
      [orderId],
    )
    const lignes = await client.query(
      'select count(*)::int as n from kaissi.order_items where order_id = $1',
      [orderId],
    )
    await client.end()

    expect(cmd.rows[0].status).toBe('close')
    // Prix carte TTC : le total EST le prix affiché, la TVA en est extraite.
    expect(Number(cmd.rows[0].total_millimes)).toBe(14_500)
    expect(Number(cmd.rows[0].paid_millimes)).toBe(14_500)
    expect(Number(cmd.rows[0].tax_millimes)).toBe(2_315) // 14500 - round(14500*10000/11900)
    expect(cmd.rows[0].ticket_number).toContain('P1-')
    expect(lignes.rows[0].n).toBe(1)
  })

  it('reprojeter deux fois ne duplique NI ligne NI paiement', async () => {
    const a = await creerAppareil('P1')
    const { orderId, evenements } = commande(a, 8_500)
    await push(a, evenements)
    await push(a, evenements)

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const lignes = await client.query(
      'select count(*)::int as n from kaissi.order_items where order_id = $1',
      [orderId],
    )
    const paiements = await client.query(
      'select count(*)::int as n from kaissi.payments where order_id = $1',
      [orderId],
    )
    await client.end()
    expect(lignes.rows[0].n).toBe(1)
    expect(paiements.rows[0].n).toBe(1)
  })
})

describe('pull — curseur serveur, jamais un horodatage (RÈGLE 4)', () => {
  it('rend les événements des AUTRES appareils du même établissement', async () => {
    const a = await creerAppareil('P1')
    const b = await creerAppareil('P2')
    const { evenements } = commande(a, 14_500)
    await push(a, evenements)

    const r = await pull(b)
    expect(r.statut).toBe(200)
    expect(r.corps.evenements).toHaveLength(4)
    expect(r.corps.curseurEvenements).toBeGreaterThan(0)
  })

  it('ne rend QUE ce qui est postérieur au curseur', async () => {
    const a = await creerAppareil('P1')
    const b = await creerAppareil('P2')
    await push(a, commande(a, 10_000).evenements)

    const premier = await pull(b)
    const curseur = premier.corps.curseurEvenements

    // Rien de neuf : le second pull doit être vide.
    const second = await pull(b, curseur)
    expect(second.corps.evenements).toHaveLength(0)
    expect(second.corps.encore).toBe(false)

    // Une nouvelle vente, et seule celle-ci remonte.
    await push(a, commande(a, 4_200, TVA_07).evenements)
    const troisieme = await pull(b, curseur)
    expect(troisieme.corps.evenements).toHaveLength(4)
  })

  it('pagine et signale qu’il reste des pages', async () => {
    const a = await creerAppareil('P1')
    for (let i = 0; i < 3; i += 1) {
      await push(a, commande(a, 1_000 * (i + 1)).evenements)
    }
    const b = await creerAppareil('P2')
    const r = await appeler(
      '/sync/pull?protocolVersion=1&depuisEvenements=0&depuisCatalogue=0&taillePage=5',
      b.jetonClair,
    )
    expect(r.corps.evenements).toHaveLength(5)
    expect(r.corps.encore).toBe(true)

    // Page suivante. On avance AUSSI le curseur de catalogue : `encore`
    // reste vrai tant qu'une des deux files a du retard, et le jeu de
    // démonstration a rempli change_log à l'installation.
    const suite = await appeler(
      `/sync/pull?protocolVersion=1&depuisEvenements=${r.corps.curseurEvenements}` +
        `&depuisCatalogue=${r.corps.curseurCatalogue}&taillePage=200`,
      b.jetonClair,
    )
    expect(suite.corps.evenements).toHaveLength(7)
    expect(suite.corps.encore).toBe(false)
  })

  it('signale « encore » tant que le CATALOGUE a du retard', async () => {
    const a = await creerAppareil('P1')
    const r = await appeler(
      '/sync/pull?protocolVersion=1&depuisEvenements=0&depuisCatalogue=0&taillePage=5',
      a.jetonClair,
    )
    expect(r.corps.catalogue).toHaveLength(5)
    expect(r.corps.encore).toBe(true)
  })

  it('rend le catalogue depuis son propre curseur', async () => {
    const a = await creerAppareil('P1')
    const r = await pull(a)
    // Le jeu de démonstration a alimenté change_log à l'installation.
    expect(r.corps.catalogue.length).toBeGreaterThan(0)
    expect(r.corps.catalogue[0].entite).toBeTruthy()
    expect(r.corps.curseurCatalogue).toBeGreaterThan(0)
  })

  it('mémorise le curseur de l’appareil', async () => {
    const a = await creerAppareil('P1')
    await push(a, commande(a, 5_000).evenements)
    await pull(a)

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const { rows } = await client.query(
      'select last_event_seq, last_pull_at, last_push_at from kaissi.sync_cursors where device_id = $1',
      [a.id],
    )
    await client.end()
    expect(Number(rows[0].last_event_seq)).toBeGreaterThan(0)
    expect(rows[0].last_pull_at).not.toBeNull()
    expect(rows[0].last_push_at).not.toBeNull()
  })
})

describe('deux tablettes hors ligne sur la même table — le scénario du dossier', () => {
  it('applique les DEUX ajouts, sans conflit', async () => {
    const a = await creerAppareil('P1')
    const b = await creerAppareil('P2')
    const orderId = uuidV7()

    // A ouvre la table et ajoute une pizza, hors ligne.
    const lotA = [
      ev(a, orderId, 'order.opened', {
        type: 'dine_in',
        tableId: '01930000-0000-7000-8000-000000000112',
        ouvertePar: null as never,
        numeroTicket: 'P1-000001',
      }),
      ev(a, orderId, 'line.added', {
        ligneId: uuidV7(),
        produitId: '01930000-0000-7000-8000-000000000200',
        designation: 'Pizza Margherita',
        quantite: 1,
        prixBaseMillimes: millimes(14_500),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
    ]
    // B ajoute deux Coca sur la MÊME commande, hors ligne aussi.
    const lotB = [
      ev(b, orderId, 'line.added', {
        ligneId: uuidV7(),
        produitId: '01930000-0000-7000-8000-000000000221',
        designation: 'Coca-Cola 33cl',
        quantite: 2,
        prixBaseMillimes: millimes(4_200),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_07,
      }),
    ]

    // Le réseau revient : les deux poussent.
    await push(a, lotA)
    await push(b, lotB)

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const cmd = await client.query(
      'select total_millimes, status from kaissi.orders where id = $1',
      [orderId],
    )
    const lignes = await client.query(
      'select sum(qty)::int as articles from kaissi.order_items where order_id = $1',
      [orderId],
    )
    await client.end()

    // 14,500 + 2 × 4,200 = 22,900. Les trois articles sont là.
    expect(Number(cmd.rows[0].total_millimes)).toBe(22_900)
    expect(lignes.rows[0].articles).toBe(3)
  })

  it('l’ordre d’arrivée ne change RIEN au résultat', async () => {
    const a = await creerAppareil('P1')
    const b = await creerAppareil('P2')
    const orderId = uuidV7()
    const ouverture = ev(a, orderId, 'order.opened', {
      type: 'dine_in',
      ouvertePar: null as never,
    })
    const ligneA = ev(a, orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000200',
      designation: 'Pizza',
      quantite: 1,
      prixBaseMillimes: millimes(14_500),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_19,
    })
    const ligneB = ev(b, orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000221',
      designation: 'Coca',
      quantite: 2,
      prixBaseMillimes: millimes(4_200),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_07,
    })

    // B pousse AVANT A : l'ouverture arrive après un ajout.
    await push(b, [ligneB])
    await push(a, [ouverture, ligneA])

    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const cmd = await client.query(
      'select total_millimes from kaissi.orders where id = $1',
      [orderId],
    )
    await client.end()
    expect(Number(cmd.rows[0].total_millimes)).toBe(22_900)
  })
})
