#!/usr/bin/env node
/**
 * Les captures d'écran des fiches de magasin — prises dans la VRAIE application.
 *
 * ── « Comment je fais, je n'ai pas encore l'appli sur un téléphone ? » ─────
 *
 * On n'en a pas besoin. Kaissi a deux cibles de build qui servent le MÊME
 * bundle : `android` l'empaquette dans l'APK, `web` le sert comme site
 * statique. Les captures prises sur la cible web montrent donc, au pixel
 * près, ce que le magasin installera — ce ne sont pas des maquettes.
 *
 * C'est aussi ce que demandent les magasins : une capture doit montrer
 * l'application telle qu'elle est. Une image retouchée, ou un rendu
 * d'écran fabriqué dans un outil de dessin, est un motif de refus.
 *
 * ── Le piège de la base en mémoire ───────────────────────────────────────
 *
 * `pnpm pos:dev` travaille sur une base EN MÉMOIRE et affiche, à côté du nom
 * de l'établissement, une étiquette « démo — mémoire ». Sur une fiche Play,
 * c'est exactement la mention qu'il ne faut pas : elle dit au visiteur que ce
 * qu'il regarde n'est pas une caisse. Ce script part donc du build `web`
 * servi par `preview`, qui persiste dans IndexedDB — l'étiquette disparaît,
 * et il VÉRIFIE son absence avant d'écrire quoi que ce soit.
 *
 * ── Les formats ──────────────────────────────────────────────────────────
 *
 * Play veut du 16:9 ou du 9:16, chaque côté entre 320 et 3840 px. Kaissi est
 * une application de PAYSAGE — une caisse est posée sur un comptoir — donc
 * 16:9 partout. La largeur CSS est choisie pour correspondre à un appareil
 * réel, et le facteur d'échelle pour retomber sur un format exact :
 *
 *     téléphone    960 × 540  CSS × 2  =  1920 × 1080
 *     tablette 7"  1024 × 576 CSS × 2  =  2048 × 1152
 *     tablette 10" 1280 × 720 CSS × 2  =  2560 × 1440
 *
 * Lancement :
 *   pnpm pos:build:web && pnpm --filter @kaissi/pos preview:web   (un terminal)
 *   pnpm captures                                                 (un autre)
 */

import { chromium } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:4173/'

const APPAREILS = [
  { nom: 'telephone', css: [960, 540], echelle: 2, libelle: 'Téléphone' },
  { nom: 'tablette-7', css: [1024, 576], echelle: 2, libelle: 'Tablette 7 pouces' },
  { nom: 'tablette-10', css: [1280, 720], echelle: 2, libelle: 'Tablette 10 pouces' },
]

const nav = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {},
)

let total = 0
for (const appareil of APPAREILS) {
  const dossier = join(RACINE, 'ressources-store', 'captures', appareil.nom)
  mkdirSync(dossier, { recursive: true })

  const [l, h] = appareil.css
  // `storageState` vierge à chaque appareil : la base IndexedDB repart de la
  // graine, donc les mêmes écrans pour les trois formats. Sans cela, le
  // deuxième passage retrouverait la table 3 déjà encaissée.
  const contexte = await nav.newContext({
    viewport: { width: l, height: h },
    deviceScaleFactor: appareil.echelle,
  })
  const page = await contexte.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(e.message))

  let n = 0
  const prendre = async (nom) => {
    n += 1
    const fichier = join(dossier, `${String(n).padStart(2, '0')}-${nom}.png`)
    await page.screenshot({ path: fichier })
    const kio = (statSync(fichier).size / 1024).toFixed(0)
    console.log(`    ${String(n).padStart(2, '0')}-${nom}.png  ${l * appareil.echelle}×${h * appareil.echelle}  ${kio} Kio`)
    total += 1
  }

  console.log(`\n── ${appareil.libelle} — ${l * appareil.echelle} × ${h * appareil.echelle} ──`)
  await page.goto(URL_POS, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Prise de poste', { timeout: 40000 })

  /*
   * Le contrôle qui empêche de publier une fausse capture. L'étiquette n'a
   * rien à faire sur une fiche, et elle n'apparaît que si la base n'est pas
   * persistante — c'est-à-dire si l'on s'est trompé de serveur.
   */
  if (await page.$('.etiquette-demo')) {
    throw new Error(
      'L’étiquette « démo — mémoire » est affichée : ces captures viennent de ' +
        '`pos:dev`, dont la base est en mémoire. Servez le build web ' +
        '(`pnpm pos:build:web && pnpm --filter @kaissi/pos preview:web`), ' +
        'puis relancez.',
    )
  }

  await page.click('text=Salma Trabelsi')
  await page.waitForSelector('.pave', { timeout: 15000 })
  for (const c of '2468') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')

  // Une caisse déjà ouverte : on passe l'écran d'ouverture, qui ne montre
  // rien du produit.
  const ouverture = await page.$('text=Ouverture de caisse')
  if (ouverture) {
    for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
    await page.click('.pave .valider')
  }
  await page.waitForSelector('.grille-tables', { timeout: 20000 })
  await prendre('salle')

  await page.click('.grille-tables .table:has(.numero:text-is("3"))')
  await page.waitForSelector('.grille-produits', { timeout: 20000 })
  await page.click('.categories button:has-text("Plats")')
  await page.click('.carte-produit:has-text("Pizza Margherita")')
  await page.waitForSelector('.modale', { timeout: 15000 })
  await page.click('.options button:has-text("Fromage")')
  await page.click('.modale footer .principal')
  await page.waitForSelector('.lignes li:has-text("Pizza Margherita")', { timeout: 20000 })
  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 20000 })
  await page.click('.categories button:has-text("Plats")')
  await prendre('prise-de-commande')

  await page.click('.actions-commande .principal')
  await page.waitForSelector('.paiement', { timeout: 20000 })
  await page.click('.modes button:has-text("Espèces")')
  await page.click('.suggestions button >> nth=1')
  await page.waitForSelector('.bloc-reste.solde', { timeout: 20000 })
  await prendre('encaissement')

  await page.click('.colonne-recap .principal.grand')
  await page.waitForSelector('.modale:has-text("Ticket client")', { timeout: 30000 })
  await prendre('ticket-client')

  if (erreurs.length > 0) {
    throw new Error(`Erreur JavaScript pendant les captures : ${erreurs[0]}`)
  }
  await contexte.close()
}

await nav.close()
console.log(`\n✓ ${total} captures écrites dans ressources-store/captures/`)
console.log('  Play en demande 2 à 8 par format ; les quatre suffisent.')
