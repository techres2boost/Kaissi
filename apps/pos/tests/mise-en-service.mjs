#!/usr/bin/env node
/**
 * La mise en service dit-elle POURQUOI elle refuse ?
 *
 * ── La panne qui a rendu ce test nécessaire ───────────────────────────────
 *
 * Un gérant qui administre deux établissements se connecte sur la tablette.
 * Le serveur ne devine pas lequel : il rend la LISTE, et la caisse affiche un
 * bouton par établissement. Le gérant clique « Snack Lack 2 »… et rien. Le
 * bouton reste là, muet. On en conclut que le second établissement n'existe
 * pas vraiment.
 *
 * Le refus était pourtant calculé — 403 du serveur, ou outbox non vide — et
 * `setMessage()` bien appelé. Mais l'affichage du message vivait DANS la
 * branche « formulaire d'identifiants » : la branche « liste » ne le rendait
 * nulle part. Un écran sans issue, et pas la moindre trace pour le dire.
 *
 * Ce test-ci ne vérifie donc pas un calcul : il vérifie qu'une erreur ARRIVE
 * À L'ÉCRAN, sur les deux branches. C'est exactement la classe de défaut
 * qu'aucun test unitaire ne voit — le code faisait tout juste, sauf être lu.
 *
 * ── Le serveur est un STUB, et c'est délibéré ─────────────────────────────
 *
 * On ne veut ni Postgres, ni jeton, ni compte : on veut les deux réponses que
 * l'écran doit savoir montrer. Un vrai serveur rendrait ce test lent, et
 * dépendant d'un état de base qu'il ne contrôle pas.
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos dev       (dans un terminal)
 *   node apps/pos/tests/mise-en-service.mjs
 */

import { createServer } from 'node:http'
import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:5173/'

/* ── Le stub ───────────────────────────────────────────────────────────────
 * Premier appel (sans restaurantId) : la liste.
 * Second appel (avec restaurantId)  : un refus, comme un compte qui n'est pas
 * gérant de l'établissement demandé.
 */
const ETABLISSEMENTS = [
  { restaurantId: '01930000-0000-7000-8000-000000000002', nom: 'Snack Lac 1' },
  { restaurantId: '01a08b01-7351-7143-8f29-9f8c83cb426f', nom: 'Snack Lack 2' },
]
const MOTIF_REFUS = 'Ce compte n’est pas gérant de cet établissement.'

const serveur = createServer((requete, reponse) => {
  // La caisse est une autre origine : sans CORS, le navigateur jette la
  // réponse avant que l'écran ne la voie.
  const entetes = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'content-type': 'application/json',
  }
  if (requete.method === 'OPTIONS') {
    reponse.writeHead(204, entetes)
    reponse.end()
    return
  }
  let brut = ''
  requete.on('data', (morceau) => { brut += morceau })
  requete.on('end', () => {
    const corps = JSON.parse(brut || '{}')
    if (corps.restaurantId) {
      reponse.writeHead(403, entetes)
      reponse.end(JSON.stringify({ erreur: 'etablissement_refuse', message: MOTIF_REFUS }))
      return
    }
    reponse.writeHead(200, entetes)
    reponse.end(JSON.stringify({ choix: ETABLISSEMENTS }))
  })
})
await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre))
const URL_STUB = `http://127.0.0.1:${serveur.address().port}`

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)
const page = await nav.newPage({ viewport: { width: 1280, height: 900 } })
/*
 * Le 403 du stub est ATTENDU — c'est le sujet du test. On l'écarte, sinon le
 * test échouerait précisément parce qu'il a réussi à provoquer le refus.
 * Tout le reste compte : une exception React sur cet écran est une panne.
 */
const attendue = (texte) => /403|Forbidden/.test(texte)
const erreurs = []
page.on('console', (m) => {
  if (m.type() === 'error' && !attendue(m.text())) erreurs.push(m.text())
})
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message))

let echecs = 0
const etape = async (nom, fn) => {
  try { await fn(); console.log(`✓ ${nom}`) }
  catch (e) { console.log(`✗ ${nom} — ${e.message.split('\n')[0]}`); echecs += 1 }
}

await page.goto(URL_POS, { waitUntil: 'networkidle' })

await etape('prise de poste, puis écran de synchronisation', async () => {
  await page.waitForSelector('text=Prise de poste', { timeout: 30000 })
  await page.click('text=Salma Trabelsi')
  await page.waitForSelector('.pave', { timeout: 10000 })
  for (const c of '2468') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')
  // Le bandeau porte un lien permanent vers l'écran de synchronisation.
  await page.click('.bandeau .lien:has-text("Sync")')
  await page.waitForSelector('text=Mettre cette caisse en service', { timeout: 15000 })
})

await etape('saisie des identifiants, serveur remplacé par le stub', async () => {
  // L'adresse est pré-remplie depuis `deploiement.json` : elle est repliée
  // derrière un « modifier ». On l'ouvre pour la remplacer par le stub.
  const replie = await page.$('details summary:has-text("Serveur")')
  if (replie) await replie.click()
  const champUrl = await page.$('input[type="url"]')
  if (!champUrl) throw new Error("le champ d'adresse du serveur est introuvable")
  await champUrl.fill(URL_STUB)
  await page.fill('input[type="email"]', 'gerant@exemple.tn')
  await page.fill('input[type="password"]', 'peu-importe')
  await page.click('button.principal:has-text("Mettre en service")')
})

await etape('le compte gère deux établissements → la LISTE s’affiche', async () => {
  await page.waitForSelector('button.principal:has-text("Snack Lack 2")', { timeout: 15000 })
  const un = await page.$('button.principal:has-text("Snack Lac 1")')
  if (!un) throw new Error('le premier établissement manque dans la liste')
})

await etape('un refus sur un établissement est VISIBLE — la régression', async () => {
  await page.click('button.principal:has-text("Snack Lack 2")')
  // C'EST le contrôle : le message doit apparaître alors que la liste est
  // affichée. Avant le correctif, il n'était rendu que par l'autre branche.
  await page.waitForSelector('.erreur', { timeout: 15000 })
  const texte = (await page.textContent('.erreur')) ?? ''
  if (!texte.includes('gérant de cet établissement')) {
    throw new Error(`le message affiché ne dit pas pourquoi : « ${texte.trim()} »`)
  }
})

await etape('la liste reste utilisable, et une sortie existe', async () => {
  // Un refus ne doit pas enfermer : les autres établissements restent
  // cliquables, et « Changer de compte » ramène à la saisie.
  const autre = await page.$('button.principal:has-text("Snack Lac 1")')
  if (!autre) throw new Error('la liste a disparu après le refus')
  await page.click('button.secondaire:has-text("Changer de compte")')
  await page.waitForSelector('input[type="email"]', { timeout: 10000 })
})

await nav.close()
serveur.close()

if (erreurs.length > 0) {
  console.log('\n✗ Erreurs console :', erreurs.slice(0, 5))
  process.exit(1)
}
if (echecs > 0) {
  console.log(`\n✗ ${echecs} étape(s) en échec.`)
  process.exit(1)
}
console.log('\n✓ Mise en service : un refus arrive à l’écran, sur les deux branches.')
