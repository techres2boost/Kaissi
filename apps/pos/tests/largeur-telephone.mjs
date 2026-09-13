#!/usr/bin/env node
/**
 * La caisse tient-elle dans la largeur d'un téléphone ?
 *
 * ── La panne que ce test fige ─────────────────────────────────────────────
 *
 * Sur un iPhone, via TestFlight : « l'écran est copié, il faut glisser, et
 * quand tu glisses c'est mal affiché ». Ce n'était pas un défaut de rendu —
 * la PAGE ENTIÈRE mesurait près de mille pixels de large.
 *
 * Le coupable n'était pas une grille (elles avaient toutes leur point de
 * bascule) mais le bandeau : une rangée flex sans retour à la ligne, qui
 * débordait et rendait le document scrollable horizontalement. Tout le reste
 * calculait alors ses colonnes sur cette largeur-là.
 *
 * ── Pourquoi un test de bout en bout, et pas un test de CSS ───────────────
 *
 * Parce que la mesure qui compte n'existe que dans un navigateur : c'est
 * `document.documentElement.scrollWidth` comparé à `window.innerWidth`. Aucune
 * lecture de feuille de style ne l'aurait donnée — le débordement naissait de
 * la SOMME des enfants d'une barre, pas d'une règle fautive isolée.
 *
 * Et il faut visiter les écrans : la caisse, la salle, une commande ouverte et
 * l'encaissement ne partagent ni leur barre de contrôles ni leur grille.
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos dev       (dans un terminal)
 *   node apps/pos/tests/largeur-telephone.mjs
 */

import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:5173/'

/**
 * Les deux largeurs qui comptent en clientèle.
 *
 * 390 est l'iPhone 14/15/16 — celui du gérant. 320 est le plancher du web
 * mobile, et ce n'est pas une coquetterie : un vieil Android d'entrée de
 * gamme en salle est exactement le cas d'usage d'un petit snack.
 */
const APPAREILS = [
  { nom: 'iPhone 15 (390 × 844)', width: 390, height: 844 },
  { nom: 'petit Android (320 × 690)', width: 320, height: 690 },
]

/** Un pixel de tolérance : les arrondis sub-pixels ne sont pas un débordement. */
const TOLERANCE = 1

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)

let echecs = 0

for (const appareil of APPAREILS) {
  console.log(`\n▸ ${appareil.nom}`)
  const page = await nav.newPage({
    viewport: { width: appareil.width, height: appareil.height },
    // Sans cela, Chromium rend en « desktop » et les points de bascule
    // s'appliquent quand même — mais les barres de défilement, non.
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })

  /**
   * Mesure le débordement horizontal, et NOMME le coupable.
   *
   * Rendre « ça déborde » sans dire de combien ni à cause de quoi laisse au
   * lecteur le travail que le test était censé faire. On rend donc l'élément
   * le plus large dont le bord droit dépasse la fenêtre.
   */
  const mesurer = (etiquette) =>
    page.evaluate((tolerance) => {
      const fenetre = window.innerWidth
      const page = document.documentElement.scrollWidth
      const coupables = []
      if (page > fenetre + tolerance) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue
          if (r.right > fenetre + tolerance) {
            coupables.push({
              selecteur:
                el.tagName.toLowerCase() +
                (el.className && typeof el.className === 'string'
                  ? '.' + el.className.trim().split(/\s+/).join('.')
                  : ''),
              droite: Math.round(r.right),
            })
          }
        }
      }
      return { fenetre, page, coupables: coupables.slice(0, 6) }
    }, TOLERANCE).then((m) => {
      const deborde = m.page > m.fenetre + TOLERANCE
      if (!deborde) {
        console.log(`  ✓ ${etiquette} — ${m.page} px pour ${m.fenetre} px de fenêtre`)
        return
      }
      echecs++
      console.log(
        `  ✗ ${etiquette} — la page fait ${m.page} px pour ${m.fenetre} px de fenêtre ` +
          `(${m.page - m.fenetre} px de trop)`,
      )
      for (const c of m.coupables) {
        console.log(`      dépasse jusqu'à ${c.droite} px : ${c.selecteur}`)
      }
    })

  await page.goto(URL_POS, { waitUntil: 'networkidle' })

  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
  await mesurer('prise de poste')

  await page.click('text=Salma Trabelsi')
  await page.waitForSelector('.pave', { timeout: 5000 })
  await mesurer('pavé du PIN')

  for (const c of '2468') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('text=Ouverture de caisse', { timeout: 20000 })
  await mesurer('ouverture de caisse')

  for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.grille-tables', { timeout: 10000 })
  await mesurer('salle — plan des tables')

  // Le bouton le plus utilisé de la barre de salle. S'il est hors champ, le
  // test de largeur passe et l'écran reste inutilisable : on vérifie donc
  // aussi qu'il est ATTEIGNABLE.
  const aEmporter = await page.$('.barre-salle .principal')
  if (!aEmporter) {
    echecs++
    console.log('  ✗ salle — le bouton « À emporter » est absent du DOM')
  } else if (!(await aEmporter.isVisible())) {
    echecs++
    console.log('  ✗ salle — le bouton « À emporter » est présent mais invisible')
  } else {
    console.log('  ✓ salle — le bouton « À emporter » est visible')
  }

  await page.click('.grille-tables .table:has(.numero:text-is("3"))')
  await page.waitForSelector('.grille-produits', { timeout: 10000 })
  await mesurer('commande — carte et ticket')

  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 10000 })
  await mesurer('commande avec une ligne')

  await page.click('.actions-commande button:has-text("Encaisser")')
  await page.waitForSelector('.paiement', { timeout: 10000 })
  await mesurer('encaissement')

  // « Reçus » est la ligne la plus dense de l'application : référence, heure,
  // table, employé, articles, mode de paiement, montant, badges. C'est celle
  // qui déborde en premier quand on ajoute une colonne.
  await page.click('.bandeau-actions .lien:has-text("Reçus")')
  await page.waitForSelector('.recus', { timeout: 10000 })
  await mesurer('reçus')

  // Les périodes affichent huit chiffres côte à côte : c'est la grille la
  // plus serrée de l'application, celle qui déborde en premier.
  await page.click('.bandeau-actions .lien:has-text("Périodes")')
  await page.waitForSelector('.periodes', { timeout: 10000 })
  await mesurer('périodes de travail')

  await page.close()
}

await nav.close()

if (echecs > 0) {
  console.log(
    `\n✗ ${echecs} écran(s) débordent de la largeur du téléphone.\n` +
      '  Un débordement se contient LÀ OÙ IL NAÎT — la barre qui dépasse —\n' +
      '  jamais par `overflow-x: hidden` sur le corps : cela ferait disparaître\n' +
      '  le glissement ET les boutons, sans rien dire.\n',
  )
  process.exit(1)
}

console.log('\n✓ Aucun débordement horizontal sur les deux appareils.\n')
