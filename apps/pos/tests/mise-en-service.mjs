#!/usr/bin/env node
/**
 * Mise en service d'une caisse qui a DÉJÀ servi en local.
 *
 * ── La panne que ce test rejoue ───────────────────────────────────────────
 *
 * Remontée du terrain : « Snack Lack 2 ne marche pas en cliquant dessus ».
 * Le gérant se connecte sur la tablette, la liste de ses établissements
 * s'affiche, il clique sur le second — et il ne se passe RIEN. Pas de
 * message, pas de mouvement. On en conclut que le second restaurant n'existe
 * pas vraiment.
 *
 * Deux défauts se superposaient, et le second cachait le premier :
 *
 *   • la caisse n'avait jamais été mise en service, mais la graine locale
 *     écrit `DEMO_RESTO` et `DEMO_DEVICE` dans `sync_state`. Le garde-fou de
 *     bascule voyait donc un CHANGEMENT d'établissement, trouvait l'outbox
 *     pleine des ventes de démonstration, et refusait — avec, en prime, un
 *     conseil impossible à suivre : « synchronisez, puis recommencez », alors
 *     que la caisse n'a pas de jeton et ne peut rien synchroniser ;
 *   • ce refus n'était rendu NULLE PART : le message n'existait que dans la
 *     branche du formulaire, pas dans celle de la liste.
 *
 * ── Pourquoi un navigateur, et pas un test unitaire ───────────────────────
 *
 * Le premier défaut est une règle, et un test unitaire le couvre
 * (`bascule-etablissement.test.ts`). Le second est un `{message && …}` posé
 * dans la mauvaise branche d'un ternaire : aucun type, aucune assertion sur
 * une fonction pure ne l'aurait vu. Il fallait cliquer.
 *
 * Le serveur d'appairage est SIMULÉ par `page.route` : ce qu'on teste ici est
 * la caisse, pas l'API — et le test doit tourner sans PostgreSQL.
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos dev       (dans un terminal)
 *   node apps/pos/tests/mise-en-service.mjs
 */

import { chromium } from 'playwright'

const EXECUTABLE = process.env.CHROMIUM_PATH || undefined
const URL_POS = process.env.POS_URL || 'http://127.0.0.1:5173/'

const RESTO_A = '01930000-0000-7000-8000-0000000000aa'
const RESTO_B = '01930000-0000-7000-8000-0000000000bb'

const nav = await chromium.launch(
  EXECUTABLE ? { executablePath: EXECUTABLE, args: ['--no-sandbox'] } : {},
)
const page = await nav.newPage({ viewport: { width: 1280, height: 900 } })
const erreurs = []
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message))

const etape = async (nom, fn) => {
  try { await fn(); console.log(`✓ ${nom}`) }
  catch (e) { console.log(`✗ ${nom} — ${e.message.split('\n')[0]}`); throw e }
}

/*
 * Le serveur simulé.
 *
 * Il se comporte comme `POST /appairage` : sans `restaurantId`, il rend la
 * LISTE ; avec, il enrôle. C'est exactement le protocole que la caisse
 * attend, et le seul point de contact entre les deux.
 */
let appels = 0
await page.route('**/appairage', async (route) => {
  appels += 1
  const corps = JSON.parse(route.request().postData() || '{}')
  if (!corps.restaurantId) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choix: [
          { restaurantId: RESTO_A, nom: 'Snack Lac 1' },
          { restaurantId: RESTO_B, nom: 'Snack Lac 2' },
        ],
      }),
    })
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      jeton: 'kdev_test',
      deviceId: '0199f0aa-1111-7000-8000-abcdefabcdef',
      restaurantId: corps.restaurantId,
      organizationId: '01930000-0000-7000-8000-0000000000cc',
      nomEtablissement: corps.restaurantId === RESTO_B ? 'Snack Lac 2' : 'Snack Lac 1',
      prefixe: 'P4',
      reprise: false,
    }),
  })
})
// La synchronisation qui démarre après la mise en service n'a rien à faire
// ici : on la laisse hors ligne, ce qui est un état parfaitement normal.
await page.route('**/sync/**', (route) => route.abort())

await page.goto(URL_POS, { waitUntil: 'networkidle' })

await etape('prise de poste et ouverture de caisse', async () => {
  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
  await page.click('text=Salma Trabelsi')
  await page.waitForSelector('.pave', { timeout: 5000 })
  for (const c of '2468') await page.click(`.pave button:has-text("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('text=Ouverture de caisse', { timeout: 20000 })
  for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.grille-tables', { timeout: 10000 })
})

await etape('une vente en local — c’est ELLE qui bloquait tout', async () => {
  await page.click('.grille-tables .table:has(.numero:text-is("3"))')
  await page.waitForSelector('.grille-produits', { timeout: 10000 })
  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 10000 })
  // Le badge de synchronisation compte ce que l'outbox retient.
  const badge = await page.textContent('.badge-sync, .badge-impression, header .badge')
    .catch(() => null)
  console.log(`    badge d’état : ${badge ?? '(non lisible)'}`)
})

await etape('la liste des établissements s’affiche', async () => {
  await page.click('header button:has-text("Sync"), nav button:has-text("Sync")')
  await page.waitForSelector('text=Mettre cette caisse en service', { timeout: 15000 })
  await page.fill('input[type="email"]', 'gerant@monresto.tn')
  await page.fill('input[type="password"]', 'motdepasse')
  await page.click('button:has-text("Mettre en service")')
  await page.waitForSelector('button:has-text("Snack Lac 2")', { timeout: 15000 })
  console.log(`    ${appels} appel(s) à /appairage`)
})

await etape('CLIC sur « Snack Lac 2 » → la caisse RÉPOND', async () => {
  /*
   * Le cœur du test. Avant correctif, ce clic ne produisait rien du tout :
   * ni message, ni bascule, ni erreur — on reclique, et on conclut que
   * l'établissement n'existe pas.
   */
  await page.click('button:has-text("Snack Lac 2")')
  await page.waitForSelector('button:has-text("Effacer et mettre en service")', {
    timeout: 15000,
  })
  const dit = await page.textContent('.bloc .erreur')
  console.log(`    la caisse dit :\n${dit.split('\n').map((l) => `      ${l.trim()}`).join('\n')}`)
  if (!dit.includes('jamais été envoyées')) {
    throw new Error('le message n’explique pas pourquoi ces opérations sont perdues')
  }
  if (!dit.includes('Snack Lac 2')) {
    throw new Error('le message ne nomme pas l’établissement choisi')
  }
})

await etape('« Annuler » ne touche à rien', async () => {
  await page.click('button:has-text("Annuler")')
  await page.waitForSelector('button:has-text("Effacer et mettre en service")', {
    state: 'detached',
    timeout: 10000,
  })
  // La liste est toujours là : on peut choisir l'autre établissement.
  await page.waitForSelector('button:has-text("Snack Lac 1")', { timeout: 5000 })
})

await etape('confirmation → la caisse repart sur le second établissement', async () => {
  await page.click('button:has-text("Snack Lac 2")')
  await page.click('button:has-text("Effacer et mettre en service")')
  // La page se recharge : le `device_id` est lu une seule fois au montage.
  await page.waitForSelector('text=Prise de poste', { timeout: 30000 })
})

await etape('aucune erreur n’a été avalée en chemin', () => {
  /*
   * `pnpm dev` travaille sur une base EN MÉMOIRE : le rechargement réinstalle
   * la graine, on ne peut donc pas vérifier ici que la carte a disparu — la
   * purge elle-même est couverte, ligne à ligne, par
   * `packages/db-local/src/bascule-etablissement.test.ts`.
   *
   * Ce qui se vérifie ici, et qui a coûté cher : que le clic ABOUTIT. La
   * purge mourait sur le déclencheur d'immuabilité de `order_events`, et
   * l'échec ressortait en « blocage CORS » — un diagnostic qui envoie
   * fouiller la configuration du serveur pendant que la cause est dans la
   * tablette.
   */
  const avalees = erreurs.filter((e) => !e.includes('net::ERR_FAILED'))
  if (avalees.length > 0) {
    throw new Error(`erreur console pendant la mise en service : ${avalees[0]}`)
  }
})

if (erreurs.length > 0) {
  console.log('\n⚠ erreurs console :')
  for (const e of erreurs.slice(0, 10)) console.log(`   ${e}`)
}

console.log('\n✓ mise en service : la caisse répond au clic, dit ce qu’elle efface, et repart propre.')
await nav.close()
