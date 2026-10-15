#!/usr/bin/env node
/**
 * « Ouvrir mon restaurant » depuis la caisse — et SEULEMENT ce restaurant.
 *
 * PANNE SIGNALÉE. Après l'inscription, la prise de poste proposait Ahmed,
 * Karim et Salma : les employés de la graine de démonstration, rattachés à
 * Snack Lac 1. La base locale n'était jamais vidée, et le gérant n'avait pas
 * de PIN. Ce parcours vérifie les trois choses, avec un serveur simulé :
 *
 *   1. le PIN choisi part au serveur (qui le hache) ;
 *   2. les employés de démonstration ont DISPARU ;
 *   3. et ils ne REVIENNENT pas au rechargement — la graine se reposait sur
 *      une carte vide, en réécrivant l'identité de démonstration.
 *
 * Il faut la cible WEB (base persistée dans IndexedDB) : en `pos:dev`, la
 * base est en mémoire et chaque rechargement repart de zéro — le test
 * passerait alors même sans la correction.
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos build:web && pnpm --filter @kaissi/pos preview:web
 *   node apps/pos/tests/inscription-caisse.mjs
 */

import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:4173/'

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)
const page = await nav.newPage({ viewport: { width: 1280, height: 900 } })
const erreurs = []
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message))

const etape = async (nom, fn) => {
  try { await fn(); console.log(`✓ ${nom}`) }
  catch (e) { console.log(`✗ ${nom} — ${e.message.split('\n')[0]}`); await nav.close(); process.exit(1) }
}

let demande = null
await page.route('**/inscription', async (route) => {
  demande = JSON.parse(route.request().postData() || '{}')
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      jeton: 'kdev_inscription',
      deviceId: '0199f0aa-2222-7000-8000-abcdefabcdef',
      restaurantId: '0199f0aa-3333-7000-8000-abcdefabcdef',
      organizationId: '0199f0aa-4444-7000-8000-abcdefabcdef',
      nomEtablissement: 'Chez Fatma',
      prefixe: 'P9',
      employeId: '0199f0aa-5555-7000-8000-abcdefabcdef',
      aRegler: ['taux_de_taxe'],
      message: 'Restaurant « Chez Fatma » ouvert, et cette caisse y est rattachée.',
    }),
  })
})
// Le premier pull n'a pas lieu : c'est le pire cas, celui où la caisse
// redémarre AVANT d'avoir reçu son restaurant.
await page.route('**/sync/**', (route) => route.abort())

await page.goto(URL_POS, { waitUntil: 'networkidle' })

await etape('l’accueil propose de créer un compte', async () => {
  await page.waitForSelector('.bienvenue', { timeout: 20000 })
  await page.click('button:has-text("Créer un compte")')
  await page.waitForSelector('#insc-pin', { timeout: 10000 })
})

await etape('inscription avec un PIN de caisse', async () => {
  await page.fill('#insc-resto', 'Chez Fatma')
  await page.fill('#insc-gerant', 'Fatma Ben Salah')
  await page.fill('#insc-email', 'fatma@chezfatma.tn')
  await page.fill('#insc-mdp', 'unMotDePasseSolide')
  await page.fill('#insc-pin', '4826')
  await page.fill('#insc-pin2', '4826')
  await page.click('button:has-text("Ouvrir mon restaurant")')
  await page.waitForSelector('text=C’est ouvert', { timeout: 20000 })
  if (demande?.pin !== '4826') throw new Error(`le PIN n’est pas parti au serveur : ${JSON.stringify(demande)}`)
})

const aucunEmployeDeDemo = async () => {
  // D'abord PROUVER qu'on est sur la caisse rattachée — une absence de noms
  // sur l'écran d'accueil ne prouverait rien.
  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
  const texte = await page.textContent('body')
  for (const nom of ['Ahmed', 'Karim', 'Salma']) {
    if (texte.includes(nom)) throw new Error(`« ${nom} » (démonstration) est encore proposé`)
  }
}

await etape('les employés de démonstration ont disparu', async () => {
  await page.click('button:has-text("Commencer")')
  await page.waitForTimeout(1500)
  await aucunEmployeDeDemo()
})

await etape('ils ne reviennent pas au rechargement', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await aucunEmployeDeDemo()
})

await nav.close()
if (erreurs.length > 0) {
  console.log(`✗ erreurs de page :\n  ${erreurs.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✓ Inscription complète — la caisse appartient au nouveau restaurant.')
