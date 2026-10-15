#!/usr/bin/env node
/**
 * Les captures d'écran de la fiche App Store — prises dans la VRAIE application.
 *
 * ── Pourquoi un second script, à côté de `captures-store.mjs` ─────────────
 *
 * Play et Apple ne demandent pas la même chose, et la différence n'est pas
 * cosmétique : Play accepte n'importe quelle image entre 320 et 3840 px de
 * côté, pourvu qu'elle soit en 16:9. Apple, lui, exige des dimensions
 * EXACTES, emplacement par emplacement — un pixel d'écart et le
 * téléversement refuse le fichier, sans dire lequel des deux côtés est
 * fautif. Les deux scripts partagent donc le parcours, jamais les formats.
 *
 * ── Les trois emplacements, et pourquoi ceux-là ───────────────────────────
 *
 * Le projet iOS déclare `TARGETED_DEVICE_FAMILY = "1,2"` : iPhone ET iPad.
 * Apple réclame alors au moins une capture dans CHACUNE des deux familles,
 * et refuse de lancer la revue sans elles (« You must upload a screenshot
 * for 13-inch iPad displays »).
 *
 *     iPhone 6,9" (Dynamic Island, grand)   1320 × 2868   portrait
 *     iPhone 6,3" (Dynamic Island, moyen)   1206 × 2622   portrait
 *     iPad 13 pouces                        2752 × 2064   PAYSAGE
 *
 * L'orientation n'est pas un choix esthétique. `UISupportedInterfaceOrientations`
 * autorise les deux sur les deux familles, mais une caisse POSÉE SUR UN
 * COMPTOIR est en paysage — c'est ce que montre l'iPad. Un iPhone, lui, se
 * tient à la main : la caisse y passe en colonne unique, avec son tiroir de
 * navigation, et c'est cette mise en page-là qu'il faut montrer. Des
 * captures d'iPhone prises en paysage vendraient un écran que personne ne
 * tient comme ça.
 *
 * ── Deux réglages indépendants, et c'est la clé ───────────────────────────
 *
 * La largeur CSS décide de la MISE EN PAGE ; le facteur d'échelle décide de
 * la RÉSOLUTION du fichier. On choisit donc la première pour ressembler à
 * l'appareil réel, et le second pour atteindre le pixel exact qu'Apple
 * attend :
 *
 *     440 × 956  CSS × 3 = 1320 × 2868      402 × 874  CSS × 3 = 1206 × 2622
 *     1376 × 1032 CSS × 2 = 2752 × 2064
 *
 * Les trois divisions sont entières, et ce n'est pas un hasard : une taille
 * cible qui ne se divise pas par son facteur d'échelle donnerait un fichier
 * à un pixel près de la cible, donc refusé.
 *
 * ── JPEG, et pas PNG ──────────────────────────────────────────────────────
 *
 * « Images can't include alpha channels or transparencies », dit Apple. Un
 * PNG de navigateur en porte un, même entièrement opaque : le fichier est
 * alors refusé pour une transparence qui ne se voit pas. Le JPEG n'a pas de
 * canal alpha du tout — la question ne se pose plus.
 *
 * ── Le serveur de synchronisation est un STUB ─────────────────────────────
 *
 * Une caisse non appairée affiche « ⚠ À appairer » en rouge dans son
 * bandeau, sur TOUS les écrans : une fiche de magasin montrerait dix fois
 * une installation inachevée. On appaire donc la caisse par le VRAI chemin
 * de code, avec une réponse d'appairage simulée — comme le font déjà
 * `tests/mise-en-service.mjs` et les autres parcours de ce dépôt. Rien
 * d'autre n'est simulé : les écrans, les totaux, la TVA et le ticket sont
 * calculés par l'application, sur sa base locale.
 *
 * `/sync/**` est coupé ensuite : les ventes s'empilent dans l'outbox, et le
 * bandeau affiche « ⇅ N ». C'est l'état réel d'une caisse qui travaille sans
 * réseau — l'argument du produit, pas un défaut à cacher.
 *
 * Lancement :
 *   pnpm pos:build:web && pnpm --filter @kaissi/pos preview:web   (un terminal)
 *   pnpm captures:apple                                           (un autre)
 */

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:4173/'

const FORMATS = [
  {
    nom: 'iphone-6.9',
    libelle: 'iPhone 6,9" — Dynamic Island, grand',
    css: [440, 956],
    echelle: 3,
    cible: [1320, 2868],
  },
  {
    nom: 'iphone-6.3',
    libelle: 'iPhone 6,3" — Dynamic Island, moyen',
    css: [402, 874],
    echelle: 3,
    cible: [1206, 2622],
  },
  {
    nom: 'ipad-13',
    libelle: 'iPad 13 pouces — paysage',
    css: [1376, 1032],
    echelle: 2,
    cible: [2752, 2064],
  },
]

/** Apple en accepte dix par emplacement. On en fournit dix. */
const MAX_CAPTURES = 10

/* ── L'identité que le serveur attribuerait ────────────────────────────────
 * Le MÊME établissement que la graine locale : un autre déclencherait la
 * remise à zéro de la base (bascule d'établissement), et la caisse
 * s'ouvrirait sur une carte vide.
 */
const DEMO_ORG = '01930000-0000-7000-8000-000000000001'
const DEMO_RESTO = '01930000-0000-7000-8000-000000000002'
const APPAIRAGE = {
  jeton: 'captures-fiche-app-store',
  deviceId: '01930000-0000-7000-8000-0000000000c1',
  restaurantId: DEMO_RESTO,
  organizationId: DEMO_ORG,
  nomEtablissement: 'Snack Lac 1',
  prefixe: 'P1',
}

/** Les dimensions d'un JPEG, lues dans le fichier — pas supposées. */
function dimensionsJpeg(chemin) {
  const o = readFileSync(chemin)
  let i = 2
  while (i < o.length) {
    if (o[i] !== 0xff) {
      i += 1
      continue
    }
    const marqueur = o[i + 1]
    // SOF0..SOF15, sauf DHT (C4), JPG (C8) et DAC (CC).
    if (marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur)) {
      return [o.readUInt16BE(i + 7), o.readUInt16BE(i + 5)]
    }
    i += 2 + o.readUInt16BE(i + 2)
  }
  throw new Error(`${chemin} : aucun en-tête SOF — ce n'est pas un JPEG`)
}

const nav = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {},
)

/** Clique le premier sélecteur présent — les deux mises en page diffèrent. */
async function cliquerPremier(page, selecteurs, quoi) {
  for (const s of selecteurs) {
    const noeud = await page.$(s)
    if (noeud) {
      await noeud.click()
      return s
    }
  }
  throw new Error(`${quoi} : aucun de ${selecteurs.join(' | ')}`)
}

let total = 0
for (const format of FORMATS) {
  const dossier = join(RACINE, 'ressources-store', 'captures-apple', format.nom)
  mkdirSync(dossier, { recursive: true })

  const [l, h] = format.css
  const [L, H] = format.cible
  if (l * format.echelle !== L || h * format.echelle !== H) {
    throw new Error(`${format.nom} : ${l}×${h} × ${format.echelle} ≠ ${L}×${H}`)
  }

  // Contexte vierge à chaque format : la base IndexedDB repart de la graine,
  // donc les trois jeux montrent exactement les mêmes écrans.
  const contexte = await nav.newContext({
    viewport: { width: l, height: h },
    deviceScaleFactor: format.echelle,
  })
  const page = await contexte.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(e.message))

  // Rien ne sort : les ventes restent dans l'outbox, comme hors réseau.
  await page.route('**/sync/**', (route) => route.abort())
  // L'appairage, lui, répond — par le vrai chemin de code de la caisse.
  await page.route('**/appairage', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(APPAIRAGE),
    }),
  )

  let n = 0
  const prendre = async (nom) => {
    n += 1
    if (n > MAX_CAPTURES) throw new Error(`plus de ${MAX_CAPTURES} captures`)
    const fichier = join(dossier, `${String(n).padStart(2, '0')}-${nom}.jpg`)
    // `animations: 'disabled'` : une transition figée à mi-course donne une
    // modale à moitié transparente, et Apple refuse ce qui ressemble à un
    // écran en cours de chargement.
    await page.screenshot({ path: fichier, type: 'jpeg', quality: 92, animations: 'disabled' })

    const [vl, vh] = dimensionsJpeg(fichier)
    if (vl !== L || vh !== H) {
      throw new Error(`${fichier} : ${vl}×${vh}, attendu ${L}×${H} — Apple refuserait`)
    }
    const kio = statSync(fichier).size / 1024
    console.log(
      `    ${String(n).padStart(2, '0')}-${nom}.jpg`.padEnd(38) +
        `${vl}×${vh}  ${kio.toFixed(0).padStart(4)} Kio`,
    )
    total += 1
  }

  const prendrePoste = async () => {
    if (await page.$('.bienvenue')) await page.click('.lien-discret')
    await page.waitForSelector('text=Prise de poste', { timeout: 40000 })
    if (await page.$('.employe-choisi')) await page.click('.employe-choisi')
    // Ahmed est GÉRANT : c'est lui qui a accès à l'écran « Carte ».
    await page.click('text=Ahmed Ben Salah')
    await page.waitForSelector('.pave', { timeout: 15000 })
    for (const c of '1357') await page.click(`.pave button:text-is("${c}")`)
    await page.click('.pave .valider')
    if (await page.waitForSelector('text=Ouverture de caisse', { timeout: 6000 }).catch(() => null)) {
      for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
      await page.click('.pave .valider')
    }
    await page.waitForSelector('.grille-tables', { timeout: 25000 })
  }

  const ouvrirTiroir = async () => {
    await page.click('.ouvrir-tiroir')
    await page.waitForSelector('.tiroir-lien', { timeout: 10000 })
  }

  const allerA = async (libelle, attendu) => {
    await ouvrirTiroir()
    await page.click(`.tiroir-lien:has-text("${libelle}")`)
    await page.waitForSelector(attendu, { timeout: 20000 })
  }

  console.log(`\n── ${format.libelle} — ${L} × ${H} ──`)
  await page.goto(URL_POS, { waitUntil: 'networkidle' })
  await page.waitForSelector('.bienvenue, :text("Prise de poste")', { timeout: 40000 })

  /*
   * Le contrôle qui empêche de publier une fausse capture : l'étiquette
   * « démo — mémoire » n'apparaît que si la base n'est pas persistante,
   * c'est-à-dire si l'on s'est trompé de serveur (`pos:dev` au lieu du
   * build web).
   */
  if (await page.$('.etiquette-demo')) {
    throw new Error(
      'L’étiquette « démo — mémoire » est affichée : ces captures viennent de ' +
        '`pos:dev`, dont la base est en mémoire. Servez le build web ' +
        '(`pnpm pos:build:web && pnpm --filter @kaissi/pos preview:web`).',
    )
  }

  await prendrePoste()

  /* ── Appairer, pour que le bandeau ne crie pas « ⚠ À appairer » ──────── */
  await allerA('Synchronisation', 'text=Mettre cette caisse en service')
  await page.fill('input[type="email"]', 'gerant@snack-lac.tn')
  await page.fill('input[type="password"]', 'captures-fiche')
  await page.click('button.principal:has-text("Mettre en service")')
  await page.waitForFunction(() => document.querySelector('.badge-sync') === null, {
    timeout: 30000,
  })
  // Selon que la caisse recharge ou non, on retrouve le plan de salle ou la
  // prise de poste : les deux mènent au même endroit.
  await page.waitForSelector('.grille-tables, .bienvenue, :text("Prise de poste")', {
    timeout: 30000,
  })
  if (!(await page.$('.grille-tables'))) await prendrePoste()

  /*
   * L'appairage retire les réductions de la graine — elles n'ont pas
   * d'équivalent serveur. On en recrée une DEPUIS LA CAISSE : c'est la
   * fonctionnalité qu'on veut montrer, et c'est aussi la remise nommée dont
   * la capture « remise justifiée » a besoin.
   */
  await allerA('Carte', '.ecran-carte')
  await page.click('button:has-text("Nouvelle réduction")')
  await page.waitForSelector('#red-nom', { timeout: 15000 })
  await page.fill('#red-nom', 'Happy hour')
  await page.fill('#red-valeur', '20')
  await page.click('button:has-text("Créer la réduction")')
  await page.waitForSelector('.message.succes', { timeout: 15000 })

  await allerA('Ventes', '.grille-tables')
  await prendre('salle')

  /* ── Prise de commande ───────────────────────────────────────────────── */
  await page.click('.grille-tables .table:has(.numero:text-is("3"))')
  await page.waitForSelector('.grille-produits', { timeout: 20000 })
  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 20000 })
  await page.click('.categories button:has-text("Plats")')
  await prendre('prise-de-commande')

  /* ── Les options d'un article ────────────────────────────────────────── */
  await page.click('.carte-produit:has-text("Pizza Margherita")')
  await page.waitForSelector('.modale', { timeout: 15000 })
  const supplement = await page.$('.modale .options button:has-text("Fromage")')
  if (supplement) await supplement.click()
  await prendre('options-article')
  await page.click('.modale footer .principal')
  await page.waitForSelector('.lignes li:has-text("Pizza Margherita")', { timeout: 20000 })

  /* ── La remise, prise dans le référentiel : elle porte un nom ─────────── */
  await cliquerPremier(
    page,
    ['.actions-commande button:has-text("Remise")', 'button:has-text("Remise")'],
    'bouton Remise',
  )
  await page.waitForSelector('.options.grand .nom-reduction', { timeout: 20000 })
  await prendre('remise-justifiee')
  await page.click('.options.grand button:has-text("Happy hour")')
  await page.waitForFunction(() => document.querySelector('.remise-appliquee') !== null, {
    timeout: 20000,
  })

  /* ── Encaissement, puis ticket ───────────────────────────────────────── */
  await cliquerPremier(
    page,
    ['.actions-commande .principal', 'button:has-text("Encaisser")'],
    'bouton Encaisser',
  )
  await page.waitForSelector('.paiement', { timeout: 20000 })
  await page.click('.modes button:has-text("Espèces")')
  await page.click('.suggestions button >> nth=1')
  await page.waitForSelector('.bloc-reste.solde', { timeout: 20000 })
  await prendre('encaissement')

  await cliquerPremier(
    page,
    ['.colonne-recap .principal.grand', '.paiement .principal.grand', '.principal.grand'],
    'valider le paiement',
  )
  await page.waitForSelector('.modale:has-text("Ticket client")', { timeout: 30000 })
  await prendre('ticket-client')
  await page.click('.modale .principal')
  await page.waitForSelector('.grille-tables', { timeout: 30000 })

  /* ── Plusieurs commandes suivies à la fois ───────────────────────────── */
  await page.click('.grille-tables .table:has(.numero:text-is("7"))')
  await page.waitForSelector('.grille-produits', { timeout: 20000 })
  await page.click('.categories button:has-text("Plats")')
  await cliquerPremier(
    page,
    ['.carte-produit:has-text("Couscous poulet")', '.carte-produit'],
    'un plat',
  )
  await page.waitForSelector('.lignes li', { timeout: 20000 })
  await cliquerPremier(page, ['.ticket .retour', '.retour'], 'retour au plan de salle')
  await page.waitForSelector('.grille-tables', { timeout: 20000 })
  await page.click('.onglets-vue button:has-text("Commandes")')
  await page.waitForSelector('.liste-commandes', { timeout: 20000 })
  await prendre('commandes-en-cours')

  /* ── La carte, tenue depuis la caisse ────────────────────────────────── */
  await allerA('Carte', '.ecran-carte')
  await page.click('button:has-text("Nouvel article")')
  await page.waitForSelector('.modale', { timeout: 15000 })
  await page.fill('.modale input[type="text"] >> nth=0', 'Chorba frik')
  await page.locator('.modale input[inputmode="decimal"]').first().fill('6,500')
  await prendre('carte-depuis-la-caisse')
  await page.click('.modale .fermer')

  /* ── La synchronisation : ce qui attend le réseau ────────────────────── */
  await allerA('Synchronisation', '.diagnostic')
  await prendre('synchronisation')

  /* ── La clôture : fond de caisse compté, écart constaté ──────────────── */
  await allerA('Clôturer la caisse', '.bloc-cloture')
  await prendre('cloture-de-caisse')

  if (erreurs.length > 0) {
    throw new Error(`Erreur JavaScript pendant les captures : ${erreurs[0]}`)
  }
  await contexte.close()
}

await nav.close()
console.log(`\n✓ ${total} captures écrites dans ressources-store/captures-apple/`)
console.log(
  '  Apple en accepte dix par emplacement, et en exige au moins une par\n' +
    '  famille d’appareils déclarée. Les dimensions sont relues dans chaque\n' +
    '  fichier : ce qui est écrit ici est téléversable tel quel.',
)
