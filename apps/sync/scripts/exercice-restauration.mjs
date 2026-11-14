#!/usr/bin/env node
/**
 * Exercice de RESTAURATION — une sauvegarde qu'on n'a jamais restaurée
 * n'est pas une sauvegarde, c'est un espoir.
 *
 * L'audit de lancement l'avait écrit en toutes lettres (§ 6, point 5) :
 * « Sauvegardes jamais restaurées. » Ce script fait l'exercice de bout en
 * bout, et il ÉCHOUE si quoi que ce soit ne revient pas à l'identique :
 *
 *   1. il relève, sur la SOURCE, le nombre de lignes de chaque table du
 *      schéma `kaissi` et les sommes d'argent (ventes, paiements) ;
 *   2. il en fait une copie (`pg_dump`, format personnalisé) ;
 *   3. il la restaure dans une base JETABLE, créée pour l'occasion ;
 *   4. il compare : mêmes tables, mêmes nombres de lignes, mêmes sommes au
 *      millime, chaîne du journal d'audit INTACTE (`verifie_chaine_audit`,
 *      chaque chaîne recalculée maillon par maillon) ;
 *   5. il démarre le SERVICE DE SYNCHRONISATION sur la base restaurée et
 *      exige que `/sante` réponde « ok » — schéma complet, base joignable :
 *      la copie est une base sur laquelle on peut REPRENDRE le service ;
 *   6. il supprime la base jetable (sauf `--garder`).
 *
 * Il ne modifie JAMAIS la source : `pg_dump` lit, et les relevés sont des
 * `select`. Il lit le minimum de `auth.users` : les identifiants seuls, ni
 * adresse ni mot de passe — juste ce qu'il faut pour que les clés
 * étrangères vers `auth.users` se recréent.
 *
 * Utilisation (source = la production, par la chaîne de connexion DIRECTE
 * ou le « session pooler » de Supabase — pas le pooler en mode transaction,
 * que pg_dump ne sait pas utiliser) :
 *
 *   node apps/sync/scripts/exercice-restauration.mjs \
 *     --source "postgresql://postgres.xxxx:MOT_DE_PASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
 *     --cible  "postgresql://postgres@127.0.0.1:5433/postgres"
 *
 * `--cible` est un serveur PostgreSQL LOCAL où l'on a le droit de créer une
 * base (celui de `pnpm db:test` convient). La base restaurée s'y appelle
 * `kaissi_restauration_<date>`. ⚑ Le pg_dump local doit être d'une version
 * majeure supérieure ou égale à celle de la source (Supabase : 15 ou 17).
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ici = dirname(fileURLToPath(import.meta.url))
const racineSync = join(ici, '..')

function argument(nom) {
  const i = process.argv.indexOf(`--${nom}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const source = argument('source') ?? process.env['RESTAURATION_SOURCE']
const cibleAdmin = argument('cible') ?? process.env['RESTAURATION_CIBLE'] ?? 'postgresql://postgres@127.0.0.1:5433/postgres'
const garder = process.argv.includes('--garder')
if (!source) {
  console.error('Usage : exercice-restauration.mjs --source <URL de la base à sauvegarder> [--cible <serveur local>] [--garder]')
  process.exit(2)
}

const etapes = []
const debutTotal = performance.now()
function etape(nom, ok, detail = '') {
  etapes.push({ nom, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`)
}
/** Une URL sans son mot de passe — pour les journaux. */
const masquer = (url) => url.replace(/\/\/([^:@/]+):[^@]*@/, '//$1:‹secret›@')

async function avecClient(url, travail) {
  const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
  await c.connect()
  try {
    return await travail(c)
  } finally {
    await c.end()
  }
}

/** Le relevé : nombre de lignes par table, sommes d'argent, chaînes d'audit. */
async function releve(c) {
  const { rows: tables } = await c.query(
    `select table_name from information_schema.tables
      where table_schema = 'kaissi' and table_type = 'BASE TABLE' order by 1`,
  )
  const lignes = {}
  for (const { table_name: t } of tables) {
    const { rows } = await c.query(`select count(*)::bigint as n from kaissi.${pg.escapeIdentifier(t)}`)
    lignes[t] = Number(rows[0].n)
  }
  const { rows: [argent] } = await c.query(
    `select (select coalesce(sum(total_millimes), 0) from kaissi.orders)::text as ventes,
            (select coalesce(sum(amount_millimes), 0) from kaissi.payments)::text as paiements,
            (select count(distinct chain_key) from kaissi.audit_events)::int as chaines`,
  )
  return { lignes, ventes: argent.ventes, paiements: argent.paiements, chaines: argent.chaines }
}

const horodatage = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const nomBase = `kaissi_restauration_${horodatage}`
const cibleBase = (() => {
  const u = new URL(cibleAdmin)
  u.pathname = `/${nomBase}`
  return u.toString()
})()
const dossier = mkdtempSync(join(tmpdir(), 'kaissi-restauration-'))
const fichier = join(dossier, 'kaissi.dump')
let baseCreee = false
let code = 1

try {
  console.log(`\n  Exercice de restauration — source ${masquer(source)}\n`)

  // 1. Le relevé de la SOURCE, et les identifiants de comptes (rien d'autre).
  const avant = await avecClient(source, releve)
  const comptes = await avecClient(source, async (c) => (await c.query('select id from auth.users')).rows.map((r) => r.id))
  // Les rôles cités par les politiques RLS (kaissi_device…) : ce sont des
  // objets du SERVEUR, pas du schéma, donc absents de la copie. Sans eux,
  // la première politique fait échouer toute la restauration.
  const roles = await avecClient(source, async (c) =>
    (await c.query(
      `select distinct r::text as role from pg_policies, unnest(roles) r
        where schemaname = 'kaissi' and r::text <> 'public'`,
    )).rows.map((r) => r.role),
  )
  const totalLignes = Object.values(avant.lignes).reduce((a, b) => a + b, 0)
  etape('Relevé de la source', true, `${Object.keys(avant.lignes).length} tables, ${totalLignes} lignes, ${avant.chaines} chaîne(s) d'audit`)

  // 2. La copie.
  const t0 = performance.now()
  const dump = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=kaissi', `--file=${fichier}`, source], {
    encoding: 'utf8',
  })
  if (dump.status !== 0) throw new Error(`pg_dump a échoué : ${masquer(dump.stderr.trim())}`)
  etape('Copie (pg_dump)', true, `${(statSync(fichier).size / 1024 / 1024).toFixed(1)} Mo en ${Math.round(performance.now() - t0)} ms`)

  // 3. La base jetable : le socle Supabase (rôles, schéma auth, extensions),
  //    les identifiants de comptes, puis la copie.
  await avecClient(cibleAdmin, (c) => c.query(`create database ${pg.escapeIdentifier(nomBase)}`))
  baseCreee = true
  await avecClient(cibleAdmin, async (c) => {
    for (const role of roles) {
      const { rowCount } = await c.query('select 1 from pg_roles where rolname = $1', [role])
      if (!rowCount) await c.query(`create role ${pg.escapeIdentifier(role)} nologin noinherit`)
    }
  })
  await avecClient(cibleBase, async (c) => {
    await c.query(readFileSync(join(racineSync, 'test/amorce-supabase.sql'), 'utf8'))
    for (let i = 0; i < comptes.length; i += 1000) {
      await c.query('insert into auth.users (id) select unnest($1::uuid[]) on conflict do nothing', [comptes.slice(i, i + 1000)])
    }
  })
  const t1 = performance.now()
  // Déclencheurs coupés pendant le chargement : le journal d'audit garde ses
  // empreintes d'ORIGINE (le déclencheur de chaînage les recalculerait), et
  // les blocages d'insertion seule ne s'appliquent pas à une restauration.
  const restauration = spawnSync(
    'pg_restore',
    ['--no-owner', '--no-privileges', '--disable-triggers', '--exit-on-error', `--dbname=${cibleBase}`, fichier],
    { encoding: 'utf8' },
  )
  if (restauration.status !== 0) throw new Error(`pg_restore a échoué : ${restauration.stderr.trim().slice(0, 800)}`)
  etape('Restauration (pg_restore)', true, `${Math.round(performance.now() - t1)} ms`)

  // 4. La comparaison.
  const apres = await avecClient(cibleBase, releve)
  const ecarts = Object.keys({ ...avant.lignes, ...apres.lignes }).filter((t) => avant.lignes[t] !== apres.lignes[t])
  etape(
    'Mêmes tables, mêmes nombres de lignes',
    ecarts.length === 0,
    ecarts.length === 0 ? `${totalLignes} lignes` : ecarts.map((t) => `${t} : ${avant.lignes[t] ?? 'absente'} → ${apres.lignes[t] ?? 'absente'}`).join(', '),
  )
  etape('Ventes au millime', avant.ventes === apres.ventes, `${apres.ventes} millimes`)
  etape('Paiements au millime', avant.paiements === apres.paiements, `${apres.paiements} millimes`)

  const ruptures = await avecClient(cibleBase, async (c) => {
    const { rows } = await c.query(
      `select k.chain_key, v.probleme
         from (select distinct chain_key from kaissi.audit_events) k,
              lateral kaissi.verifie_chaine_audit(k.chain_key) v
        where not v.valide`,
    )
    return rows
  })
  etape(
    'Journal d’audit : chaque chaîne recalculée',
    ruptures.length === 0,
    ruptures.length === 0 ? `${apres.chaines} chaîne(s) intacte(s)` : ruptures.map((r) => `${r.chain_key} : ${r.probleme}`).join(' ; '),
  )

  // 5. Le service repart-il sur la copie ?
  const port = 20000 + Math.floor(Math.random() * 20000)
  const service = spawn(process.execPath, ['--experimental-strip-types', '--import', './scripts/charger-ts.mjs', 'src/index.ts'], {
    cwd: racineSync,
    env: {
      ...process.env,
      DATABASE_URL: cibleBase,
      // La base jetable est LOCALE, sans TLS ; la production, elle, l'exige.
      DATABASE_SSL: /localhost|127\.0\.0\.1/.test(cibleBase) ? 'false' : (process.env['DATABASE_SSL'] ?? ''),
      SYNC_PORT: String(port),
      SYNC_SUPERVISION: '0',
      SYNC_REPARATION: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let sortie = ''
  service.stdout.on('data', (d) => (sortie += d))
  service.stderr.on('data', (d) => (sortie += d))
  let sante = null
  for (let i = 0; i < 60 && !sante; i += 1) {
    await new Promise((f) => setTimeout(f, 500))
    try {
      const r = await fetch(`http://127.0.0.1:${port}/sante`)
      sante = { statut: r.status, corps: await r.json() }
    } catch {
      // Le service démarre encore.
    }
  }
  service.kill('SIGTERM')
  etape(
    'Le service démarre sur la copie, /sante répond « ok »',
    sante?.statut === 200 && sante.corps?.etat === 'ok',
    sante ? `HTTP ${sante.statut} ${JSON.stringify(sante.corps).slice(0, 200)}` : `aucune réponse — ${sortie.slice(-400)}`,
  )

  code = etapes.every((e) => e.ok) ? 0 : 1
} catch (erreur) {
  etape('Exercice interrompu', false, erreur instanceof Error ? erreur.message : String(erreur))
} finally {
  rmSync(dossier, { recursive: true, force: true })
  if (baseCreee && !garder) {
    await avecClient(cibleAdmin, (c) => c.query(`drop database if exists ${pg.escapeIdentifier(nomBase)} with (force)`)).catch(() => undefined)
  }
}

const duree = Math.round((performance.now() - debutTotal) / 1000)
console.log(
  code === 0
    ? `\n  ✓ RESTAURATION VÉRIFIÉE en ${duree} s.${garder ? ` Base conservée : ${nomBase}` : ''}\n`
    : `\n  ✗ RESTAURATION EN ÉCHEC (${duree} s) — voir les lignes ✗ ci-dessus.\n`,
)
process.exit(code)
