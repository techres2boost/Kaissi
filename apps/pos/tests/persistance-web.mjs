#!/usr/bin/env node
/**
 * La cible web perd-elle les ventes au rechargement ?
 *
 * C'est LA question à laquelle la cible `web` doit répondre avant d'être
 * utilisable en production. `pnpm pos:dev` ne prouve rien : sa base est en
 * mémoire et n'a jamais prétendu survivre. Ici on teste le bundle web réel,
 * servi comme il le sera sur Vercel, avec SQLite persisté dans IndexedDB.
 *
 * Le scénario est le pire cas réaliste : le navigateur de la caisse plante
 * ou l'onglet est rechargé en plein service, caisse ouverte.
 *
 *   prise de poste → ouverture de caisse avec 50 dinars → commande sur la
 *   table 3 → RECHARGEMENT COMPLET → la caisse est toujours ouverte et la
 *   commande toujours sur la table.
 *
 * Si l'un de ces deux points échoue, la cible web ne doit PAS partir en
 * production : il faut l'APK.
 *
 * Lancement :
 *   pnpm pos:build:web
 *   pnpm --filter @kaissi/pos preview:web     (dans un terminal)
 *   node apps/pos/tests/persistance-web.mjs
 */

import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:4173/'

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)
// Un CONTEXTE persistant n'est pas nécessaire : le rechargement se fait dans
// le même contexte, et c'est bien IndexedDB qu'on veut éprouver, pas le
// profil du navigateur.
const page = await nav.newPage({ viewport: { width: 1280, height: 800 } })
const erreurs = []
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message))

const etape = async (nom, fn) => {
  try { await fn(); console.log(`✓ ${nom}`) }
  catch (e) { console.log(`✗ ${nom} — ${e.message.split('\n')[0]}`); await nav.close(); process.exit(1) }
}

const prendrePoste = async () => {
  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
  await page.click('text=Salma Trabelsi')
  await page.waitForSelector('.pave', { timeout: 10000 })
  for (const c of '2468') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')
}

await page.goto(URL_POS, { waitUntil: 'networkidle' })

await etape('le bundle web démarre et ouvre une base persistante', async () => {
  await page.waitForSelector('text=Prise de poste', { timeout: 30000 })
  // Le bandeau n'affiche « démo — mémoire » que si la base ne persiste pas.
  const demo = await page.$('.etiquette-demo')
  if (demo) throw new Error('la base est en MÉMOIRE — le bundle n’a pas été construit pour la cible web')
})

await etape('prise de poste et ouverture de caisse avec 50 dinars', async () => {
  await prendrePoste()
  await page.waitForSelector('text=Ouverture de caisse', { timeout: 20000 })
  for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })
})

await etape('commande sur la table 3 avec un Coca', async () => {
  await page.click('.grille-tables .table:has(.numero:text-is("3"))')
  await page.waitForSelector('.grille-produits', { timeout: 15000 })
  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 15000 })
})

await etape('RECHARGEMENT COMPLET de la page', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await prendrePoste()
})

await etape('la caisse est TOUJOURS ouverte — le shift a survécu', async () => {
  // Si le shift avait disparu, l'application redemanderait le fond de caisse.
  await page.waitForSelector('.grille-tables', { timeout: 20000 })
  const ouverture = await page.$('text=Ouverture de caisse')
  if (ouverture) throw new Error('la caisse redemande un fond : le shift a été perdu')
})

await etape('la commande est TOUJOURS sur la table 3', async () => {
  const occupee = await page.$('.grille-tables .table:has(.numero:text-is("3")).occupee')
  if (!occupee) throw new Error('la table 3 est redevenue libre : la commande a été perdue')
  await page.click('.grille-tables .table:has(.numero:text-is("3"))')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 15000 })
})

await nav.close()

if (erreurs.length > 0) {
  console.log('\n✗ Erreurs console :', erreurs.slice(0, 5))
  process.exit(1)
}
console.log('\n✓ Cible web : la caisse survit à un rechargement complet.')
