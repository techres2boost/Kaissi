/**
 * La suppression de compte est-elle ATTEIGNABLE, et dit-elle la vérité ?
 *
 * ── Ce que ce parcours protège ────────────────────────────────────────────
 *
 * La règle 5.1.1(v) d'Apple ne demande pas qu'une route existe : elle
 * demande qu'un utilisateur puisse, DEPUIS l'application, arriver à l'écran
 * de suppression. Un test de service ne le prouve pas — il prouve que le
 * serveur répondrait si quelqu'un l'appelait. Ce parcours-ci vérifie le
 * reste : le lien est sur l'écran d'accueil, il ouvre un écran qui demande
 * les identifiants, et il ne supprime rien avant d'avoir montré ce qu'il
 * emporte.
 *
 * Le serveur n'est pas joignable ici (la caisse de test n'est appairée à
 * rien) : on s'arrête donc à la frontière du réseau, qui est exactement là
 * où s'arrête ce que l'interface doit garantir.
 */

import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:5173/'

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)
const page = await nav.newPage({ viewport: { width: 1280, height: 800 } })

const erreurs = []
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push(m.text())
})

let echecs = 0
async function etape(titre, action) {
  try {
    await action()
    console.log(`  ✓ ${titre}`)
  } catch (erreur) {
    echecs += 1
    console.log(`  ✗ ${titre}\n      ${erreur.message.split('\n')[0]}`)
  }
}

await page.goto(URL_POS, { waitUntil: 'networkidle' })

console.log('\nSuppression de compte — depuis la caisse\n')

await etape('l’écran d’accueil porte « Supprimer mon compte »', async () => {
  await page.waitForSelector('.bienvenue', { timeout: 15000 })
  const lien = page.locator('.bienvenue button:has-text("Supprimer mon compte")')
  await lien.waitFor({ state: 'visible', timeout: 10000 })
})

await etape('le lien ouvre l’écran, qui demande d’abord de s’identifier', async () => {
  await page.click('.bienvenue button:has-text("Supprimer mon compte")')
  await page.waitForSelector('#suppr-email', { timeout: 10000 })
  await page.waitForSelector('#suppr-mdp', { timeout: 5000 })
  const titre = await page.textContent('.carte-action h1')
  if (!titre.includes('Supprimer mon compte')) {
    throw new Error(`titre inattendu : ${titre}`)
  }
})

await etape('« Continuer » reste INACTIF tant que rien n’est saisi', async () => {
  const bouton = page.locator('.carte-action button.principal')
  if (!(await bouton.isDisabled())) throw new Error('le bouton est actif sans identifiants')
})

await etape('il s’active une fois les deux champs remplis', async () => {
  await page.fill('#suppr-email', 'quelqu-un@exemple.tn')
  await page.fill('#suppr-mdp', 'un-mot-de-passe')
  const bouton = page.locator('.carte-action button.principal')
  if (await bouton.isDisabled()) throw new Error('le bouton reste inactif')
})

await etape('l’écran dit que RIEN n’est supprimé à cette étape', async () => {
  const aide = await page.textContent('.carte-action .aide')
  if (!aide.includes('Rien n’est supprimé')) {
    throw new Error(`l’avertissement manque : ${aide}`)
  }
})

await etape('« ‹ Retour » ramène à l’accueil', async () => {
  await page.click('.carte-action .retour-accueil')
  await page.waitForSelector('.bienvenue-marque', { timeout: 10000 })
})

await etape('aucune erreur de console', async () => {
  // Les échecs réseau sont attendus : cette caisse n'est appairée à rien.
  const vraies = erreurs.filter(
    (e) => !/Failed to load resource|net::ERR|ERR_CONNECTION|fetch/i.test(e),
  )
  if (vraies.length > 0) throw new Error(vraies.join(' · '))
})

await nav.close()

if (echecs > 0) {
  console.log(`\n✗ ${echecs} étape(s) en échec.\n`)
  process.exit(1)
}
console.log('\n✓ La suppression de compte est atteignable depuis la caisse, et en deux temps.\n')
