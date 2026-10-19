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
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { Metriques } from '../src/surveillance.js'
import { creerAppareil, nettoyer, URL_TEST } from './aide.js'
import {
  Caisse,
  configCalcul,
  hasard,
  imprimerRapport,
  resume as resumer,
  verifierInvariants,
} from './banc-charge.js'

const ECHELLE = process.env['KAISSI_CHARGE'] === 'lourd' ? 5 : 1

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const metriques = new Metriques()
const app = creerServeur({ depot, metriques })
let serveur: ServerType
let base = ''
const rapport: Record<string, unknown>[] = []
const resume = (nom: string, caisses: readonly Caisse[], dureeMs: number, commandes: number) =>
  resumer(rapport, nom, caisses, dureeMs, commandes)

beforeAll(async () => {
  await new Promise<void>((pret) => {
    serveur = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => pret())
  })
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`
})

beforeEach(nettoyer)

afterAll(async () => {
  imprimerRapport('Rapport de charge (latences en ms, base locale)', rapport)
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
        ['A1', 'A2', 'A3', 'A4'].map(async (p, i) => new Caisse(await creerAppareil(p), hasard(11 + i), base)),
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
          new Caisse(await creerAppareil(`B${i + 1}`), hasard(101 + i), base),
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
          Array.from({ length: n }, async (_, i) => new Caisse(await creerAppareil(`C${i + 1}`), hasard(1000 * n + i), base)),
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
