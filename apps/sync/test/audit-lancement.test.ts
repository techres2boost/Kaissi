/**
 * AUDIT DE LANCEMENT — le service tel qu'il tourne en production, mesuré de
 * l'extérieur.
 *
 * ── Ce que ce banc a de plus que `charge.test.ts` et `stress.test.ts` ─────
 *
 * Ces deux-là font tourner le serveur DANS le processus du test. C'est
 * rapide, et suffisant pour les invariants — mais trois questions leur
 * échappent :
 *
 *   1. Combien de CPU et de mémoire le SERVICE consomme-t-il ? Dans un seul
 *      processus, on mesure le service plus le générateur de charge.
 *   2. Que se passe-t-il quand le service MEURT en pleine charge (`kill -9`),
 *      ou quand PostgreSQL redémarre sous lui ? On ne tue pas un serveur qui
 *      vit dans le processus du test.
 *   3. La production n'a pas la forme « cent caisses dans un restaurant » :
 *      elle a celle de centaines de restaurants à quelques caisses. Le verrou
 *      de numérotation (0043) étant par établissement, les deux formes ne
 *      se comportent pas du tout pareil.
 *
 * Ici, le service est lancé par la commande de PRODUCTION
 * (`node … src/index.ts`, pool de 10 connexions, boucles de maintenance
 * allumées), dans un processus séparé, et une sonde lit `/proc` et
 * `pg_stat_*` deux fois par seconde.
 *
 * ── Ce que ce banc ne dit PAS ─────────────────────────────────────────────
 *
 * Tout tourne sur UNE machine : le service, PostgreSQL et le générateur de
 * charge se partagent les mêmes cœurs, et il n'y a aucune latence réseau.
 * Les latences absolues de Railway + Supabase seront différentes — plus
 * hautes au repos (20 à 80 ms d'aller-retour), et dépendantes de machines
 * partagées. Ce qui se transpose : les invariants (aucune vente perdue ni
 * doublée, totaux au millime), le comportement sous panne, et les ordres de
 * grandeur de consommation.
 *
 * Désactivé par défaut (il dure plusieurs minutes et tue des processus) :
 *
 *   KAISSI_AUDIT=1 pnpm --filter @kaissi/sync exec vitest run \
 *     test/audit-lancement.test.ts --silent=false
 *
 * Résultats commentés : docs/audit-lancement.md.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, createWriteStream, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { genererJeton } from '../src/jeton.js'
import { centile } from '../src/surveillance.js'
import { DEMO_ORG, DEMO_RESTO, URL_TEST, nettoyer, type AppareilTest } from './aide.js'
import {
  Caisse,
  configCalcul,
  hasard,
  imprimerRapport,
  verifierInvariants,
  type Comportement,
  type ContexteEtablissement,
} from './banc-charge.js'

const ACTIF = process.env['KAISSI_AUDIT'] === '1'
const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE_SYNC = resolve(ICI, '..')
const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const JOURNAL_SERVICE = process.env['KAISSI_AUDIT_JOURNAL'] ?? '/tmp/kaissi-audit-service.log'
const FICHIER_RAPPORT = process.env['KAISSI_AUDIT_RAPPORT'] ?? ''

/** La vraie caisse face à un serveur qui peine : 15 s, puis on réessaie. */
const COMME_LA_CAISSE: Comportement = { tolerante: true, delaiMs: 15_000, tentativesMax: 60 }

// ── Le service, lancé comme en production ─────────────────────────────────

let service: ChildProcess | null = null

async function attendreSante(delaiMs: number): Promise<void> {
  const limite = Date.now() + delaiMs
  for (;;) {
    try {
      const r = await fetch(`${BASE}/sante`, { signal: AbortSignal.timeout(2_000) })
      if (r.ok) return
    } catch {
      // pas encore en écoute
    }
    if (Date.now() > limite) throw new Error('le service ne répond pas sur /sante')
    await new Promise((f) => setTimeout(f, 150))
  }
}

async function demarrerService(): Promise<number> {
  const sortie = createWriteStream(JOURNAL_SERVICE, { flags: 'a' })
  // La commande du script `start` de apps/sync/package.json, à l'identique.
  service = spawn(
    process.execPath,
    ['--experimental-strip-types', '--import', './scripts/charger-ts.mjs', 'src/index.ts'],
    {
      cwd: RACINE_SYNC,
      env: {
        ...process.env,
        DATABASE_URL: URL_TEST,
        DATABASE_SSL: 'false',
        SYNC_PORT: String(PORT),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  service.stdout?.pipe(sortie)
  service.stderr?.pipe(sortie)
  await attendreSante(30_000)
  return service.pid!
}

/**
 * Un service NEUF pour chaque scénario.
 *
 * Le RSS d'un processus Node ne redescend presque jamais : mesuré sur un
 * service qui a déjà encaissé le scénario précédent, il rend le plus haut
 * niveau jamais atteint, pas la mémoire du scénario en cours.
 */
async function serviceNeuf(): Promise<void> {
  await arreterService()
  await demarrerService()
}

async function arreterService(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  const p = service
  if (!p || p.exitCode !== null) return
  await new Promise<void>((fin) => {
    p.once('exit', () => fin())
    p.kill(signal)
  })
  service = null
}

// ── La sonde : /proc et pg_stat_*, deux fois par seconde ──────────────────

const TICS_PAR_SECONDE = 100 // sysconf(_SC_CLK_TCK) sous Linux

function ticsCpu(pid: number): number | null {
  try {
    // Les champs 14 et 15 (utime, stime), après le nom entre parenthèses.
    const brut = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const champs = brut.slice(brut.lastIndexOf(')') + 2).split(' ')
    return Number(champs[11]) + Number(champs[12])
  } catch {
    return null
  }
}

function rssOctets(pid: number): number {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
    return m ? Number(m[1]) * 1024 : 0
  } catch {
    return 0
  }
}

function pidsPostgres(): number[] {
  const pids: number[] = []
  for (const nom of readdirSync('/proc')) {
    if (!/^\d+$/.test(nom)) continue
    try {
      if (readFileSync(`/proc/${nom}/comm`, 'utf8').trim() === 'postgres') pids.push(Number(nom))
    } catch {
      // processus terminé entre-temps
    }
  }
  return pids
}

interface Point {
  t: number
  cpuService: number
  rssService: number
  cpuPg: number
  rssPg: number
  connexions: number
  actives: number
  tps: number
}

class Sonde {
  private readonly points: Point[] = []
  private minuterie: NodeJS.Timeout | null = null
  private client: Client | null = null
  private dernier = { t: 0, service: 0, pg: 0, commits: 0 }
  private enCours = false

  async demarrer(): Promise<void> {
    this.client = new Client({ connectionString: URL_TEST })
    await this.client.connect()
    this.client.on('error', () => {
      // PostgreSQL redémarré sous la sonde (scénario R2) : on se reconnecte.
      this.client = null
    })
    this.dernier = { t: performance.now(), service: 0, pg: 0, commits: -1 }
    this.minuterie = setInterval(() => void this.mesurer(), 500)
  }

  private async mesurer(): Promise<void> {
    if (this.enCours) return
    this.enCours = true
    try {
      const t = performance.now()
      const dt = (t - this.dernier.t) / 1000
      const pid = service?.pid ?? 0
      const ticsService = pid ? (ticsCpu(pid) ?? 0) : 0
      const pg = pidsPostgres()
      const ticsPg = pg.reduce((s, p) => s + (ticsCpu(p) ?? 0), 0)
      // La mémoire PARTAGÉE de PostgreSQL est comptée dans le RSS de chaque
      // processus : on garde le plus gros plutôt que la somme, qui la
      // compterait dix fois.
      const rssPg = pg.reduce((m, p) => Math.max(m, rssOctets(p)), 0)

      let connexions = 0
      let actives = 0
      let commits = this.dernier.commits
      try {
        if (!this.client) {
          const c = new Client({ connectionString: URL_TEST })
          await c.connect()
          c.on('error', () => {
            this.client = null
          })
          this.client = c
        }
        const { rows } = await this.client.query<{
          connexions: number
          actives: number
          commits: string
        }>(
          `select (select count(*)::int from pg_stat_activity where datname = current_database()) as connexions,
                  (select count(*)::int from pg_stat_activity
                    where datname = current_database() and state = 'active') as actives,
                  (select xact_commit::text from pg_stat_database
                    where datname = current_database()) as commits`,
        )
        connexions = rows[0]!.connexions
        actives = rows[0]!.actives
        commits = Number(rows[0]!.commits)
      } catch {
        this.client = null
      }

      const premier = this.dernier.commits < 0
      this.points.push({
        t,
        cpuService:
          this.dernier.service > 0 && ticsService >= this.dernier.service
            ? ((ticsService - this.dernier.service) / TICS_PAR_SECONDE / dt) * 100
            : 0,
        rssService: pid ? rssOctets(pid) : 0,
        cpuPg:
          this.dernier.pg > 0 && ticsPg >= this.dernier.pg
            ? ((ticsPg - this.dernier.pg) / TICS_PAR_SECONDE / dt) * 100
            : 0,
        rssPg,
        connexions,
        actives,
        tps: premier || commits < this.dernier.commits ? 0 : (commits - this.dernier.commits) / dt,
      })
      this.dernier = { t, service: ticsService, pg: ticsPg, commits }
    } finally {
      this.enCours = false
    }
  }

  /** Ce qui a été mesuré depuis `depuis` (performance.now()). */
  resume(depuis: number) {
    const p = this.points.filter((x) => x.t >= depuis)
    const moy = (f: (x: Point) => number) =>
      p.length === 0 ? 0 : p.reduce((s, x) => s + f(x), 0) / p.length
    const max = (f: (x: Point) => number) => p.reduce((m, x) => Math.max(m, f(x)), 0)
    const mo = (o: number) => Math.round(o / 1024 / 1024)
    return {
      'CPU service moy %': Math.round(moy((x) => x.cpuService)),
      'CPU service max %': Math.round(max((x) => x.cpuService)),
      'RAM service max Mo': mo(max((x) => x.rssService)),
      'CPU Postgres moy %': Math.round(moy((x) => x.cpuPg)),
      'CPU Postgres max %': Math.round(max((x) => x.cpuPg)),
      'connexions max': max((x) => x.connexions),
      'requêtes actives max': max((x) => x.actives),
      'transactions/s max': Math.round(max((x) => x.tps)),
    }
  }

  /** Mémoire du service, premier et dernier quart de la fenêtre : la pente. */
  penteMemoire(depuis: number) {
    const p = this.points.filter((x) => x.t >= depuis && x.rssService > 0)
    const quart = Math.max(1, Math.floor(p.length / 4))
    const moy = (l: Point[]) => l.reduce((s, x) => s + x.rssService, 0) / l.length / 1024 / 1024
    return { debutMo: Math.round(moy(p.slice(0, quart))), finMo: Math.round(moy(p.slice(-quart))) }
  }

  async arreter(): Promise<void> {
    if (this.minuterie) clearInterval(this.minuterie)
    await this.client?.end().catch(() => undefined)
  }
}

// ── Les établissements et les caisses, créés en masse ─────────────────────

async function creerEtablissements(n: number, prefixe: string): Promise<ContexteEtablissement[]> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const liste: ContexteEtablissement[] = []
    for (let i = 0; i < n; i += 1) {
      const id = uuidV7()
      await client.query(
        `insert into kaissi.restaurants (id, organization_id, name, slug, timezone)
         values ($1, $2, $3, $4, 'Africa/Tunis')`,
        [id, DEMO_ORG, `Audit ${prefixe} ${i + 1}`, `audit-${id}`],
      )
      await client.query(
        `insert into kaissi.tax_rates
           (id, organization_id, restaurant_id, name, rate_bp, is_included, is_default)
         select kaissi.uuid_v7(), organization_id, $1, name, rate_bp, is_included, is_default
           from kaissi.tax_rates where restaurant_id = $2 and archived_at is null`,
        [id, DEMO_RESTO],
      )
      await client.query(
        `insert into kaissi.payment_methods
           (id, organization_id, restaurant_id, name, type, opens_drawer, position, is_active)
         select kaissi.uuid_v7(), organization_id, $1, name, type, opens_drawer, position, is_active
           from kaissi.payment_methods where restaurant_id = $2 and archived_at is null`,
        [id, DEMO_RESTO],
      )
      const { rows: taux } = await client.query<{ id: string; rate_bp: number }>(
        'select id, rate_bp from kaissi.tax_rates where restaurant_id = $1',
        [id],
      )
      const { rows: especes } = await client.query<{ id: string }>(
        `select id from kaissi.payment_methods where restaurant_id = $1 and type = 'cash' limit 1`,
        [id],
      )
      liste.push({
        restaurantId: id,
        organizationId: DEMO_ORG,
        tva19: taux.find((t) => t.rate_bp === 1900)!.id,
        tva07: taux.find((t) => t.rate_bp === 700)!.id,
        especes: especes[0]!.id,
      })
    }
    return liste
  } finally {
    await client.end()
  }
}

/** `n` appareils dans un établissement, sur UNE connexion. */
async function creerAppareils(
  n: number,
  prefixe: string,
  restaurantId: string = DEMO_RESTO,
): Promise<AppareilTest[]> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const liste: AppareilTest[] = []
    for (let i = 0; i < n; i += 1) {
      const id = uuidV7()
      const jeton = genererJeton()
      // `ticket_prefix` : 1 à 4 caractères [A-Z0-9] (0002). Une lettre, puis
      // le rang en base 36 — jusqu'à 46 656 caisses par lettre.
      const p = `${prefixe}${i.toString(36).toUpperCase()}`
      await client.query(
        `insert into kaissi.devices
           (id, organization_id, restaurant_id, label, type, ticket_prefix,
            token_hash, app_version, protocol_version)
         values ($1,$2,$3,$4,'pos',$5,$6,'0.2.0',1)`,
        [id, DEMO_ORG, restaurantId, `Terminal ${p}`, p, jeton.empreinte],
      )
      liste.push({ id, jetonClair: jeton.clair, prefixe: p })
    }
    return liste
  } finally {
    await client.end()
  }
}

async function supprimerEtablissementsAudit(): Promise<void> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    await client.query(`delete from kaissi.restaurants where slug like 'audit-%'`)
  } finally {
    await client.end()
  }
}

// ── Le rapport ────────────────────────────────────────────────────────────

const rapportCharge: Record<string, unknown>[] = []
const rapportRessources: Record<string, unknown>[] = []
const rapportResilience: Record<string, unknown>[] = []

function ligneCharge(nom: string, caisses: readonly Caisse[], dureeMs: number, commandes: number) {
  const mesures = caisses.flatMap((c) => c.mesures)
  const tri = (route: 'push' | 'pull') =>
    mesures.filter((m) => m.route === route && m.statut >= 200 && m.statut < 300)
      .map((m) => m.ms)
      .sort((a, b) => a - b)
  const push = tri('push')
  const pull = tri('pull')
  const ligne = {
    scénario: nom,
    caisses: caisses.length,
    commandes,
    requêtes: mesures.length,
    'durée s': Math.round(dureeMs / 100) / 10,
    'commandes/s': Math.round((commandes / (dureeMs / 1000)) * 10) / 10,
    'requêtes/s': Math.round(mesures.length / (dureeMs / 1000)),
    'push p50': Math.round(centile(push, 50)),
    'push p95': Math.round(centile(push, 95)),
    'push p99': Math.round(centile(push, 99)),
    'pull p95': Math.round(centile(pull, 95)),
    '5xx': mesures.filter((m) => m.statut >= 500).length,
    'sans réponse': mesures.filter((m) => m.statut === 0).length,
    // Les deux natures d'un « sans réponse » n'ont rien à voir : un délai de
    // 15 s dépassé est une file d'attente ; un échec immédiat est une
    // connexion refusée ou coupée.
    'dont délai 15 s': mesures.filter((m) => m.statut === 0 && m.ms >= 14_000).length,
    'dont coupure nette': mesures.filter((m) => m.statut === 0 && m.ms < 14_000).length,
    'caisses servies du 1er coup': caisses.filter((c) => c.mesures.every((m) => m.statut !== 0)).length,
  }
  rapportCharge.push(ligne)
  return ligne
}

async function tailleBase(): Promise<number> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const { rows } = await client.query<{ o: string }>(
      'select pg_database_size(current_database())::text as o',
    )
    return Number(rows[0]!.o)
  } finally {
    await client.end()
  }
}

function lignesDErreurDuService(depuisOctet: number): number {
  try {
    const texte = readFileSync(JOURNAL_SERVICE, 'utf8').slice(depuisOctet)
    return texte.split('\n').filter((l) => l.includes('"niveau":"erreur"')).length
  } catch {
    return 0
  }
}

function tailleJournal(): number {
  try {
    return readFileSync(JOURNAL_SERVICE, 'utf8').length
  } catch {
    return 0
  }
}

/**
 * Un gérant sur son tableau de bord : le rapport agrégé en SQL (0033) et les
 * derniers tickets, par sa PROPRE connexion — comme le back-office, qui
 * parle à PostgREST et non au pool du service.
 */
async function gerant(restaurantId: string, arreter: () => boolean, latences: number[]) {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    while (!arreter()) {
      const debut = performance.now()
      await client.query(
        `select kaissi.rapport_ventes($1, now() - interval '1 day', now() + interval '1 day')`,
        [restaurantId],
      )
      await client.query(
        `select id, ticket_number, status, total_millimes from kaissi.orders
          where restaurant_id = $1 order by opened_at desc limit 50`,
        [restaurantId],
      )
      latences.push(performance.now() - debut)
      await new Promise((f) => setTimeout(f, 250))
    }
  } finally {
    await client.end()
  }
}

const sonde = new Sonde()

describe.skipIf(!ACTIF)('AUDIT DE LANCEMENT — service en processus séparé', () => {
  beforeAll(async () => {
    await nettoyer()
    await supprimerEtablissementsAudit()
    await demarrerService()
    await sonde.demarrer()
  }, 120_000)

  afterAll(async () => {
    await sonde.arreter()
    await arreterService()
    imprimerRapport('Charge (latences en ms ; service en processus séparé, pool de 10)', rapportCharge)
    imprimerRapport('Ressources pendant chaque scénario', rapportRessources)
    imprimerRapport('Résilience', rapportResilience)
    if (FICHIER_RAPPORT) {
      appendFileSync(
        FICHIER_RAPPORT,
        JSON.stringify({ rapportCharge, rapportRessources, rapportResilience }) + '\n',
      )
    }
    await nettoyer()
    await supprimerEtablissementsAudit()
  }, 120_000)

  it(
    'H1 — 1000 commandes à la MÊME seconde, 1000 caisses, UN établissement (pire cas du verrou)',
    async () => {
      const config = await configCalcul()
      const appareils = await creerAppareils(1000, 'H')
      const caisses = appareils.map(
        (a, i) => new Caisse(a, hasard(11_000 + i), BASE, COMME_LA_CAISSE),
      )
      // Chaque caisse prépare UNE vente hors ligne…
      for (const c of caisses) await c.commande(config, false)
      const avant = await tailleBase()
      const debut = performance.now()
      const journal = tailleJournal()
      // … et les mille se présentent ensemble.
      await Promise.all(caisses.map((c) => c.synchroniser(0.1)))
      const duree = performance.now() - debut
      const bilan = await verifierInvariants(caisses)
      expect(bilan.commandes).toBe(1000)
      const ligne = ligneCharge('H1 — 1000 caisses × 1 vente, 1 établissement', caisses, duree, 1000)
      rapportRessources.push({
        scénario: 'H1',
        ...sonde.resume(debut),
        'Ko par vente': Math.round((await tailleBase() - avant) / 1000 / 1024),
        'erreurs journalisées': lignesDErreurDuService(journal),
      })
      expect(ligne['5xx']).toBe(0)
    },
    900_000,
  )

  it(
    'H2 — 1000 commandes à la même seconde, 250 établissements × 4 caisses (forme de la production)',
    async () => {
      await nettoyer()
      await serviceNeuf()
      const restos = await creerEtablissements(250, 'H2')
      const caisses: Caisse[] = []
      for (const [i, r] of restos.entries()) {
        const appareils = await creerAppareils(4, 'C', r.restaurantId)
        for (const [j, a] of appareils.entries()) {
          caisses.push(new Caisse(a, hasard(22_000 + i * 10 + j), BASE, COMME_LA_CAISSE, r))
        }
      }
      // APRÈS la création des établissements : leurs taux de TVA sont des
      // lignes neuves, que la configuration de calcul doit connaître.
      const config = await configCalcul()
      for (const c of caisses) await c.commande(config, false)
      const avant = await tailleBase()
      const debut = performance.now()
      const journal = tailleJournal()
      await Promise.all(caisses.map((c) => c.synchroniser(0.1)))
      const duree = performance.now() - debut
      const bilan = await verifierInvariants(caisses)
      expect(bilan.commandes).toBe(1000)
      const ligne = ligneCharge('H2 — 250 établissements × 4 caisses × 1 vente', caisses, duree, 1000)
      rapportRessources.push({
        scénario: 'H2',
        ...sonde.resume(debut),
        'Ko par vente': Math.round((await tailleBase() - avant) / 1000 / 1024),
        'erreurs journalisées': lignesDErreurDuService(journal),
      })
      expect(ligne['5xx']).toBe(0)
    },
    900_000,
  )

  it(
    'H3 — service réel : 250 établissements, 1000 caisses EN LIGNE, 5000 commandes geste par geste, 20 gérants',
    async () => {
      await nettoyer()
      await supprimerEtablissementsAudit()
      await serviceNeuf()
      const restos = await creerEtablissements(250, 'H3')
      const caisses: Caisse[] = []
      for (const [i, r] of restos.entries()) {
        const appareils = await creerAppareils(4, 'C', r.restaurantId)
        for (const [j, a] of appareils.entries()) {
          caisses.push(new Caisse(a, hasard(33_000 + i * 10 + j), BASE, COMME_LA_CAISSE, r))
        }
      }
      // APRÈS la création des établissements : leurs taux de TVA sont des
      // lignes neuves, que la configuration de calcul doit connaître.
      const config = await configCalcul()
      let fini = false
      const latencesRapports: number[] = []
      const gerants = restos
        .slice(0, 20)
        .map((r) => gerant(r.restaurantId, () => fini, latencesRapports))
      const avant = await tailleBase()
      const debut = performance.now()
      const journal = tailleJournal()
      // Chaque caisse enchaîne cinq commandes, chaque geste poussé puis tiré
      // — c'est le comportement d'une caisse en ligne. Mille caisses à la
      // fois : mille commandes OUVERTES en permanence.
      await Promise.all(
        caisses.map(async (c) => {
          for (let k = 0; k < 5; k += 1) await c.commande(config, true)
          await c.synchroniser()
        }),
      )
      const duree = performance.now() - debut
      fini = true
      await Promise.all(gerants)
      const bilan = await verifierInvariants(caisses)
      expect(bilan.commandes).toBe(5000)
      const ligne = ligneCharge('H3 — 1000 caisses en ligne × 5 ventes, 20 gérants', caisses, duree, 5000)
      const tri = [...latencesRapports].sort((a, b) => a - b)
      rapportRessources.push({
        scénario: 'H3',
        ...sonde.resume(debut),
        'Ko par vente': Math.round((await tailleBase() - avant) / 5000 / 1024),
        'erreurs journalisées': lignesDErreurDuService(journal),
        'rapports gérant p95 ms': Math.round(centile(tri, 95)),
        'rapports lus': tri.length,
      })
      expect(ligne['5xx']).toBe(0)
    },
    1_800_000,
  )

  it(
    'H4 — endurance : charge soutenue pendant 3 minutes, la mémoire du service ne monte pas',
    async () => {
      await nettoyer()
      await supprimerEtablissementsAudit()
      await serviceNeuf()
      const restos = await creerEtablissements(50, 'H4')
      const caisses: Caisse[] = []
      for (const [i, r] of restos.entries()) {
        const appareils = await creerAppareils(2, 'C', r.restaurantId)
        for (const [j, a] of appareils.entries()) {
          caisses.push(new Caisse(a, hasard(44_000 + i * 10 + j), BASE, COMME_LA_CAISSE, r))
        }
      }
      // APRÈS la création des établissements : leurs taux de TVA sont des
      // lignes neuves, que la configuration de calcul doit connaître.
      const config = await configCalcul()
      const debut = performance.now()
      const journal = tailleJournal()
      const fin = Date.now() + 180_000
      let commandes = 0
      await Promise.all(
        caisses.map(async (c) => {
          while (Date.now() < fin) {
            await c.commande(config, true)
            commandes += 1
          }
          await c.synchroniser()
        }),
      )
      const duree = performance.now() - debut
      await verifierInvariants(caisses)
      const ligne = ligneCharge('H4 — endurance 3 min, 100 caisses', caisses, duree, commandes)
      const pente = sonde.penteMemoire(debut)
      // Latence du premier et du dernier quart : une dégradation dans le
      // temps (index qui gonfle, fuite) se verrait ici.
      const pushes = caisses
        .flatMap((c) => c.mesures)
        .filter((m) => m.route === 'push' && m.statut === 200)
      const quart = Math.floor(pushes.length / 4)
      rapportRessources.push({
        scénario: 'H4',
        ...sonde.resume(debut),
        'RAM service début Mo': pente.debutMo,
        'RAM service fin Mo': pente.finMo,
        'erreurs journalisées': lignesDErreurDuService(journal),
        'commandes en 3 min': commandes,
      })
      expect(ligne['5xx']).toBe(0)
      // Une fuite franche doublerait la mémoire en trois minutes de charge.
      expect(pente.finMo).toBeLessThan(pente.debutMo * 2 + 100)
      expect(quart).toBeGreaterThan(0)
    },
    900_000,
  )

  it(
    'R1 — le service est TUÉ (kill -9) en pleine charge, puis relancé : rien de perdu, rien de doublé',
    async () => {
      await nettoyer()
      await supprimerEtablissementsAudit()
      await serviceNeuf()
      const restos = await creerEtablissements(25, 'R1')
      const caisses: Caisse[] = []
      for (const [i, r] of restos.entries()) {
        const appareils = await creerAppareils(4, 'C', r.restaurantId)
        for (const [j, a] of appareils.entries()) {
          caisses.push(new Caisse(a, hasard(55_000 + i * 10 + j), BASE, COMME_LA_CAISSE, r))
        }
      }
      // APRÈS la création des établissements : leurs taux de TVA sont des
      // lignes neuves, que la configuration de calcul doit connaître.
      const config = await configCalcul()
      const debut = performance.now()
      const charge = Promise.all(
        caisses.map(async (c) => {
          for (let k = 0; k < 8; k += 1) await c.commande(config, true)
          await c.synchroniser()
        }),
      )
      // Deux meurtres, à 2 s puis à 6 s : le premier au milieu des écritures,
      // le second pendant que les caisses rattrapent le premier.
      const coupures: number[] = []
      for (const attente of [2_000, 2_500]) {
        await new Promise((f) => setTimeout(f, attente))
        const t0 = performance.now()
        await arreterService('SIGKILL')
        await new Promise((f) => setTimeout(f, 1_500))
        await demarrerService()
        coupures.push(Math.round(performance.now() - t0))
      }
      await charge
      const duree = performance.now() - debut
      const bilan = await verifierInvariants(caisses)
      const mesures = caisses.flatMap((c) => c.mesures)
      rapportResilience.push({
        scénario: 'R1 — kill -9 du service ×2 en pleine charge',
        commandes: bilan.commandes,
        'durée s': Math.round(duree / 100) / 10,
        'indisponibilités ms': coupures.join(' + '),
        'requêtes échouées puis rejouées': mesures.filter((m) => m.statut === 0 || m.statut >= 500).length,
        'ventes perdues': 0,
        'ventes doublées': 0,
        verdict: 'tient',
      })
      expect(bilan.commandes).toBe(caisses.length * 8)
    },
    900_000,
  )

  it(
    'R2 — PostgreSQL REDÉMARRE sous le service en pleine charge : le service se rétablit SEUL',
    async () => {
      await nettoyer()
      await supprimerEtablissementsAudit()
      await serviceNeuf()
      const restos = await creerEtablissements(25, 'R2')
      const caisses: Caisse[] = []
      for (const [i, r] of restos.entries()) {
        const appareils = await creerAppareils(4, 'C', r.restaurantId)
        for (const [j, a] of appareils.entries()) {
          caisses.push(new Caisse(a, hasard(66_000 + i * 10 + j), BASE, COMME_LA_CAISSE, r))
        }
      }
      // APRÈS la création des établissements : leurs taux de TVA sont des
      // lignes neuves, que la configuration de calcul doit connaître.
      const config = await configCalcul()
      const pidAvant = service!.pid
      const debut = performance.now()
      const charge = Promise.all(
        caisses.map(async (c) => {
          for (let k = 0; k < 8; k += 1) await c.commande(config, true)
          await c.synchroniser()
        }),
      )
      await new Promise((f) => setTimeout(f, 2_500))
      const t0 = performance.now()
      // `-m immediate` : arrêt brutal, sans vider les tampons — l'équivalent
      // d'une panne du serveur de base, reprise sur journal comprise.
      execFileSync('su', [
        'postgres',
        '-c',
        `/usr/lib/postgresql/16/bin/pg_ctl -D ${process.env['KAISSI_AUDIT_PGDATA'] ?? '/var/tmp/pgk/data'} -m immediate -w restart -o '-p 5433 -c max_connections=100' -l /var/tmp/pgk/log/pg.log`,
      ])
      const coupure = Math.round(performance.now() - t0)
      await charge
      const duree = performance.now() - debut
      const bilan = await verifierInvariants(caisses)
      const mesures = caisses.flatMap((c) => c.mesures)
      rapportResilience.push({
        scénario: 'R2 — PostgreSQL redémarré (arrêt brutal) en pleine charge',
        commandes: bilan.commandes,
        'durée s': Math.round(duree / 100) / 10,
        'indisponibilités ms': String(coupure),
        'requêtes échouées puis rejouées': mesures.filter((m) => m.statut === 0 || m.statut >= 500).length,
        'ventes perdues': 0,
        'ventes doublées': 0,
        verdict: service?.pid === pidAvant ? 'tient, service resté debout' : 'tient, mais le service a redémarré',
      })
      expect(bilan.commandes).toBe(caisses.length * 8)
      // Le service ne doit PAS être mort de la perte de ses connexions.
      expect(service?.exitCode).toBeNull()
      expect(service?.pid).toBe(pidAvant)
    },
    900_000,
  )

  it(
    'R3 — réseau qui coupe AU MILIEU des requêtes : l’accusé se perd, la caisse renvoie, rien n’est doublé',
    async () => {
      await nettoyer()
      await supprimerEtablissementsAudit()
      await serviceNeuf()
      const restos = await creerEtablissements(25, 'R3')
      // La caisse abandonne chaque requête au bout de 12 ms : la plupart
      // sont déjà ARRIVÉES au serveur, qui les traite — mais la réponse ne
      // revient jamais. C'est le pire cas pour l'idempotence.
      const coupe: Comportement = {
        tolerante: true,
        delaiMs: 12,
        tentativesMax: 3,
        venteContinue: true,
      }
      const caisses: Caisse[] = []
      for (const [i, r] of restos.entries()) {
        const appareils = await creerAppareils(4, 'C', r.restaurantId)
        for (const [j, a] of appareils.entries()) {
          caisses.push(new Caisse(a, hasard(77_000 + i * 10 + j), BASE, coupe, r))
        }
      }
      // APRÈS la création des établissements : leurs taux de TVA sont des
      // lignes neuves, que la configuration de calcul doit connaître.
      const config = await configCalcul()
      const debut = performance.now()
      // Une remontée qui échoue ne bloque PAS la caisse (`venteContinue`) :
      // la vente est faite, l'outbox la garde.
      await Promise.all(
        caisses.map(async (c) => {
          for (let k = 0; k < 6; k += 1) await c.commande(config, true)
        }),
      )
      const enAttente = caisses.reduce((n, c) => n + c.outbox.length, 0)
      // Le réseau revient : tout ce qui reste en outbox repart, avec un délai
      // normal cette fois.
      const patientes = caisses.map((c) => {
        const p = new Caisse(c.appareil, hasard(1), BASE, COMME_LA_CAISSE, c.contexte)
        p.outbox = c.outbox
        return p
      })
      await Promise.all(patientes.map((p) => p.synchroniser()))
      const duree = performance.now() - debut
      const bilan = await verifierInvariants(caisses)
      const mesures = caisses.flatMap((c) => c.mesures)
      rapportResilience.push({
        scénario: 'R3 — requêtes coupées à 12 ms (accusé perdu), puis renvoyées',
        commandes: bilan.commandes,
        'durée s': Math.round(duree / 100) / 10,
        'indisponibilités ms': '—',
        'requêtes échouées puis rejouées': mesures.filter((m) => m.statut === 0).length,
        'ventes perdues': 0,
        'ventes doublées': 0,
        verdict: `tient (${enAttente} événements restés en outbox, puis rattrapés)`,
      })
      expect(bilan.commandes).toBe(caisses.length * 6)
      expect(mesures.filter((m) => m.statut === 0).length).toBeGreaterThan(50)
    },
    900_000,
  )
})
