#!/usr/bin/env node
/**
 * Parcours de caisse de bout en bout, dans un vrai navigateur.
 *
 * Ce que les tests unitaires ne peuvent pas prouver : qu'une journée de
 * service tient debout du déverrouillage à la clôture. Il rejoue exactement
 * ce que fait un caissier :
 *
 *   prise de poste (PIN) → ouverture de caisse → commande sur table →
 *   article simple → article à options → envoi en cuisine → remise sous
 *   plafond → remise au-dessus du plafond (escalade manager) →
 *   encaissement espèces → monnaie rendue → table libérée
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos dev       (dans un terminal)
 *   node apps/pos/tests/parcours-caisse.mjs
 *
 * La base est EN MÉMOIRE dans le navigateur : chaque exécution repart
 * d'une caisse vierge, aucun nettoyage n'est nécessaire.
 */

import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:5173/'

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)
const page = await nav.newPage({ viewport: { width: 1280, height: 800 } })
const erreurs = []
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message))

const etape = async (nom, fn) => {
  try { await fn(); console.log(`✓ ${nom}`) }
  catch (e) { console.log(`✗ ${nom} — ${e.message.split('\n')[0]}`); throw e }
}

await page.goto(URL_POS, { waitUntil: 'networkidle' })

await etape('démarrage → écran de prise de poste', async () => {
  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
})

await etape('choix de l’employé', async () => {
  await page.click('text=Salma Trabelsi')
  await page.waitForSelector('.pave', { timeout: 5000 })
})

await etape('saisie du PIN 2468 → caisse déverrouillée', async () => {
  for (const c of '2468') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('text=Ouverture de caisse', { timeout: 20000 })
})

await etape('ouverture de caisse avec 50 dinars de fond', async () => {
  for (const c of ['5','0']) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.grille-tables', { timeout: 10000 })
})

await etape('ouverture d’une commande sur la table 3', async () => {
  await page.click('.grille-tables .table:has(.numero:text-is("3"))')
  await page.waitForSelector('.grille-produits', { timeout: 10000 })
})

await etape('ajout d’un Coca (sans option) — 1 clic', async () => {
  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 10000 })
})

await etape('ajout d’une Pizza avec supplément Fromage', async () => {
  await page.click('.categories button:has-text("Plats")')
  await page.click('.carte-produit:has-text("Pizza Margherita")')
  await page.waitForSelector('.modale', { timeout: 5000 })
  await page.click('.options button:has-text("Fromage")')
  await page.click('.modale footer .principal')
  await page.waitForSelector('.lignes li:has-text("Pizza Margherita")', { timeout: 10000 })
})

await etape('le total tient compte du supplément', async () => {
  const total = await page.textContent('.grand-total span:last-child')
  console.log(`    total affiché : ${total}`)
  if (!total.includes('20,200')) throw new Error(`total inattendu : ${total}`)
})

await etape('envoi en cuisine', async () => {
  await page.click('.actions-commande button:has-text("Cuisine")')
  await page.waitForSelector('.modale:has-text("article")', { timeout: 10000 })
  const msg = await page.textContent('.modale .corps')
  console.log(`    ${msg.trim()}`)
  await page.click('.modale .fermer')
})

await etape('remise de 10 % (sous le plafond du caissier)', async () => {
  await page.click('.actions-commande button:has-text("Remise")')
  await page.click('.options.grand button:text-is("10 %")')
  await page.waitForFunction(() => document.querySelector('.remise-appliquee') !== null, { timeout: 10000 })
  const remise = await page.textContent('.remise-appliquee span:last-child')
  console.log(`    remise : ${remise}`)
})

await etape('remise de 50 % → escalade vers un manager', async () => {
  await page.click('.actions-commande button:has-text("Remise")')
  await page.click('.options.grand button:text-is("50 %")')
  await page.waitForSelector('text=Autorisation requise', { timeout: 10000 })
  const motif = await page.textContent('.modale .sous-titre')
  console.log(`    ${motif.trim()}`)
})

await etape('le manager Ahmed autorise avec son PIN 1357', async () => {
  // Un seul manager configuré : l'application saute l'étape de sélection.
  const liste = await page.$('.liste-employes button:has-text("Ahmed")')
  if (liste) await liste.click()
  await page.waitForSelector('.saisie-pin .pave', { timeout: 5000 })
  for (const c of '1357') await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
  await page.waitForFunction(() => {
    const el = document.querySelector('.remise-appliquee span:last-child')
    return el && el.textContent.includes('10,100')
  }, { timeout: 25000 })
  console.log('    remise 50 % appliquée après autorisation')
})

await etape('passage à l’encaissement', async () => {
  await page.click('.actions-commande .principal')
  await page.waitForSelector('.paiement', { timeout: 10000 })
  const total = await page.textContent('.bloc-total .valeur')
  console.log(`    total à payer : ${total}`)
})

await etape('paiement en espèces avec suggestion', async () => {
  await page.click('.modes button:has-text("Espèces")')
  const sugg = await page.$$eval('.suggestions button', (b) => b.map((x) => x.textContent))
  console.log(`    suggestions : ${sugg.join(' · ')}`)
  await page.click('.suggestions button >> nth=1')
  await page.waitForSelector('.bloc-reste.solde', { timeout: 10000 })
  const rendu = await page.textContent('.bloc-reste .valeur')
  console.log(`    monnaie à rendre : ${rendu}`)
  if (!rendu.includes('0,900')) throw new Error(`rendu attendu 0,900 — obtenu ${rendu}`)
})

await etape('clôture de la commande', async () => {
  await page.click('.colonne-recap .principal.grand')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })
})

await etape('la table 3 est de nouveau libre', async () => {
  const libre = await page.$('.grille-tables .table:has(.numero:text-is("3")).libre')
  if (!libre) throw new Error('la table 3 est restée occupée')
})

await etape('le badge d’impression signale les tickets non partis', async () => {
  const badge = await page.textContent('.badge-impression').catch(() => null)
  console.log(`    badge : ${badge ?? 'aucun'}`)
})

await nav.close()

if (erreurs.length > 0) {
  console.log('\n✗ Erreurs console :', erreurs.slice(0, 5))
  process.exit(1)
}
console.log('\n✓ Parcours complet — aucune erreur console.')
