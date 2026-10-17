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
 * Parce que la mesure qui compte n'existe que dans un navigateur : c'est la
 * largeur réelle du contenu, comparée à celle de l'écran DEMANDÉ. Aucune
 * lecture de feuille de style ne l'aurait donnée — le débordement naissait de
 * la SOMME des enfants d'une barre, pas d'une règle fautive isolée.
 *
 * ⛑ « Demandé », et non `window.innerWidth` : voir la note dans `mesurer()`.
 *   Sur un téléphone simulé, la fenêtre s'élargit pour absorber ce qui
 *   dépasse, et se comparer à elle-même ne peut jamais échouer.
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

/*
 * Les DEUX langues. L'arabe n'a ni les mêmes longueurs de mots ni le même
 * sens d'écriture : un écran qui tient en français peut déborder en arabe —
 * et dans ce cas, il déborde par la GAUCHE.
 */
for (const langue of ['fr', 'ar'])
for (const appareil of APPAREILS) {
  console.log(`\n▸ ${appareil.nom} — ${langue === 'ar' ? 'arabe' : 'français'}`)
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
    page.evaluate(([tolerance, demandee]) => {
      const nommer = (el) =>
        el.tagName.toLowerCase() +
        (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\s+/).join('.')
          : '')

      /*
       * La largeur DEMANDÉE, et non `window.innerWidth`.
       *
       * ⛑ Avec `isMobile: true` et `width=device-width`, la fenêtre de mise en
       *   page s'ÉLARGIT pour absorber ce qui dépasse : un élément large de
       *   384 px sur un écran de 320 fait répondre 434 à `innerWidth`, et
       *   `document.documentElement.scrollWidth` grandit d'autant. Comparer
       *   l'un à l'autre, c'est comparer le débordement à lui-même : la
       *   condition ne peut plus être vraie.
       *
       *   Ici, le débordement du bandeau avait été pris malgré tout — par la
       *   mesure du ROGNÉ plus bas, pas par celle-ci. C'est dire à quel point
       *   cette ligne-là ne prouvait rien.
       *
       *   Le même trou existait dans les deux garde-fous du back-office ; il y
       *   est corrigé de la même façon, et vérifié par sabotage
       *   (`Parametres.largeur.test.tsx`).
       */
      const fenetre = demandee
      // Ce que la fenêtre a fait, elle, de la largeur demandée. Au-dessus,
      // quelque chose l'a poussée — et c'est un débordement.
      const fenetreReelle = window.innerWidth
      const page = Math.max(document.documentElement.scrollWidth, fenetreReelle)
      const coupables = []
      if (page > fenetre + tolerance) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue
          // De droite à gauche, ce qui dépasse sort par la GAUCHE.
          if (r.right > fenetre + tolerance || r.left < -tolerance) {
            coupables.push({ selecteur: nommer(el), droite: Math.round(r.right) })
          }
        }
      }

      /*
       * ── Le débordement ROGNÉ, celui que `scrollWidth` ne dit pas ─────────
       *
       * Un conteneur en `overflow-x: hidden` dont le contenu est plus large
       * découpe la différence : elle n'est ni visible, ni atteignable, et la
       * PAGE, elle, ne déborde pas. La première version de ce test ne
       * mesurait que `document.documentElement.scrollWidth` — elle répondait
       * donc ✓ sur un écran de commande où la troisième colonne de produits,
       * le nom du client et le bord du bouton « Encaisser » étaient coupés.
       * C'est exactement le cas qu'il a fallu un vrai iPhone pour voir.
       *
       * `auto` et `scroll` sont légitimes : l'utilisateur peut faire glisser.
       * `hidden` et `clip`, non : ils perdent le contenu en silence.
       */
      const rognes = []
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue
        if (el.scrollWidth <= el.clientWidth + tolerance) continue
        // Une ellipse de texte rogne à dessein — ce n'est pas du contenu perdu.
        if (cs.textOverflow === 'ellipsis') continue
        rognes.push({
          selecteur: nommer(el),
          visible: el.clientWidth,
          reel: el.scrollWidth,
        })
      }

      return {
        fenetre,
        fenetreReelle,
        page,
        coupables: coupables.slice(0, 6),
        rognes: rognes.slice(0, 6),
      }
    }, [TOLERANCE, appareil.width]).then((m) => {
      const deborde = m.page > m.fenetre + TOLERANCE
      if (!deborde && m.rognes.length === 0) {
        console.log(`  ✓ ${etiquette} — ${m.page} px pour ${m.fenetre} px de fenêtre`)
        return
      }
      echecs++
      if (deborde) {
        console.log(
          `  ✗ ${etiquette} — la page fait ${m.page} px pour ${m.fenetre} px de fenêtre ` +
            `(${m.page - m.fenetre} px de trop)`,
        )
        for (const c of m.coupables) {
          console.log(`      dépasse jusqu'à ${c.droite} px : ${c.selecteur}`)
        }
      }
      for (const r of m.rognes) {
        console.log(
          `  ✗ ${etiquette} — contenu ROGNÉ, donc inatteignable : ${r.selecteur} ` +
            `montre ${r.visible} px sur ${r.reel} (${r.reel - r.visible} px perdus)`,
        )
      }
    })

  await page.addInitScript((l) => {
    try {
      window.localStorage.setItem('kaissi.langue', l)
    } catch {
      // Stockage refusé : la caisse reste en français, et le test le verra.
    }
  }, langue)
  await page.goto(URL_POS, { waitUntil: 'networkidle' })

  // Caisse neuve : l'accueil d'abord (voir parcours-caisse.mjs).
  await page.waitForSelector('.bienvenue', { timeout: 20000 })
  await mesurer('accueil — caisse jamais mise en service')

  /*
   * ── La FENÊTRE ne doit offrir aucun défilement ────────────────────────
   *
   * PANNE OBSERVÉE sur un iPhone, à la saisie du mot de passe de mise en
   * service : le bandeau glissait SOUS la barre d'état, l'horloge par-dessus
   * le badge « À appairer ». WKWebView fait défiler la FENÊTRE pour révéler
   * le champ quand le clavier s'ouvre ; la marge de zone sûre, posée sur
   * `body`, sortait alors par le haut. Le remède est de retirer au document
   * tout défilement à offrir — `position: fixed` et `overflow: hidden`.
   *
   * ⚠ CE QUE CE CONTRÔLE PROUVE, ET CE QU'IL NE PROUVE PAS.
   *
   *   Il ne reproduit PAS la panne. Aucun clavier iOS ne s'ouvre ici, et
   *   Chromium rend exactement la même géométrie avec ou sans le remède —
   *   vérifié en le retirant : le contrôle restait vert. Mesurer `scrollY`
   *   aurait donc été un garde-fou qui dit ✓ à un écran cassé, ce qui est
   *   pire que pas de garde-fou.
   *
   *   Ce qu'il fait est plus modeste et honnête : il VERROUILLE le remède. Ces
   *   trois déclarations n'ont aucun effet visible sur un navigateur de
   *   bureau ; quelqu'un les retirera un jour en les prenant pour un reste, et
   *   la panne reviendra sur un iPhone, six semaines plus tard, chez un
   *   client. Le contrôle dit alors pourquoi elles sont là.
   *
   *   La vérification réelle reste manuelle, sur un vrai iPhone : ouvrir la
   *   mise en service, toucher le champ mot de passe, et regarder l'horloge.
   */
  const fige = await page.evaluate(() => {
    const corps = getComputedStyle(document.body)
    const racine = getComputedStyle(document.documentElement)
    return { position: corps.position, corpsOverflow: corps.overflowY, racineOverflow: racine.overflowY }
  })
  if (
    fige.position !== 'fixed' ||
    fige.corpsOverflow !== 'hidden' ||
    fige.racineOverflow !== 'hidden'
  ) {
    echecs++
    console.log(
      "  ✗ le document peut de nouveau défiler : sur iPhone, le clavier fera\n" +
        "      passer le bandeau sous la barre d'état. Attendu body{position:fixed;\n" +
        `      overflow:hidden} et html{overflow:hidden} — trouvé position ` +
        `« ${fige.position} », overflow « ${fige.corpsOverflow} » / « ${fige.racineOverflow} ».`,
    )
  } else {
    console.log('  ✓ le document est figé — le clavier iOS ne peut pas déplacer le bandeau')
  }

  await page.click('.lien-discret')
  await page.waitForSelector('.liste-employes', { timeout: 20000 })
  await mesurer('prise de poste')

  /*
   * Le GÉRANT, et non la caissière : lui seul voit l'entrée « Carte », et
   * c'est l'écran le plus large de l'application. Devant un client qui
   * attend, les deux rôles font le même travail à la caisse — aucune mesure
   * de ce parcours ne dépend du plafond de remise.
   */
  await page.click('text=Ahmed Ben Salah')
  await page.waitForSelector('.pave', { timeout: 5000 })
  await mesurer('pavé du PIN')

  for (const c of '1357') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.ouverture-caisse', { timeout: 20000 })
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
  // Ticket REPLIÉ : la ligne n'est pas à l'écran, le résumé dit qu'elle est là.
  await page.waitForFunction(
    () => /1/.test(document.querySelector('.resume-chiffres .compte')?.textContent ?? ''),
    null,
    { timeout: 10000 },
  )
  await mesurer('commande avec une ligne — ticket replié')

  /*
   * ── La CARTE doit dominer — la panne vue en démonstration ──────────────
   *
   * Empilé sous la grille en hauteur `auto`, le ticket prenait les deux
   * tiers d'un iPhone dès la première ligne : la carte tombait à UNE rangée
   * d'articles. Aucun test de largeur ne le voyait — rien ne débordait. On
   * mesure donc la HAUTEUR : au moins la moitié de l'écran pour la grille,
   * avec une ligne au ticket, et les deux gestes de chaque commande
   * (« Cuisine », « Encaisser ») visibles sans rien déplier.
   */
  const place = await page.evaluate(() => {
    const grille = document.querySelector('.grille-produits')?.getBoundingClientRect()
    const visible = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.bottom <= window.innerHeight + 1
    }
    return {
      grille: Math.round(grille?.height ?? 0),
      ecran: window.innerHeight,
      encaisser: visible('.actions-rapides .principal'),
      cuisine: visible('.actions-rapides .secondaire'),
    }
  })
  if (place.grille < place.ecran * 0.5) {
    echecs++
    console.log(
      `  ✗ commande — la carte n'a que ${place.grille} px sur ${place.ecran} : ` +
        'le ticket l’écrase, le caissier doit faire défiler pour chaque article',
    )
  } else {
    console.log(`  ✓ commande — la carte garde ${place.grille} px sur ${place.ecran}`)
  }
  if (!place.encaisser || !place.cuisine) {
    echecs++
    console.log('  ✗ commande — « Cuisine » ou « Encaisser » n’est pas visible ticket replié')
  } else {
    console.log('  ✓ commande — « Cuisine » et « Encaisser » visibles sans déplier')
  }

  // Déplié : le ticket complet, ses lignes et ses quatre boutons.
  await page.click('.ouvrir-ticket')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 10000 })
  await mesurer('commande avec une ligne — ticket déplié')

  await page.click('.actions-commande .principal')
  await page.waitForSelector('.paiement', { timeout: 10000 })
  await mesurer('encaissement')

  // « Reçus » est la ligne la plus dense de l'application : référence, heure,
  // table, employé, articles, mode de paiement, montant, badges. C'est celle
  // qui déborde en premier quand on ajoute une colonne.
  await page.click('.ouvrir-tiroir')
  await page.click('.tiroir-lien[data-cle="recus"]')
  await page.waitForSelector('.recus', { timeout: 10000 })
  await mesurer('reçus')

  // Les périodes affichent huit chiffres côte à côte : c'est la grille la
  // plus serrée de l'application, celle qui déborde en premier.
  await page.click('.ouvrir-tiroir')
  await page.click('.tiroir-lien[data-cle="periodes"]')
  await page.waitForSelector('.periodes', { timeout: 10000 })
  await mesurer('périodes de travail')

  /*
   * La CARTE et ses formulaires de création. Le groupe d'options est le plus
   * large de l'application : deux colonnes de saisie par choix, plus la liste
   * des articles à rattacher. C'est lui qui déborde en premier sur 320 px.
   *
   * Ouvert avec le GÉRANT : un caissier ne voit pas cette entrée.
   */
  await page.click('.ouvrir-tiroir')
  await page.click('.tiroir-lien[data-cle="carte"]')
  await page.waitForSelector('.ecran-carte', { timeout: 10000 })
  await mesurer('carte')

  await page.click('button[data-cle="modificateur"]')
  await page.waitForSelector('#mod-nom', { timeout: 10000 })
  await mesurer('carte — nouveau groupe d’options')
  await page.click('.modale .fermer')

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

console.log('\n✓ Aucun débordement horizontal sur les deux appareils, en français comme en arabe.\n')
