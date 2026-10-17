/**
 * TESTS DE CHARGE — « si demain j'ai 100 commandes par heure, est-ce que ça
 * tombe ? »
 *
 * Contre un VRAI PostgreSQL, à travers un VRAI serveur HTTP (le même code
 * que Railway exécute, sur un port local), avec le pool de connexions de
 * production (10). Trois scénarios, du plus probable au plus brutal :
 *
 *   A. UNE HEURE DE SERVICE EN ACCÉLÉRÉ — 100 clients, 100 commandes, quatre
 *      caisses, chaque geste poussé comme le fait la caisse (ouverture,
 *      articles, envoi en cuisine, encaissement), un pull après chaque push,
 *      et 10 % des lots RENVOYÉS (réseau qui hoquette). L'heure tient ici en
 *      quelques secondes : la charge réelle est donc des centaines de fois
 *      plus forte que « 100 par heure ».
 *
 *   B. LE RETOUR D'INTERNET — vingt caisses restées hors ligne pendant le
 *      coup de feu, trente ventes chacune, qui se reconnectent À LA MÊME
 *      SECONDE. C'est le vrai pic d'un restaurant : pas le flux régulier,
 *      mais la vague qui suit une coupure.
 *
 *   C. MONTÉE EN CHARGE — 1, 5, 10, 25 puis 50 caisses simultanées : on
 *      cherche où la latence décroche, pas seulement si ça passe.
 *
 * Pour chacun, les trois propriétés du banc à trois appareils, qui ne se
 * négocient pas sous la charge :
 *   1. aucune vente PERDUE      — chaque commande est projetée « close » ;
 *   2. aucune vente DUPLIQUÉE   — renvois compris ;
 *   3. totaux EXACTS            — au millime, caisse ↔ serveur (packages/domain).
 * Et une quatrième, propre à la charge : ZÉRO erreur serveur.
 *
 * ⚠ CE QUE CE TEST NE PROUVE PAS. La base est locale (aucune latence réseau,
 *   aucune voisine sur la machine), et le serveur tourne dans le processus
 *   du test. Supabase + Railway ajoutent 20 à 80 ms par aller-retour et
 *   partagent leurs ressources : les latences absolues de production seront
 *   PLUS HAUTES. Ce qui se transpose, c'est l'absence d'erreur, de perte et
 *   de doublon sous concurrence, et la FORME de la courbe de montée en charge.
 *   La vérité de production se lit dans l'écran Surveillance.
 *
 *   KAISSI_CHARGE=lourd multiplie les volumes par cinq (hors CI).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
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
import { Metriques, centile } from '../src/surveillance.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  EMPLOYE_DEMO,
  ESPECES,
  TVA_07,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const ECHELLE = process.env['KAISSI_CHARGE'] === 'lourd' ? 5 : 1

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const metriques = new Metriques()
const app = creerServeur({ depot, metriques })
let serveur: ServerType
let base = ''

/** La carte d'un snack : prix TTC en millimes, deux taux de TVA. */
const CARTE = [
  { id: '01930000-0000-7000-8000-000000000200', nom: 'Pizza Margherita', prix: 14_500, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000201', nom: 'Couscous poulet', prix: 19_000, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000202', nom: 'Ojja merguez', prix: 13_500, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000203', nom: 'Escalope panée', prix: 16_000, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000204', nom: 'Coca-Cola 33cl', prix: 2_500, taux: TVA_07 },
  { id: '01930000-0000-7000-8000-000000000205', nom: 'Eau 1,5 L', prix: 1_200, taux: TVA_07 },
]

/** Générateur pseudo-aléatoire DÉTERMINISTE : un échec se rejoue à l'identique. */
function hasard(graine: number) {
  let x = graine >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4_294_967_296
  }
}

interface Mesure {
  readonly route: 'push' | 'pull'
  readonly ms: number
  readonly statut: number
}

/** Une caisse : son journal, son outbox, ses mesures. Le protocole du POS. */
class Caisse {
  seq = 0
  ventes = 0
  readonly journal: EvenementCommande[] = []
  outbox: EvenementCommande[] = []
  curseurEvenements = 0
  curseurCatalogue = 0
  readonly mesures: Mesure[] = []
  readonly attendus = new Map<string, number>()

  constructor(
    readonly appareil: AppareilTest,
    readonly aleatoire: () => number,
  ) {}

  private emettre(orderId: string, type: string, charge: unknown): EvenementCommande {
    this.seq += 1
    /*
     * Une horloge RÉELLE et croissante, comme la caisse. Celle de `ev()`
     * reboucle toutes les soixante secondes simulées : sur une commande à
     * cheval, « quantité changée » paraissait précéder « article ajouté »,
     * la réduction locale l'ignorait, et le test signalait un écart de total
     * qui n'existait que dans le banc.
     */
    const e = {
      ...ev(this.appareil, orderId, type as never, charge as never, this.seq),
      clientTs: new Date(Date.UTC(2026, 9, 17, 12) + this.seq).toISOString(),
    }
    this.journal.push(e)
    this.outbox.push(e)
    return e
  }

  /**
   * Une commande complète, geste par geste. `pousserApresChaqueGeste` :
   * le comportement de la caisse en ligne. Hors ligne, tout reste en outbox.
   */
  async commande(config: ConfigCalcul, pousserApresChaqueGeste: boolean): Promise<string> {
    const orderId = uuidV7()
    const r = this.aleatoire
    this.ventes += 1
    this.emettre(orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${this.appareil.prefixe}-${String(this.ventes).padStart(6, '0')}`,
    })
    if (pousserApresChaqueGeste) await this.synchroniser()

    const nbLignes = 2 + Math.floor(r() * 3)
    const lignes: string[] = []
    for (let i = 0; i < nbLignes; i += 1) {
      const plat = CARTE[Math.floor(r() * CARTE.length)]!
      const ligneId = uuidV7()
      lignes.push(ligneId)
      this.emettre(orderId, 'line.added', {
        ligneId,
        produitId: plat.id,
        designation: plat.nom,
        quantite: 1 + Math.floor(r() * 2),
        prixBaseMillimes: millimes(plat.prix),
        modificateursMillimes: millimes(0),
        tauxTaxeId: plat.taux,
      })
    }
    if (r() < 0.3) {
      this.emettre(orderId, 'line.quantity_changed', { ligneId: lignes[0]!, quantite: 3 })
    }
    if (pousserApresChaqueGeste) await this.synchroniser()

    this.emettre(orderId, 'order.sent', { lignes })
    if (pousserApresChaqueGeste) await this.synchroniser()

    // Le total vient de packages/domain — la MÊME fonction que la caisse.
    const etat = reduireEvenements(this.journal.filter((e) => e.orderId === orderId))
    const total = calculerTotaux({ lignes: etat.lignes, config }).totalMillimes
    this.attendus.set(orderId, total)
    this.emettre(orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: total,
      recuMillimes: total,
      renduMillimes: millimes(0),
    })
    this.emettre(orderId, 'order.closed', { totalMillimes: total, closePar: EMPLOYE_DEMO })
    if (pousserApresChaqueGeste) await this.synchroniser()
    return orderId
  }

  private async appeler(route: 'push' | 'pull', chemin: string, init: RequestInit = {}) {
    const debut = performance.now()
    const reponse = await fetch(`${base}${chemin}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.appareil.jetonClair}`,
      },
    })
    const corps = (await reponse.json()) as any
    this.mesures.push({ route, ms: performance.now() - debut, statut: reponse.status })
    if (!reponse.ok) throw new Error(`${route} ${reponse.status} : ${corps?.message}`)
    return corps
  }

  /** Push (par lots de 100, comme la caisse) puis pull. */
  async synchroniser(renvoi = 0): Promise<void> {
    while (this.outbox.length > 0) {
      const lot = this.outbox.slice(0, 100)
      const corps = await this.appeler('push', '/sync/push', {
        method: 'POST',
        body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: lot }),
      })
      // Le réseau hoquette : l'accusé n'est jamais arrivé, le même lot repart.
      if (this.aleatoire() < renvoi) {
        await this.appeler('push', '/sync/push', {
          method: 'POST',
          body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: lot }),
        })
      }
      const acquittes = new Set<string>([...corps.acceptes, ...corps.doublons])
      expect(corps.rejetes, 'aucune vente ne doit être rejetée').toEqual([])
      this.outbox = this.outbox.filter((e) => !acquittes.has(e.eventId))
    }
    const p = new URLSearchParams({
      protocolVersion: '1',
      depuisCatalogue: String(this.curseurCatalogue),
      depuisEvenements: String(this.curseurEvenements),
      taillePage: '500',
    })
    const pull = await this.appeler('pull', `/sync/pull?${p}`)
    this.curseurEvenements = pull.curseurEvenements
    this.curseurCatalogue = pull.curseurCatalogue
  }
}

async function configCalcul(): Promise<ConfigCalcul> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  const { rows } = await client.query(
    'select id, name, rate_bp, is_included from kaissi.tax_rates where restaurant_id is not null',
  )
  await client.end()
  return {
    tauxTaxes: Object.fromEntries(
      rows.map((r) => [r.id, { id: r.id, nom: r.name, tauxBp: r.rate_bp as PointsDeBase, incluse: r.is_included }]),
    ),
  }
}

/** Les trois propriétés dures, vérifiées en base. */
async function verifierInvariants(caisses: readonly Caisse[]) {
  const attendus = new Map<string, number>()
  for (const c of caisses) for (const [id, total] of c.attendus) attendus.set(id, total)
  const evenementsEmis = caisses.reduce((s, c) => s + c.journal.length, 0)

  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const { rows: commandes } = await client.query<{ id: string; status: string; total_millimes: string }>(
      'select id, status, total_millimes from kaissi.orders where id = any($1::uuid[])',
      [[...attendus.keys()]],
    )
    const { rows: [compte] } = await client.query<{ n: number; distincts: number }>(
      `select count(*)::int as n, count(distinct event_id)::int as distincts
         from kaissi.order_events where event_id = any($1::uuid[])`,
      [caisses.flatMap((c) => c.journal.map((e) => e.eventId))],
    )
    const { rows: [paiements] } = await client.query<{ n: number }>(
      'select count(*)::int as n from kaissi.payments where order_id = any($1::uuid[])',
      [[...attendus.keys()]],
    )

    // 1. Aucune vente perdue.
    expect(commandes.length, 'commandes projetées').toBe(attendus.size)
    expect(commandes.every((c) => c.status === 'close'), 'toutes closes').toBe(true)
    // 2. Aucun doublon : chaque événement une fois, chaque vente payée une fois.
    expect(compte!.n).toBe(evenementsEmis)
    expect(compte!.distincts).toBe(evenementsEmis)
    expect(paiements!.n).toBe(attendus.size)
    // 3. Totaux exacts, au millime, commande par commande.
    const ecarts = commandes.filter((c) => Number(c.total_millimes) !== attendus.get(c.id))
    expect(ecarts.map((c) => `${c.id} serveur=${c.total_millimes} caisse=${attendus.get(c.id)}`), 'écarts de total caisse ↔ serveur').toEqual([])
    const ca = commandes.reduce((s, c) => s + Number(c.total_millimes), 0)
    const caAttendu = [...attendus.values()].reduce((s, v) => s + v, 0)
    expect(ca).toBe(caAttendu)
    return { commandes: commandes.length, evenements: evenementsEmis, ca }
  } finally {
    await client.end()
  }
}

function resume(nom: string, caisses: readonly Caisse[], dureeMs: number, commandes: number) {
  const mesures = caisses.flatMap((c) => c.mesures)
  const push = mesures.filter((m) => m.route === 'push').map((m) => m.ms).sort((a, b) => a - b)
  const pull = mesures.filter((m) => m.route === 'pull').map((m) => m.ms).sort((a, b) => a - b)
  const erreurs = mesures.filter((m) => m.statut >= 500).length
  const ligne = {
    scenario: nom,
    caisses: caisses.length,
    commandes,
    requetes: mesures.length,
    'durée (s)': Math.round(dureeMs / 100) / 10,
    'commandes/s': Math.round((commandes / (dureeMs / 1000)) * 10) / 10,
    'push p50': Math.round(centile(push, 50)),
    'push p95': Math.round(centile(push, 95)),
    'push p99': Math.round(centile(push, 99)),
    'pull p95': Math.round(centile(pull, 95)),
    'erreurs 5xx': erreurs,
  }
  rapport.push(ligne)
  return ligne
}

const rapport: Record<string, unknown>[] = []

beforeAll(async () => {
  await new Promise<void>((pret) => {
    serveur = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => pret())
  })
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`
})

beforeEach(nettoyer)

afterAll(async () => {
  console.log('\n  ── Rapport de charge (latences en ms, base locale) ──')
  console.table(rapport)
  metriques.arreter()
  await new Promise((fin) => serveur.close(fin))
  await depot.fermer()
})

describe('CHARGE', () => {
  it(
    'A. une heure de service en accéléré : 100 clients, 100 commandes, 4 caisses',
    async () => {
      const config = await configCalcul()
      const caisses = await Promise.all(
        ['A1', 'A2', 'A3', 'A4'].map(async (p, i) => new Caisse(await creerAppareil(p), hasard(11 + i))),
      )
      const parCaisse = 25 * ECHELLE
      const debut = performance.now()
      await Promise.all(
        caisses.map(async (c) => {
          for (let i = 0; i < parCaisse; i += 1) {
            await c.commande(config, true)
            // 10 % des lots renvoyés : le doublon de retentative, sous charge.
            await c.synchroniser(0.1)
          }
        }),
      )
      const duree = performance.now() - debut
      const { commandes } = await verifierInvariants(caisses)
      const r = resume('A — service accéléré', caisses, duree, commandes)
      expect(commandes).toBe(100 * ECHELLE)
      expect(r['erreurs 5xx']).toBe(0)
      // Généreux, à dessein : une base partagée de CI n'est pas un serveur
      // dédié. Un décrochage d'un ordre de grandeur, lui, se verrait.
      expect(r['push p95']).toBeLessThan(1_500)
    },
    180_000,
  )

  it(
    'B. le retour d’Internet : 20 caisses × 30 ventes reconnectées à la même seconde',
    async () => {
      const config = await configCalcul()
      const caisses = await Promise.all(
        Array.from({ length: 20 }, async (_, i) =>
          new Caisse(await creerAppareil(`B${i + 1}`), hasard(101 + i)),
        ),
      )
      // Hors ligne : on encaisse, rien ne part.
      for (const c of caisses) {
        for (let i = 0; i < 30 * ECHELLE; i += 1) await c.commande(config, false)
      }
      const debut = performance.now()
      await Promise.all(caisses.map((c) => c.synchroniser(0.1)))
      const duree = performance.now() - debut

      for (const c of caisses) expect(c.outbox).toEqual([])
      const { commandes } = await verifierInvariants(caisses)
      const r = resume('B — retour d’Internet', caisses, duree, commandes)
      expect(commandes).toBe(600 * ECHELLE)
      expect(r['erreurs 5xx']).toBe(0)
      // La vague entière, absorbée en moins d'une minute (par tranche de
      // 600 ventes). Mesuré en volume ×5 : 3 000 ventes en 76 s, push p95 à
      // 11,5 s — les envois d'un MÊME restaurant se rangent derrière son
      // verrou de numérotation (0043). Vingt caisses dans un seul
      // établissement est un cas d'école ; c'est la marge qui est mesurée.
      expect(duree).toBeLessThan(60_000 * ECHELLE)
    },
    300_000,
  )

  it(
    'C. montée en charge : 1, 5, 10, 25, 50 caisses simultanées',
    async () => {
      const config = await configCalcul()
      const paliers: Record<string, number>[] = []
      for (const n of [1, 5, 10, 25, 50]) {
        await nettoyer()
        const caisses = await Promise.all(
          Array.from({ length: n }, async (_, i) => new Caisse(await creerAppareil(`C${i + 1}`), hasard(1000 * n + i))),
        )
        const debut = performance.now()
        await Promise.all(
          caisses.map(async (c) => {
            for (let i = 0; i < 4 * ECHELLE; i += 1) await c.commande(config, true)
          }),
        )
        const duree = performance.now() - debut
        const { commandes } = await verifierInvariants(caisses)
        const r = resume(`C — ${n} caisse(s)`, caisses, duree, commandes)
        expect(r['erreurs 5xx'], `${n} caisses`).toBe(0)
        paliers.push({ caisses: n, p95: r['push p95'] as number })
      }
      // La forme de la courbe : à 50 caisses, le p95 ne doit pas exploser.
      expect(paliers[paliers.length - 1]!.p95).toBeLessThan(3_000)
    },
    600_000,
  )

  it('D. la surveillance a vu exactement ce qui s’est passé', () => {
    const push = metriques.statsFamilles(60).find((f) => f.famille === 'push')
    expect(push).toBeDefined()
    expect(push!.erreurs5xx).toBe(0)
    expect(push!.requetes).toBeGreaterThan(500)
  })
})
