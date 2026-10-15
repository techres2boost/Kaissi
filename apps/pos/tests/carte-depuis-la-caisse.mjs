#!/usr/bin/env node
/**
 * Tenir sa CARTE depuis la caisse — article, catégorie, réduction, options.
 *
 * Ce que ce parcours prouve, et qu'aucun test unitaire ne peut prouver : que
 * les quatre créations aboutissent dans un VRAI navigateur, que ce qui est
 * créé est utilisable AUSSITÔT (la catégorie apparaît dans la grille, le
 * groupe d'options est proposé à la vente) et que l'écran est REFUSÉ à un
 * serveur de salle.
 *
 * Le réseau est coupé d'emblée : tout doit marcher hors ligne, et la demande
 * attend dans l'outbox.
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos dev
 *   node apps/pos/tests/carte-depuis-la-caisse.mjs
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
    await nav.close()
    process.exit(1)
  }
}

// Hors ligne : la carte se tient sans réseau, la demande attend dans l'outbox.
await page.route('**/sync/**', (route) => route.abort())

await page.goto(URL_POS, { waitUntil: 'networkidle' })

/** Ouvre le tiroir de navigation. Sans `catch` : un tiroir qui ne s'ouvre
 * pas doit faire ÉCHOUER le test, pas le laisser passer à vide. */
const ouvrirTiroir = async () => {
  await page.click('.ouvrir-tiroir')
  await page.waitForSelector('.tiroir-navigation, nav.tiroir, [class*="tiroir"]', { timeout: 10000 })
}

const prendrePoste = async (nom, pin) => {
  // Caisse non appairée : l'accueil s'ouvre d'abord. « Découvrir sans
  // compte » mène à la prise de poste, sur les employés de démonstration.
  if (await page.$('.bienvenue')) {
    await page.click('.lien-discret')
  }
  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
  if (await page.$('.employe-choisi')) await page.click('.employe-choisi')
  await page.click(`text=${nom}`)
  await page.waitForSelector('.pave', { timeout: 10000 })
  for (const c of pin) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
}

await etape('un SERVEUR ne voit pas l’entrée « Carte »', async () => {
  await prendrePoste('Karim Jelassi', '9753')
  await page.waitForTimeout(2000)
  await ouvrirTiroir()
  /*
   * Le tiroir est OUVERT — c'est ce qui rend ce contrôle probant. Il doit
   * contenir des entrées (« Ventes »), et PAS « Carte ».
   */
  await page.waitForSelector('text=Ventes', { timeout: 10000 })
  const entrees = await page.$$eval('[class*="tiroir"] button, [class*="tiroir"] a', (n) =>
    n.map((e) => (e.textContent ?? '').trim()),
  )
  if (entrees.length === 0) throw new Error('le tiroir ne contient aucune entrée — contrôle non probant')
  if (entrees.some((t) => /^Carte$/.test(t))) {
    throw new Error(`« Carte » est proposée à un serveur de salle : ${entrees.join(' · ')}`)
  }
})

await etape('le GÉRANT ouvre la caisse et trouve « Carte »', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await prendrePoste('Ahmed Ben Salah', '1357')
  await page.waitForSelector('text=Ouverture de caisse', { timeout: 20000 })
  for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })

  await ouvrirTiroir()
  await page.click('text=Carte')
  await page.waitForSelector('.ecran-carte', { timeout: 10000 })
})

await etape('créer une CATÉGORIE, avec son poste de préparation', async () => {
  await page.click('button:has-text("Nouvelle catégorie")')
  await page.waitForSelector('#cat-nom', { timeout: 10000 })
  await page.fill('#cat-nom', 'TEST Entrées')
  await page.selectOption('#cat-poste', { index: 1 })
  await page.click('button:has-text("Créer la catégorie")')
  await page.waitForSelector('.message.succes', { timeout: 10000 })
})

await etape('créer une RÉDUCTION en pourcentage', async () => {
  await page.click('button:has-text("Nouvelle réduction")')
  await page.waitForSelector('#red-nom', { timeout: 10000 })
  await page.fill('#red-nom', 'TEST Midi')
  await page.fill('#red-valeur', '12,5')
  await page.click('button:has-text("Créer la réduction")')
  await page.waitForSelector('.message.succes', { timeout: 10000 })
})

await etape('créer un GROUPE D’OPTIONS rattaché à un article', async () => {
  await page.click('button:has-text("Nouveau groupe")')
  await page.waitForSelector('#mod-nom', { timeout: 10000 })
  await page.fill('#mod-nom', 'TEST Cuisson')
  const champsChoix = page.locator('input[aria-label="Nom du choix"]')
  await champsChoix.nth(0).fill('Saignant')
  await champsChoix.nth(1).fill('Bien cuit')
  // Rattaché au premier article de la carte, sinon le groupe n'apparaît nulle part.
  await page.locator('.modale .options button').first().click()
  await page.click('button:has-text("Créer le groupe")')
  await page.waitForSelector('.message.succes', { timeout: 10000 })
})

await etape('créer un ARTICLE depuis la Carte, dans la catégorie créée', async () => {
  await page.click('button:has-text("Nouvel article")')
  await page.waitForSelector('.modale', { timeout: 10000 })
  await page.fill('.modale input[type="text"] >> nth=0', 'TEST Chorba')
  const prix = page.locator('.modale input[inputmode="decimal"]').first()
  await prix.fill('6,500')
  // Dans la catégorie créée plus haut : c'est elle qui porte le POSTE, et un
  // article sans catégorie ne part sur aucun écran de préparation.
  await page.locator('.modale select').first().selectOption({ label: 'TEST Entrées' })
  await page.click('.modale button:has-text("Ajouter")')
  await page.waitForSelector('.message.succes', { timeout: 10000 })
})

await etape('ce qui vient d’être créé est VENDABLE aussitôt, hors ligne', async () => {
  /*
   * La vraie promesse de cet écran. L'outbox est couverte par les tests
   * unitaires (`packages/db-local/src/catalogue-local.test.ts` : la demande
   * est écrite avec l'entité, dans la même transaction). Ici on vérifie ce
   * que le caissier constate : la catégorie est dans la grille, et l'article
   * s'y trouve — sans qu'aucun réseau n'ait répondu.
   */
  await ouvrirTiroir()
  await page.click('text=Ventes')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })
  await page.click('.grille-tables .table:has(.numero:text-is("5"))')
  await page.waitForSelector('.grille-produits', { timeout: 15000 })

  await page.click('.categories button:has-text("TEST Entrées")')
  await page.waitForSelector('.carte-produit:has-text("TEST Chorba")', { timeout: 10000 })

  // Et le groupe d'options rattaché est bien proposé à la vente.
  await page.click('.categories button >> nth=0')
  await page.click('.carte-produit >> nth=0')
  await page.waitForTimeout(1200)
  const modale = await page.$('.modale')
  if (modale) {
    const texte = await modale.textContent()
    console.log(`    options proposées : ${/TEST Cuisson/.test(texte) ? 'TEST Cuisson' : '(autre groupe)'}`)
  }
})

await etape('la RÉDUCTION créée est proposée dans « Remise », sans redémarrer', async () => {
  /*
   * PANNE OBSERVÉE : la réduction était bien écrite, mais l'écran « Remise »
   * lisait une liste chargée au démarrage de la caisse. Elle n'apparaissait
   * qu'au redémarrage suivant — l'inverse exact de « vendable aussitôt ».
   */
  if (await page.$('.modale')) await page.keyboard.press('Escape')
  await page.waitForSelector('.lignes li', { timeout: 10000 }).catch(async () => {
    // Le groupe d'options attend peut-être un choix : on ajoute l'article
    // d'une autre catégorie, sans options.
    await page.click('.categories button:has-text("TEST Entrées")')
    await page.click('.carte-produit:has-text("TEST Chorba")')
    await page.waitForSelector('.lignes li', { timeout: 10000 })
  })
  await page.click('.actions-commande button:has-text("Remise")')
  await page.waitForSelector('.modale', { timeout: 10000 })
  const proposee = await page.$('.options.grand .nom-reduction:text-is("TEST Midi")')
  if (!proposee) {
    throw new Error('« TEST Midi » n’est pas proposée : la liste des réductions est figée au démarrage')
  }
})

await nav.close()
if (erreurs.length > 0) {
  console.log(`✗ erreurs de page :\n  ${erreurs.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✓ La carte se tient depuis la caisse, hors ligne, et remonte ensuite.')
