/**
 * BANC D'ESSAI À TROIS APPAREILS — le jalon de décision de la Phase 2.
 *
 * Le dossier d'architecture fixe la règle à l'avance, pour éviter de
 * s'entêter plus tard :
 *
 *   « Si, à la fin de la Phase 2, la synchronisation n'est pas fiable en
 *     test avec TROIS APPAREILS et des coupures réseau simulées, on bascule
 *     sur PowerSync sans débat. »
 *
 * Ce fichier EST ce test. Trois terminaux encaissent en parallèle contre un
 * vrai PostgreSQL, avec des coupures franches au pire moment. Ce qu'on
 * vérifie n'est pas « ça marche à peu près » mais trois propriétés dures :
 *
 *   1. AUCUNE VENTE PERDUE      — chaque encaissement local se retrouve en base
 *   2. AUCUNE VENTE DUPLIQUÉE   — même après coupure en plein push
 *   3. TOTAUX IDENTIQUES        — au millime près, tablettes ↔ serveur
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  calculerTotaux,
  millimes,
  reduireEvenements,
  uuidV7,
  type ConfigCalcul,
  type EvenementCommande,
  type PointsDeBase,
} from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  ESPECES,
  TVA_07,
  TVA_19,
  URL_TEST,
  type AppareilTest,
  EMPLOYE_DEMO,
} from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

/**
 * Terminal simulé : garde son journal local et son outbox, exactement
 * comme le POS. `enLigne` coupe le réseau — les ventes continuent.
 */
class Terminal {
  readonly journal: EvenementCommande[] = []
  outbox: EvenementCommande[] = []
  enLigne = true
  /** Coupe le réseau APRÈS que le serveur ait traité, avant l'accusé. */
  couperApresTraitement = false
  curseurEvenements = 0
  curseurCatalogue = 0
  ventesLocales = 0

  constructor(readonly appareil: AppareilTest) {}

  private seq = 0

  emettre<T extends Parameters<typeof ev>[2]>(
    orderId: string,
    type: T,
    payload: Parameters<typeof ev>[3],
  ): EvenementCommande {
    this.seq += 1
    const evenement = ev(this.appareil, orderId, type, payload as never, this.seq)
    this.journal.push(evenement)
    this.outbox.push(evenement)
    return evenement
  }

  /** Une vente complète, encaissée en espèces. */
  encaisser(prix: number, tauxTaxeId = TVA_19): string {
    const orderId = uuidV7()
    this.emettre(orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${this.appareil.prefixe}-${String(this.ventesLocales + 1).padStart(6, '0')}`,
    })
    this.emettre(orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000200',
      designation: 'Pizza Margherita',
      quantite: 1,
      prixBaseMillimes: millimes(prix),
      modificateursMillimes: millimes(0),
      tauxTaxeId,
    })
    this.emettre(orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(prix),
      recuMillimes: millimes(prix),
      renduMillimes: millimes(0),
    })
    this.emettre(orderId, 'order.closed', { totalMillimes: millimes(prix), closePar: EMPLOYE_DEMO })
    this.ventesLocales += 1
    return orderId
  }

  /** Un cycle de synchronisation. Ne fait rien si le réseau est coupé. */
  async synchroniser(): Promise<void> {
    if (!this.enLigne) throw new Error('réseau coupé')
    if (this.outbox.length > 0) {
      const lot = [...this.outbox]
      const reponse = await this.appelPush(lot)

      // ⚑ Le point le plus délicat du protocole : la coupure survient APRÈS
      // que le serveur a écrit, mais AVANT que l'appareil ne reçoive
      // l'accusé. L'outbox n'est donc PAS vidée, et le même lot repartira.
      if (this.couperApresTraitement) {
        this.couperApresTraitement = false
        this.enLigne = false
        throw new Error('coupure après traitement serveur')
      }

      const acceptes = new Set(reponse.acceptes)
      this.outbox = this.outbox.filter((e) => !acceptes.has(e.eventId))
      this.curseurEvenements = reponse.curseurEvenements
    }

    for (let page = 0; page < 20; page += 1) {
      const reponse = await this.appelPull()
      for (const e of reponse.evenements) {
        if (!this.journal.some((j) => j.eventId === e.eventId)) this.journal.push(e)
      }
      this.curseurEvenements = reponse.curseurEvenements
      this.curseurCatalogue = reponse.curseurCatalogue
      if (!reponse.encore) break
    }
  }

  private async appelPush(evenements: readonly EvenementCommande[]) {
    const reponse = await app.request('http://test/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.appareil.jetonClair}`,
      },
      body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
    })
    if (!reponse.ok) throw new Error(`push ${reponse.status}`)
    return (await reponse.json()) as {
      acceptes: string[]
      doublons: string[]
      rejetes: { eventId: string; code: string }[]
      curseurEvenements: number
    }
  }

  private async appelPull() {
    const p = new URLSearchParams({
      protocolVersion: '1',
      depuisCatalogue: String(this.curseurCatalogue),
      depuisEvenements: String(this.curseurEvenements),
      taillePage: '200',
    })
    const reponse = await app.request(`http://test/sync/pull?${p}`, {
      headers: { authorization: `Bearer ${this.appareil.jetonClair}` },
    })
    if (!reponse.ok) throw new Error(`pull ${reponse.status}`)
    return (await reponse.json()) as {
      evenements: EvenementCommande[]
      curseurEvenements: number
      curseurCatalogue: number
      encore: boolean
    }
  }
}

/** Tente une synchronisation en avalant les échecs réseau, comme le vrai moteur. */
async function synchroniserSiPossible(t: Terminal): Promise<void> {
  try {
    await t.synchroniser()
  } catch {
    // Une coupure n'est pas une erreur : l'outbox garde tout.
  }
}

async function config(): Promise<ConfigCalcul> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  const { rows } = await client.query(
    'select id, name, rate_bp, is_included from kaissi.tax_rates where restaurant_id is not null',
  )
  await client.end()
  return {
    tauxTaxes: Object.fromEntries(
      rows.map((r) => [
        r.id,
        { id: r.id, nom: r.name, tauxBp: r.rate_bp as PointsDeBase, incluse: r.is_included },
      ]),
    ),
  }
}

interface EtatServeur {
  commandes: number
  evenements: number
  chiffreAffaires: number
  paiements: number
}

/** Plus grand `server_seq` attribué — la tête de file du restaurant. */
async function teteEvenements(): Promise<number> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  const { rows } = await client.query('select coalesce(max(server_seq),0)::int as tete from kaissi.order_events')
  await client.end()
  return rows[0].tete
}

async function etatServeur(): Promise<EtatServeur> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  const { rows } = await client.query(`
    select
      (select count(*) from kaissi.orders where status = 'close')::int as commandes,
      (select count(*) from kaissi.order_events)::int as evenements,
      (select coalesce(sum(total_millimes),0) from kaissi.orders where status='close')::int as ca,
      (select count(*) from kaissi.payments)::int as paiements
  `)
  await client.end()
  return {
    commandes: rows[0].commandes,
    evenements: rows[0].evenements,
    chiffreAffaires: rows[0].ca,
    paiements: rows[0].paiements,
  }
}

beforeEach(nettoyer)
afterAll(async () => {
  await depot.fermer()
})

describe('BANC TROIS APPAREILS — jalon de décision Phase 2', () => {
  it('service normal : trois terminaux en ligne, rien ne se perd', async () => {
    const t = [
      new Terminal(await creerAppareil('P1')),
      new Terminal(await creerAppareil('P2')),
      new Terminal(await creerAppareil('P3')),
    ]
    const prix = [14_500, 8_500, 4_200]
    let attendu = 0

    for (let tour = 0; tour < 5; tour += 1) {
      for (const [i, terminal] of t.entries()) {
        terminal.encaisser(prix[i]!)
        attendu += prix[i]!
      }
      for (const terminal of t) await synchroniserSiPossible(terminal)
    }

    const etat = await etatServeur()
    expect(etat.commandes).toBe(15)
    expect(etat.chiffreAffaires).toBe(attendu)
    expect(etat.paiements).toBe(15)
  })

  it('COUPURE FRANCHE : trois terminaux encaissent hors ligne, puis se reconnectent EN MÊME TEMPS', async () => {
    const t = [
      new Terminal(await creerAppareil('P1')),
      new Terminal(await creerAppareil('P2')),
      new Terminal(await creerAppareil('P3')),
    ]

    // Le réseau tombe pour tout l'établissement.
    for (const terminal of t) terminal.enLigne = false

    let attendu = 0
    for (let tour = 0; tour < 8; tour += 1) {
      for (const terminal of t) {
        const prix = 1_000 + tour * 500
        terminal.encaisser(prix)
        attendu += prix
        // La caisse continue : les tentatives échouent, sans conséquence.
        await synchroniserSiPossible(terminal)
      }
    }
    expect((await etatServeur()).commandes).toBe(0)

    // Le réseau revient. Les trois poussent en même temps.
    for (const terminal of t) terminal.enLigne = true
    await Promise.all(t.map(synchroniserSiPossible))

    const etat = await etatServeur()
    expect(etat.commandes).toBe(24)
    expect(etat.chiffreAffaires).toBe(attendu)
    // Les outbox sont vides : tout a été accusé.
    for (const terminal of t) expect(terminal.outbox).toHaveLength(0)
  })

  it('COUPURE PENDANT LE PUSH : le serveur a écrit, l’appareil n’a pas reçu l’accusé', async () => {
    const t1 = new Terminal(await creerAppareil('P1'))
    t1.encaisser(24_500)

    // Le pire cas : le serveur enregistre, la réponse se perd.
    t1.couperApresTraitement = true
    await synchroniserSiPossible(t1)

    // Vu de l'appareil, rien n'est parti : l'outbox est intacte.
    expect(t1.outbox).toHaveLength(4)
    // Vu du serveur, la vente EST enregistrée.
    expect((await etatServeur()).commandes).toBe(1)

    // Le réseau revient : le même lot repart intégralement.
    t1.enLigne = true
    await synchroniserSiPossible(t1)

    const etat = await etatServeur()
    // ⚑ LA propriété qui compte : une seule vente, un seul paiement.
    expect(etat.commandes).toBe(1)
    expect(etat.paiements).toBe(1)
    expect(etat.chiffreAffaires).toBe(24_500)
    expect(etat.evenements).toBe(4)
    expect(t1.outbox).toHaveLength(0)
  })

  it('COUPURES ALÉATOIRES pendant tout un service — aucune perte, aucun doublon', async () => {
    const t = [
      new Terminal(await creerAppareil('P1')),
      new Terminal(await creerAppareil('P2')),
      new Terminal(await creerAppareil('P3')),
    ]

    // Générateur pseudo-aléatoire à graine FIXE : un échec doit être
    // rejouable à l'identique, sinon on ne peut pas le corriger.
    let graine = 20260825
    const alea = () => {
      graine = (graine * 1103515245 + 12345) % 2147483648
      return graine / 2147483648
    }

    let attendu = 0
    let ventes = 0

    for (let tour = 0; tour < 40; tour += 1) {
      const terminal = t[Math.floor(alea() * 3)]!

      // Le réseau vacille : coupures et retours au hasard.
      if (alea() < 0.3) terminal.enLigne = !terminal.enLigne
      if (alea() < 0.15) terminal.couperApresTraitement = true

      const prix = 1_000 + Math.floor(alea() * 20) * 500
      terminal.encaisser(prix)
      attendu += prix
      ventes += 1

      await synchroniserSiPossible(terminal)
    }

    // Fin de service : le réseau est rétabli et STABLE. On lève aussi les
    // coupures programmées, sinon on mesurerait la reprise d'un réseau qui
    // retombe, pas la convergence.
    for (let passe = 0; passe < 3; passe += 1) {
      for (const terminal of t) {
        terminal.enLigne = true
        terminal.couperApresTraitement = false
        await synchroniserSiPossible(terminal)
      }
    }

    const etat = await etatServeur()
    expect(etat.commandes).toBe(ventes)
    expect(etat.chiffreAffaires).toBe(attendu)
    expect(etat.paiements).toBe(ventes)
    expect(etat.evenements).toBe(ventes * 4)
    for (const terminal of t) expect(terminal.outbox).toHaveLength(0)
  })

  it('TOTAUX IDENTIQUES au millime près entre la tablette et le serveur', async () => {
    const t1 = new Terminal(await creerAppareil('P1'))
    const t2 = new Terminal(await creerAppareil('P2'))
    const cfg = await config()

    // Une commande partagée, à deux taux de TVA, avec remise globale —
    // le cas où un écart de calcul se verrait.
    const orderId = uuidV7()
    t1.emettre(orderId, 'order.opened', {
      type: 'dine_in',
      tableId: '01930000-0000-7000-8000-000000000112',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: 'P1-000001',
    })
    t1.emettre(orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000200',
      designation: 'Pizza Margherita',
      quantite: 3,
      prixBaseMillimes: millimes(14_500),
      modificateursMillimes: millimes(1_500),
      tauxTaxeId: TVA_19,
    })
    t2.emettre(orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: '01930000-0000-7000-8000-000000000221',
      designation: 'Coca-Cola 33cl',
      quantite: 7,
      prixBaseMillimes: millimes(4_200),
      modificateursMillimes: millimes(0),
      tauxTaxeId: TVA_07,
    })
    t1.emettre(orderId, 'discount.applied', {
      ligneId: null,
      remise: { type: 'pourcentage', valeurBp: 1_300 as PointsDeBase },
    })

    await synchroniserSiPossible(t1)
    await synchroniserSiPossible(t2)
    await synchroniserSiPossible(t1)

    // Total calculé sur la TABLETTE, depuis son journal local.
    const etatLocal = reduireEvenements(t1.journal)
    const totauxLocaux = calculerTotaux({
      lignes: etatLocal.lignes,
      remiseGlobale: etatLocal.remiseGlobale ?? undefined,
      config: cfg,
    })

    // Total tel que le SERVEUR l'a projeté.
    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    const { rows } = await client.query(
      'select total_millimes, tax_millimes, discount_millimes from kaissi.orders where id = $1',
      [orderId],
    )
    await client.end()

    expect(Number(rows[0].total_millimes)).toBe(totauxLocaux.totalMillimes)
    expect(Number(rows[0].tax_millimes)).toBe(totauxLocaux.taxeMillimes)
    expect(Number(rows[0].discount_millimes)).toBe(totauxLocaux.totalRemisesMillimes)
  })

  it('un terminal resté LONGTEMPS hors ligne rattrape par pages', async () => {
    const actif = new Terminal(await creerAppareil('P1'))
    const retardataire = new Terminal(await creerAppareil('P2'))
    retardataire.enLigne = false

    // 60 ventes pendant que le second terminal dort : 240 événements.
    for (let i = 0; i < 60; i += 1) {
      actif.encaisser(1_000 + i * 100)
    }
    await synchroniserSiPossible(actif)

    retardataire.enLigne = true
    await synchroniserSiPossible(retardataire)

    // Il a tout rattrapé, sans intervention.
    expect(retardataire.journal).toHaveLength(240)
    // Le curseur est un `server_seq`, pas un compteur : on le compare à la
    // tête de file, jamais au nombre de lignes.
    expect(retardataire.curseurEvenements).toBe(await teteEvenements())
  })
})
