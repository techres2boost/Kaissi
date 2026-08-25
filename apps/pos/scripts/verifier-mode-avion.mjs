#!/usr/bin/env node
/**
 * Vérificateur de MODE AVION.
 *
 * Le critère de sortie de la Phase 0 est vérifiable automatiquement : le
 * bundle empaqueté dans l'APK ne doit contenir AUCUNE dépendance réseau.
 * Ce script tourne en CI après `vite build` et échoue si quelqu'un
 * réintroduit, même par accident :
 *
 *   • un `server.url` dans capacitor.config.ts (le pattern Stampi) ;
 *   • un script, une police ou une feuille de style distants dans index.html ;
 *   • une URL de CDN dans le JavaScript livré.
 *
 * Sans ce garde-fou, la règle « jamais de server.url » n'est qu'un
 * commentaire — et les commentaires ne cassent pas la CI.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(racine, 'dist')

const echecs = []
const controles = []

const controler = (nom, ok, detail) => {
  controles.push({ nom, ok, detail })
  if (!ok) echecs.push(`${nom} — ${detail}`)
}

// ── 1. capacitor.config.ts ne doit contenir aucune URL de serveur ──────────
const config = readFileSync(join(racine, 'capacitor.config.ts'), 'utf8')
// On ignore les lignes de commentaire : la config en contient qui EXPLIQUENT
// pourquoi `server.url` est interdit.
const configSansCommentaires = config
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n')
controler(
  'capacitor.config.ts sans server.url',
  !/\bserver\s*:/.test(configSansCommentaires) && !/\burl\s*:/.test(configSansCommentaires),
  'un bloc `server` ou une clé `url` a été réintroduit : la WebView chargerait ' +
    "du code distant et l'application ne s'ouvrirait plus sans réseau",
)

// ── 2. Le bundle doit exister ─────────────────────────────────────────────
let fichiers = []
try {
  const parcourir = (repertoire) => {
    for (const entree of readdirSync(repertoire)) {
      const chemin = join(repertoire, entree)
      if (statSync(chemin).isDirectory()) parcourir(chemin)
      else fichiers.push(chemin)
    }
  }
  parcourir(dist)
} catch {
  console.error("✗ dist/ est absent — lancez `pnpm build` avant la vérification.")
  process.exit(1)
}
controler('bundle présent', fichiers.length > 0, 'dist/ est vide')

// ── 3. index.html ne référence aucune ressource distante ──────────────────
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const balisesDistantes = [...html.matchAll(/<(?:script|link)[^>]*?(?:src|href)=["'](https?:)?\/\/[^"']+["'][^>]*>/gi)]
controler(
  'index.html 100 % local',
  balisesDistantes.length === 0,
  `${balisesDistantes.length} ressource(s) distante(s) : ${balisesDistantes.map((m) => m[0]).join(', ')}`,
)

// ── 4. Aucune URL de CDN dans le JavaScript livré ─────────────────────────
// Les sourcemaps ne partent pas sur l'appareil : on ne les inspecte pas.
// Les espaces de noms XML (www.w3.org) ne sont jamais téléchargés.
const HOTES_AUTORISES = [
  'www.w3.org',        // espaces de noms SVG / MathML, jamais requêtés
  'react.dev',         // texte de message d'erreur React
  'capacitorjs.com',   // texte de message d'erreur Capacitor
  'localhost',         // développement uniquement, autorisé par la CSP
]
const suspectes = new Set()
for (const fichier of fichiers) {
  if (extname(fichier) !== '.js') continue
  const contenu = readFileSync(fichier, 'utf8')
  for (const m of contenu.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    const hote = m[1].toLowerCase()
    if (!HOTES_AUTORISES.some((a) => hote === a || hote.endsWith(`.${a}`))) {
      suspectes.add(hote)
    }
  }
}
controler(
  'aucune URL distante dans le JS livré',
  suspectes.size === 0,
  `hôte(s) inattendu(s) : ${[...suspectes].join(', ')}`,
)

// ── 5. Aucune clé Supabase embarquée ──────────────────────────────────────
// Le POS n'a que son jeton d'appareil. La clé service-role, jamais.
let secrets = 0
for (const fichier of fichiers) {
  if (extname(fichier) !== '.js' && extname(fichier) !== '.html') continue
  const contenu = readFileSync(fichier, 'utf8')
  // JWT Supabase (eyJ…) ou clés au format moderne.
  if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(contenu)) secrets += 1
  if (/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/.test(contenu)) secrets += 1
  if (/service_role/.test(contenu)) secrets += 1
}
controler(
  'aucune clé Supabase dans le bundle',
  secrets === 0,
  `${secrets} occurrence(s) de jeton ou de clé détectée(s)`,
)

// ── Rapport ───────────────────────────────────────────────────────────────
console.log('\nVérification du mode avion — bundle POS Kaissi\n')
for (const c of controles) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.nom}${c.ok ? '' : `\n      ${c.detail}`}`)
}

const octets = fichiers
  .filter((f) => !f.endsWith('.map'))
  .reduce((total, f) => total + statSync(f).size, 0)
console.log(`\n  Bundle embarqué : ${(octets / 1024).toFixed(1)} Kio (hors sourcemaps)`)

if (echecs.length > 0) {
  console.error(`\n✗ ${echecs.length} contrôle(s) en échec. Le mode avion n'est PAS garanti.\n`)
  process.exit(1)
}
console.log('\n✓ Le bundle ne dépend d\'aucune ressource réseau.\n')
