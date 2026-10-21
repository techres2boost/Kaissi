#!/usr/bin/env node
/**
 * Les gestes RARES d'une commande — dans un VRAI navigateur, réseau coupé.
 *
 * Ce que ce parcours prouve :
 *   • une table ouverte PAR ERREUR se libère sans code de gérant, et
 *     redevient « libre » en salle ;
 *   • une commande change de table, et l'ancienne se libère ;
 *   • un article à PRIX LIBRE s'ajoute au ticket, au montant saisi ;
 *   • une commande avec des articles ne s'annule QUE sous le PIN d'un
 *     gérant — et sa table se libère ensuite.
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos dev
 *   node apps/pos/tests/gestes-commande.mjs
 */

import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:5173/'

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)
const page = await nav.newPage({ viewport: { width: 1280, height: 900 } })
const erreurs = []
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message))

const etape = async (nom, fn) => {
  try { await fn(); console.log(`✓ ${nom}`) }
  catch (e) {
    console.log(`✗ ${nom} — ${e.message.split('\n')[0]}`)
    if (process.env.CAPTURE_ECHEC) await page.screenshot({ path: process.env.CAPTURE_ECHEC }).catch(() => {})
    await nav.close()
    process.exit(1)
  }
}

await page.route('**/sync/**', (route) => route.abort())
await page.goto(URL_POS, { waitUntil: 'networkidle' })

const pin = async (code) => {
  for (const c of code) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
}
const table = (numero) => `.grille-tables .table:has(.numero:text-is("${numero}"))`
const etatTable = async (numero) =>
  (await page.getAttribute(table(numero), 'class')).includes('occupee') ? 'occupée' : 'libre'
const retourSalle = async () => {
  await page.click('.entete-ticket .retour')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })
}

await etape('Karim (serveur) prend son poste', async () => {
  if (await page.$('.bienvenue')) await page.click('.lien-discret')
  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
  await page.click('text=Karim Jelassi')
  await page.waitForSelector('.pave', { timeout: 10000 })
  await pin('9753')
  // Un serveur n'ouvre pas la caisse ; si l'écran le demande quand même,
  // on saisit un fond pour avancer.
  await page.waitForSelector('.grille-tables, :text("Ouverture de caisse")', { timeout: 20000 })
  if (await page.$('text=Ouverture de caisse')) {
    for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
    await page.click('.pave .valider')
    await page.waitForSelector('.grille-tables', { timeout: 20000 })
  }
})

await etape('la table 7 ouverte par erreur se libère SANS code de gérant', async () => {
  await page.click(table('7'))
  await page.waitForSelector('.grille-produits', { timeout: 15000 })
  await retourSalle()
  if ((await etatTable('7')) !== 'occupée') throw new Error('la table 7 devrait paraître occupée')
  await page.click(table('7'))
  await page.waitForSelector('.actions-commande .plus', { timeout: 15000 })
  await page.click('.actions-commande .plus')
  await page.click('.modale .autres-actions button:has-text("Libérer la table")')
  await page.click('.modale footer .principal:has-text("Libérer la table")')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })
  if (await page.$('text=Autorisation requise')) throw new Error('un PIN de gérant a été demandé')
  if ((await etatTable('7')) !== 'libre') throw new Error('la table 7 est restée occupée')
})

await etape('un article à prix libre s’ajoute au montant saisi', async () => {
  await page.click(table('5'))
  await page.waitForSelector('.grille-produits', { timeout: 15000 })
  await page.click('.carte-produit.prix-libre')
  await page.fill('.modale input[inputmode="decimal"]', '7,5')
  await page.fill('.modale input[placeholder="Divers"]', 'Bouteille réserve')
  const bouton = await page.textContent('.modale footer .principal')
  if (!/7,500/.test(bouton)) throw new Error(`le bouton annonce « ${bouton} »`)
  await page.click('.modale footer .principal')
  await page.waitForSelector('.lignes li:has-text("Bouteille réserve")', { timeout: 10000 })
})

await etape('la commande passe de la table 5 à la table 6', async () => {
  await page.click('.actions-commande .plus')
  await page.click('.modale .autres-actions button:has-text("Changer de table")')
  await page.waitForSelector('.grille-tables-choix', { timeout: 10000 })
  await page.click('.grille-tables-choix button:has(.numero:text-is("6"))')
  await page.waitForFunction(
    () => /Table 6/.test(document.querySelector('.entete-ticket .titre')?.textContent ?? ''),
    null,
    { timeout: 10000 },
  )
  await retourSalle()
  if ((await etatTable('5')) !== 'libre') throw new Error('la table 5 est restée occupée')
  if ((await etatTable('6')) !== 'occupée') throw new Error('la table 6 n’a pas reçu la commande')
})

await etape('l’annulation d’une commande avec articles exige le PIN d’un gérant', async () => {
  await page.click(table('6'))
  await page.waitForSelector('.actions-commande .plus', { timeout: 15000 })
  await page.click('.actions-commande .plus')
  await page.click('.modale .autres-actions button:has-text("Annuler la commande")')
  await page.click('.modale .options button:has-text("Client parti")')
  await page.waitForSelector('text=Autorisation requise', { timeout: 10000 })
  const liste = await page.$('.liste-employes button:has-text("Ahmed")')
  if (liste) await liste.click()
  await page.waitForSelector('.saisie-pin .pave', { timeout: 10000 })
  await pin('1357')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })
  if ((await etatTable('6')) !== 'libre') throw new Error('la table 6 est restée occupée après annulation')
})

await nav.close()
if (erreurs.length > 0) {
  console.log(`✗ erreurs de page :\n  ${erreurs.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✓ Gestes de commande : libérer, changer de table, prix libre, annuler — hors ligne.')
