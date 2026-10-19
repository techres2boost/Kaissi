/**
 * TESTS DE STRESS — « 1000 commandes par heure, et au-delà : où ça casse ? »
 *
 * `charge.test.ts` prouve que le service tient une charge normale SANS
 * AUCUNE erreur. Ce fichier pose les deux questions suivantes :
 *
 *   E. 1000 COMMANDES DANS UN SEUL ÉTABLISSEMENT — le pire cas pour le verrou
 *      de numérotation (0043), qui est par établissement. Dix caisses en
 *      ligne, chaque geste poussé, 10 % de lots renvoyés, PENDANT QUE cinq
 *      gérants rafraîchissent en boucle le tableau de bord (`rapport_ventes`)
 *      et la liste des tickets. Les lectures du back-office et les écritures
 *      des caisses se disputent la même base : c'est ainsi qu'un samedi soir
 *      se passe. On exige zéro erreur, et on mesure combien de temps prennent
 *      ces mille commandes — donc combien d'« heures de pointe » le service
 *      absorbe en une heure.
 *
 *   F. LA MONTÉE JUSQU'À LA RUPTURE — 25, 50, 100 (puis 200, 400 sous
 *      KAISSI_STRESS=1) caisses simultanées sur un pool de 10 connexions. On
 *      CHERCHE le palier où la latence dépasse le délai de la caisse (15 s).
 *      La caisse simulée s'y comporte comme la vraie : délai de 15 s,
 *      l'outbox reste intacte sur une erreur, et l'on réessaie.
 *
 *   G. LA TEMPÊTE — 50 caisses (100 sous KAISSI_STRESS=1) restées hors ligne,
 *      vingt ventes chacune, qui se reconnectent à la même seconde.
 *
 * Au-delà de la limite, des requêtes peuvent échouer — c'est le propre d'un
 * test de stress. Ce qui ne se négocie JAMAIS, même là : aucune vente
 * perdue, aucune vente dupliquée, totaux exacts au millime. Une caisse qui
 * réessaie doit finir par tout remonter, et une seule fois.
 *
 * ⚠ Même réserve que `charge.test.ts` : base locale, aucune latence réseau.
 *   Les latences absolues de Supabase + Railway seront plus hautes ; ce qui
 *   se transpose, ce sont les invariants sous concurrence et la FORME de la
 *   courbe. Résultats commentés : docs/charge-et-securite.md.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { centile } from '../src/surveillance.js'
import { DEMO_RESTO, URL_TEST, creerAppareil, nettoyer } from './aide.js'
import {
  Caisse,
  configCalcul,
  hasard,
  imprimerRapport,
  resume,
  verifierInvariants,
  type Comportement,
} from './banc-charge.js'

const LOURD = process.env['KAISSI_STRESS'] === '1'

/**
 * Les caisses sont créées UNE PAR UNE. `creerAppareil` ouvre une connexion
 * à chaque appel : cent créations en parallèle dépassaient les cent
 * connexions de la base de CI (« sorry, too many clients already ») — une
 * limite du banc, pas du service, qui n'en tient que dix.
 */
async function creerCaisses(n: number, fabrique: (i: number) => Promise<Caisse>): Promise<Caisse[]> {
  const liste: Caisse[] = []
  for (let i = 0; i < n; i += 1) liste.push(await fabrique(i))
  return liste
}

/** Le comportement de la VRAIE caisse face à un serveur qui peine. */
const COMME_LA_CAISSE: Comportement = { tolerante: true, delaiMs: 15_000, tentativesMax: 40 }

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })
let serveur: ServerType
let base = ''
const rapport: Record<string, unknown>[] = []

beforeAll(async () => {
  await new Promise<void>((pret) => {
    serveur = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => pret())
  })
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`
})
beforeEach(nettoyer)
afterAll(async () => {
  imprimerRapport('Rapport de stress (latences en ms, base locale, pool de 10)', rapport)
  await new Promise((fin) => serveur.close(fin))
  await depot.fermer()
})

/**
 * Un gérant devant son tableau de bord, qui rafraîchit sans arrêt : le
 * rapport agrégé en SQL (0033) et la liste des derniers tickets. Il passe
 * par sa PROPRE connexion, comme le back-office, qui parle à PostgREST et
 * non au pool du service de synchronisation.
 */
async function gerantQuiRafraichit(arreter: () => boolean, latences: number[]): Promise<void> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    while (!arreter()) {
      const debut = performance.now()
      await client.query(
        `select kaissi.rapport_ventes($1, now() - interval '1 day', now() + interval '1 day')`,
        [DEMO_RESTO],
      )
      await client.query(
        `select id, ticket_number, status, total_millimes from kaissi.orders
          where restaurant_id = $1 order by opened_at desc limit 50`,
        [DEMO_RESTO],
      )
      latences.push(performance.now() - debut)
      await new Promise((fin) => setTimeout(fin, 250))
    }
  } finally {
    await client.end()
  }
}

describe('STRESS', () => {
  it(
    'E. 1000 commandes dans UN établissement, 10 caisses, 5 gérants sur le tableau de bord',
    async () => {
      const config = await configCalcul()
      const caisses = await creerCaisses(10, async (i) =>
          new Caisse(await creerAppareil(`E${i + 1}`), hasard(5000 + i), base),
        )
      let fini = false
      const latencesRapports: number[] = []
      const gerants = Array.from({ length: 5 }, () =>
        gerantQuiRafraichit(() => fini, latencesRapports),
      )

      const memoireAvant = process.memoryUsage().rss
      const debut = performance.now()
      await Promise.all(
        caisses.map(async (c) => {
          for (let i = 0; i < 100; i += 1) {
            await c.commande(config, true)
            await c.synchroniser(0.1)
          }
        }),
      )
      const duree = performance.now() - debut
      fini = true
      await Promise.all(gerants)

      const { commandes } = await verifierInvariants(caisses)
      const r = resume(rapport, 'E — 1000 commandes, 1 établissement', caisses, duree, commandes)
      const rapports = latencesRapports.sort((a, b) => a - b)
      Object.assign(r, {
        'tableau de bord p95': Math.round(centile(rapports, 95)),
        'heures de pointe absorbées par heure': Math.floor(3_600_000 / duree),
        'mémoire +Mo': Math.round((process.memoryUsage().rss - memoireAvant) / 1_048_576),
      })

      expect(commandes).toBe(1000)
      expect(r['erreurs 5xx']).toBe(0)
      // 1000 commandes « par heure » doivent tenir dans une fraction d'heure.
      // Mesuré : moins d'une minute en local. Dix minutes laisseraient
      // encore six fois la marge — au-delà, c'est un décrochage à expliquer.
      expect(duree).toBeLessThan(600_000)
      expect(r['push p95']).toBeLessThan(2_000)
      // Les gérants ne doivent pas geler pendant le coup de feu.
      expect(centile(rapports, 95)).toBeLessThan(2_000)
    },
    900_000,
  )

  it(
    'F. montée jusqu’à la rupture : aucune vente perdue même au-delà de la limite',
    async () => {
      const config = await configCalcul()
      const paliers = LOURD ? [25, 50, 100, 200, 400] : [25, 50, 100]
      for (const n of paliers) {
        await nettoyer()
        const caisses = await creerCaisses(n, async (i) =>
          // Préfixe de tickets : quatre caractères au plus (contrainte 0002).
            new Caisse(await creerAppareil(`F${i.toString(36).toUpperCase()}`), hasard(7000 * n + i), base, COMME_LA_CAISSE),
        )
        const debut = performance.now()
        await Promise.all(
          caisses.map(async (c) => {
            for (let i = 0; i < 3; i += 1) await c.commande(config, true)
          }),
        )
        const duree = performance.now() - debut
        for (const c of caisses) expect(c.outbox, `palier ${n} : outbox vidée`).toEqual([])
        const { commandes } = await verifierInvariants(caisses)
        const r = resume(rapport, `F — ${n} caisses simultanées`, caisses, duree, commandes)
        expect(commandes).toBe(3 * n)
        // Le seuil qui compte pour la caisse : son délai de 15 s. Tant que
        // le p95 reste dessous, une caisse ne voit pas la charge.
        if (n <= 50) {
          expect(r['erreurs 5xx'], `${n} caisses`).toBe(0)
          expect(r['push p95'], `${n} caisses`).toBeLessThan(15_000)
        }
      }
    },
    1_800_000,
  )

  it(
    'G. la tempête : des caisses hors ligne qui se reconnectent à la même seconde',
    async () => {
      const config = await configCalcul()
      const nombre = LOURD ? 100 : 50
      const caisses = await creerCaisses(nombre, async (i) =>
          new Caisse(await creerAppareil(`G${i + 1}`), hasard(9000 + i), base, COMME_LA_CAISSE),
        )
      for (const c of caisses) {
        for (let i = 0; i < 20; i += 1) await c.commande(config, false)
      }
      const debut = performance.now()
      await Promise.all(caisses.map((c) => c.synchroniser(0.1)))
      const duree = performance.now() - debut

      for (const c of caisses) expect(c.outbox).toEqual([])
      const { commandes } = await verifierInvariants(caisses)
      resume(rapport, `G — tempête : ${nombre} caisses × 20 ventes`, caisses, duree, commandes)
      expect(commandes).toBe(nombre * 20)
    },
    1_800_000,
  )
})
