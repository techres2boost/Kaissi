#!/usr/bin/env node
/**
 * Sonde EXTERNE de la production — lancée par GitHub Actions toutes les
 * 10 minutes (`.github/workflows/sonde-production.yml`).
 *
 * ── Pourquoi elle existe ──────────────────────────────────────────────────
 *
 * Le centre de supervision prévient quand le service va MAL. Il ne peut pas
 * prévenir quand le service est MORT, puisque c'est lui qui préviendrait.
 * Il faut un regard de l'extérieur — c'était le point 4 de l'audit de
 * lancement. GitHub Actions est cet extérieur : rien à souscrire, pas de
 * compte de plus, et gratuit sur un dépôt public.
 *
 * ── Ce qu'elle fait, et ce qu'elle coûte ──────────────────────────────────
 *
 * Deux requêtes GET par passage : `/sante` du service (qui vérifie la base
 * et le schéma) et la page de connexion du back-office. 288 requêtes par
 * jour au plus — rien, pour Railway comme pour la base. Un échec est
 * RÉESSAYÉ deux fois à 20 secondes d'intervalle avant d'être déclaré : un
 * redéploiement Railway dure quelques secondes et ne doit pas réveiller
 * quelqu'un.
 *
 * ── Qui est prévenu ───────────────────────────────────────────────────────
 *
 *   • GitHub lui-même : un workflow planifié en échec envoie un e-mail au
 *     compte qui a modifié le workflow en dernier ;
 *   • le webhook d'alerte (`SYNC_ALERTES_WEBHOOK`, secret du dépôt,
 *     facultatif), au CHANGEMENT d'état seulement — tombé, puis rétabli.
 *     Un service en panne une heure ne produit pas six messages, mais deux.
 *
 * Les adresses viennent de `apps/pos/deploiement.json`, la même source que
 * la caisse : la sonde surveille ce que les caisses appellent vraiment.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const deploiement = JSON.parse(readFileSync(join(racine, 'apps/pos/deploiement.json'), 'utf8'))

const service = (process.env.SONDE_URL_SYNC || deploiement.urlSync || '').replace(/\/+$/, '')
const backoffice = (process.env.SONDE_URL_BACKOFFICE ?? deploiement.urlBackOffice ?? '').replace(/\/+$/, '')
const essais = Number(process.env.SONDE_ESSAIS || 3)
const pauseMs = Number(process.env.SONDE_PAUSE_MS || 20_000)

/** Une cible : une adresse, et ce qu'une réponse saine doit contenir. */
const cibles = [
  {
    nom: 'Service de synchronisation',
    url: `${service}/sante`,
    saine: async (r) => {
      const corps = await r.json().catch(() => null)
      if (r.status === 200 && corps?.etat === 'ok') return null
      if (corps?.etat === 'schema_incomplet') {
        const m = (corps.migrationsManquantes ?? []).map((x) => x.migration).join(', ')
        return `migration(s) manquante(s) : ${m} — les ventes échouent tant qu'elles ne sont pas appliquées`
      }
      if (corps?.etat === 'degrade') return 'la base de données ne répond pas au service'
      return `HTTP ${r.status}`
    },
  },
  ...(backoffice
    ? [
        {
          nom: 'Back-office',
          url: `${backoffice}/connexion`,
          saine: async (r) => (r.status === 200 ? null : `HTTP ${r.status}`),
        },
      ]
    : []),
]

async function sonder(cible) {
  let derniere = ''
  for (let essai = 1; essai <= essais; essai += 1) {
    const debut = performance.now()
    try {
      const r = await fetch(cible.url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' })
      const probleme = await cible.saine(r)
      const ms = Math.round(performance.now() - debut)
      if (!probleme) return { ...cible, ok: true, ms, essais: essai }
      derniere = probleme
    } catch (erreur) {
      derniere = erreur?.name === 'TimeoutError' ? 'pas de réponse en 15 s' : `injoignable (${erreur?.cause?.code ?? erreur?.message ?? 'erreur'})`
    }
    if (essai < essais) await new Promise((f) => setTimeout(f, pauseMs))
  }
  return { ...cible, ok: false, probleme: derniere, essais }
}

/** La conclusion du passage PRÉCÉDENT — pour ne prévenir qu'au changement d'état. */
async function etatPrecedent() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return null
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/sonde-production.yml/runs?status=completed&per_page=5`,
      { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' } },
    )
    const { workflow_runs: runs = [] } = await r.json()
    const precedent = runs.find((x) => String(x.id) !== String(GITHUB_RUN_ID) && ['success', 'failure'].includes(x.conclusion))
    return precedent?.conclusion ?? null
  } catch {
    return null
  }
}

async function prevenir(texte) {
  const url = process.env.SYNC_ALERTES_WEBHOOK
  if (!url || !url.startsWith('https://')) return 'aucun webhook configuré'
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: texte, content: texte }),
      signal: AbortSignal.timeout(10_000),
    })
    // Le statut seul : le corps d'une erreur de webhook peut recopier l'adresse.
    return r.ok ? 'alerte envoyée' : `webhook en échec (HTTP ${r.status})`
  } catch {
    return 'webhook injoignable'
  }
}

const resultats = await Promise.all(cibles.map(sonder))
const enPanne = resultats.filter((r) => !r.ok)
for (const r of resultats) {
  console.log(r.ok ? `  ✓ ${r.nom} — ${r.ms} ms` : `  ✗ ${r.nom} — ${r.probleme} (${r.essais} essais)`)
}

const precedent = await etatPrecedent()
let alerte = 'pas de changement d’état'
if (enPanne.length > 0 && precedent !== 'failure') {
  alerte = await prevenir(
    [
      '⛔ Kaissi — PRODUCTION INJOIGNABLE (sonde externe)',
      ...enPanne.map((r) => `• ${r.nom} : ${r.probleme}`),
      'Les caisses continuent d’encaisser et gardent leurs ventes : elles partiront au retour du service.',
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
} else if (enPanne.length === 0 && precedent === 'failure') {
  alerte = await prevenir('✅ Kaissi — production rétablie (sonde externe) : service et back-office répondent.')
}
console.log(`  Alerte : ${alerte}`)

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ['| Cible | État | Détail |', '|---|---|---|',
      ...resultats.map((r) => `| ${r.nom} | ${r.ok ? '✅' : '⛔'} | ${r.ok ? `${r.ms} ms` : r.probleme} |`),
      '', `Alerte : ${alerte}`, ''].join('\n'),
  )
}
process.exit(enPanne.length > 0 ? 1 : 0)
