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

await etape('un CAISSIER ne voit pas « Nouvel article »', async () => {
  /*
   * Salma est caissière (graine de démonstration). La tuile d'ajout ne doit
   * pas être là — et ce n'est PAS ce qui protège : masquer un bouton évite
   * une erreur, pas une malveillance. Le refus qui compte est côté serveur,
   * où le rôle est relu en base (apps/sync/test/catalogue-depuis-la-caisse).
   * Les deux existent, aucune ne remplace l'autre.
   */
  if (await page.$('.carte-produit.nouvel-article')) {
    throw new Error('la tuile « Nouvel article » est visible pour un caissier')
  }
  console.log('    tuile absente pour Salma (caissière)')
})

await etape('ajout d’un Coca (sans option) — 1 clic', async () => {
  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 10000 })
})

await etape('la catégorie choisie TIENT — elle ne revient pas sur Plats', async () => {
  // Régression : la file d'impression pousse son état à intervalle régulier.
  // Chaque tic recréait l'objet de contexte, relançait l'effet de chargement
  // du catalogue, et remettait la catégorie sur la première. Le caissier
  // consultait « Boissons » et se retrouvait sur « Plats » sans avoir touché
  // à rien.
  const actuelle = () =>
    page.$eval('.categories button.actif', (b) => b.textContent.trim()).catch(() => null)

  if ((await actuelle()) !== 'Boissons') throw new Error('Boissons n’est pas la catégorie active')

  // Assez long pour couvrir plusieurs tics de la file d'impression.
  await page.waitForTimeout(6000)

  const apres = await actuelle()
  if (apres !== 'Boissons') {
    throw new Error(`la catégorie a basculé toute seule sur « ${apres} »`)
  }
  console.log('    toujours sur Boissons après 6 s')
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

await etape('envoi en cuisine — le bon s’affiche au lieu de s’imprimer', async () => {
  await page.click('.actions-commande button:has-text("Cuisine")')
  await page.waitForSelector('.modale:has-text("Envoyé en cuisine")', { timeout: 10000 })
  const bon = await page.textContent('.modale .ticket-ecran')
  console.log(`    bon de cuisine :\n${bon.split('\n').map((l) => `      ${l}`).join('\n')}`)
  await page.click('.modale .fermer')
})

await etape('remise « Happy hour » choisie dans le référentiel', async () => {
  await page.click('.actions-commande button:has-text("Remise")')
  // Les réductions de la maison s'affichent EN PREMIER : c'est le geste
  // normal. Elles nomment la décision, ce qu'un pourcentage anonyme ne fait
  // pas — et c'est ce nom que le rapport regroupe.
  await page.waitForSelector('.options.grand .nom-reduction', { timeout: 10000 })
  const proposees = await page.$$eval('.options.grand .nom-reduction', (n) =>
    n.map((e) => e.textContent.trim()),
  )
  console.log(`    réductions proposées : ${proposees.join(', ')}`)
  if (!proposees.includes('Happy hour')) {
    throw new Error('Le référentiel de réductions n’est pas descendu jusqu’à la caisse.')
  }
  await page.click('.options.grand button:has-text("Happy hour")')
  await page.waitForFunction(() => document.querySelector('.remise-appliquee') !== null, { timeout: 10000 })
  const remise = await page.textContent('.remise-appliquee span:last-child')
  console.log(`    remise : ${remise}`)
})

await etape('remise LIBRE de 50 % → escalade vers un manager', async () => {
  await page.click('.actions-commande button:has-text("Remise")')
  // La saisie libre reste accessible : le geste commercial n'entre dans
  // aucune case, et il se décide devant un client qui attend.
  await page.click('.modale button:has-text("Autre remise")')
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

await etape('clôture de la commande — le ticket client s’affiche', async () => {
  await page.click('.colonne-recap .principal.grand')
  await page.waitForSelector('.modale:has-text("Ticket client")', { timeout: 15000 })
  const ticket = await page.textContent('.modale .ticket-ecran')
  console.log(`    ticket client :\n${ticket.split('\n').map((l) => `      ${l}`).join('\n')}`)
  if (!ticket.includes('TOTAL')) throw new Error('le ticket ne porte pas de total')
  await page.click('.modale .principal')
  await page.waitForSelector('.grille-tables', { timeout: 15000 })
})

await etape('la vente apparaît dans « Reçus », sans rien demander au serveur', async () => {
  /*
   * Ce que ce pas prouve, et que rien d'autre ne prouve : l'historique de la
   * caisse se lit DANS LA BASE LOCALE. Le POS de ce test n'est appairé à
   * aucun serveur — s'il fallait une requête réseau pour remplir cet écran,
   * il serait vide ici, et le serait aussi chez un client hors ligne.
   */
  await page.click('.bandeau-actions .lien:has-text("Reçus")')
  await page.waitForSelector('.liste-recus li', { timeout: 10000 })
  const premier = await page.textContent('.liste-recus li')
  console.log(`    premier reçu : ${premier.replace(/\s+/g, ' ').trim()}`)

  /*
   * Et le marqueur « en attente ». C'est le seul écart qu'un système hors
   * ligne d'abord ne peut pas supprimer — il le NOMME. Sur une caisse non
   * appairée, aucun événement n'a de `server_seq` : tout est en attente.
   */
  const attente = await page.$('.liste-recus .badge.attente')
  if (!attente) {
    throw new Error(
      'Une vente jamais remontée doit porter « en attente » : sans ce marqueur, ' +
        'le gérant compare la caisse au back-office et cherche une panne.',
    )
  }
  console.log('    marquée « en attente » — l’écart avec le back-office est dit')

  await page.click('.recus .barre-salle .lien:has-text("Salle")')
  await page.waitForSelector('.grille-tables', { timeout: 10000 })
})

await etape('la table 3 est de nouveau libre', async () => {
  const libre = await page.$('.grille-tables .table:has(.numero:text-is("3")).libre')
  if (!libre) throw new Error('la table 3 est restée occupée')
})

await etape('un GÉRANT crée un article, et il est vendable aussitôt', async () => {
  /*
   * Le chemin local de bout en bout, dans un vrai navigateur : transaction
   * SQLite (l'article ET son entrée d'outbox, ou ni l'un ni l'autre), lecture
   * de l'état depuis l'outbox, affichage dans la carte.
   *
   * Ce POS n'est appairé à AUCUN serveur. C'est le point : l'article doit
   * exister et se vendre avant d'avoir vu le réseau — sinon la fonction ne
   * sert à rien le seul jour où l'on en a besoin.
   */
  await page.click('.bandeau-actions .employe')
  await page.waitForSelector('text=Prise de poste', { timeout: 10000 })
  await page.click('text=Ahmed')
  await page.waitForSelector('.pave', { timeout: 5000 })
  for (const c of '1357') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.grille-tables', { timeout: 20000 })

  await page.click('.barre-salle .principal')
  await page.waitForSelector('.grille-produits', { timeout: 10000 })

  const tuile = await page.$('.carte-produit.nouvel-article')
  if (!tuile) throw new Error('la tuile « Nouvel article » manque pour un gérant')

  await tuile.click()
  await page.waitForSelector('.formulaire-article', { timeout: 5000 })
  await page.fill('.formulaire-article input[type="text"]', 'Ojja du jour')
  await page.fill('.formulaire-article input[inputmode="decimal"]', '13,500')
  await page.click('.modale footer .principal')

  // Présent dans la carte, et marqué « en attente » : rien n'est encore parti.
  await page.waitForSelector('.carte-produit:has-text("Ojja du jour")', { timeout: 10000 })
  const marque = await page.$('.carte-produit:has-text("Ojja du jour") .badge.attente')
  if (!marque) {
    throw new Error(
      'Un article créé sur une caisse non appairée doit porter « en attente » : ' +
        'sans ce marqueur, le gérant le croit connu du back-office.',
    )
  }

  // Et il SE VEND. C'est la seule preuve qui compte.
  await page.click('.carte-produit:has-text("Ojja du jour")')
  await page.waitForSelector('.lignes li:has-text("Ojja du jour")', { timeout: 10000 })
  const total = await page.textContent('.grand-total span:last-child')
  console.log(`    « Ojja du jour » ajoutée à la commande — total ${total}`)
  if (!total.includes('13,500')) throw new Error(`prix inattendu : ${total}`)
})

await etape('aucune file d’impression : ce build n’imprime pas', async () => {
  const badge = await page.$('.badge-impression')
  if (badge) throw new Error("un badge d'impression est apparu alors que l'impression est éteinte")
  console.log('    aucun badge — rien n’attend une imprimante')
})

await nav.close()

if (erreurs.length > 0) {
  console.log('\n✗ Erreurs console :', erreurs.slice(0, 5))
  process.exit(1)
}
console.log('\n✓ Parcours complet — aucune erreur console.')
