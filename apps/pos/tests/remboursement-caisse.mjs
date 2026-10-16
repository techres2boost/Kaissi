#!/usr/bin/env node
/**
 * Rembourser un ticket payé — dans un VRAI navigateur, réseau coupé.
 *
 * Ce que ce parcours prouve, et qu'aucun test unitaire ne peut prouver :
 *   • un reçu s'OUVRE depuis l'écran Reçus, sur le ticket exact ;
 *   • une caissière peut DEMANDER le remboursement, mais c'est le PIN d'un
 *     gérant qui l'autorise — sans lui, rien n'est enregistré ;
 *   • le montant affiché vient du domaine, et le ticket réédité porte
 *     « Remboursé » et le net encaissé ;
 *   • la ligne déjà rendue ne peut plus l'être ;
 *   • à la clôture, l'argent rendu en espèces SORT du tiroir attendu.
 *
 * Lancement :
 *   pnpm --filter @kaissi/pos dev
 *   node apps/pos/tests/remboursement-caisse.mjs
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

// Hors ligne d'un bout à l'autre : rembourser ne doit pas dépendre du réseau.
await page.route('**/sync/**', (route) => route.abort())
await page.goto(URL_POS, { waitUntil: 'networkidle' })

const ouvrirTiroir = async () => {
  await page.click('.ouvrir-tiroir')
  await page.waitForSelector('.tiroir-lien', { timeout: 10000 })
}
const pin = async (code) => {
  for (const c of code) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
}

/** Lit un montant « 12,345 TND » dans un texte. */
const montantDans = (texte) => {
  const m = /(\d[\d\s]*,\d{3})/.exec(texte ?? '')
  if (!m) throw new Error(`aucun montant dans « ${texte} »`)
  return Number(m[1].replace(/\s/g, '').replace(',', ''))
}

await etape('Salma (caissière) prend son poste et ouvre la caisse', async () => {
  if (await page.$('.bienvenue')) await page.click('.lien-discret')
  await page.waitForSelector('text=Prise de poste', { timeout: 20000 })
  await page.click('text=Salma Trabelsi')
  await page.waitForSelector('.pave', { timeout: 10000 })
  await pin('2468')
  await page.waitForSelector('text=Ouverture de caisse', { timeout: 20000 })
  for (const c of ['5', '0']) await page.click(`.pave button:text-is("${c}")`)
  await page.click('.pave .valider')
  await page.waitForSelector('.grille-tables', { timeout: 20000 })
})

await etape('une vente à deux lignes, encaissée en espèces', async () => {
  await page.click('.grille-tables .table:has(.numero:text-is("4"))')
  await page.waitForSelector('.grille-produits', { timeout: 15000 })
  await page.click('.categories button:has-text("Boissons")')
  await page.click('.carte-produit:has-text("Coca-Cola 33cl")')
  await page.waitForSelector('.lignes li:has-text("Coca-Cola")', { timeout: 10000 })
  await page.click('.categories button:has-text("Desserts")')
  await page.locator('.grille-produits .carte-produit').first().click()
  await page.waitForTimeout(600)
  // Un dessert à options ouvrirait une modale : on la valide telle quelle.
  if (await page.$('.modale footer .principal')) await page.click('.modale footer .principal')
  await page.waitForFunction(() => document.querySelectorAll('.lignes li:not(.retiree)').length >= 2, null, { timeout: 10000 })
  await page.click('.actions-commande .principal')
  await page.waitForSelector('.paiement', { timeout: 15000 })
  await page.click('.modes button:has-text("Espèces")')
  await page.click('.suggestions button >> nth=0')
  await page.waitForSelector('.bloc-reste.solde', { timeout: 15000 })
  await page.click('.colonne-recap .principal.grand')
  await page.waitForSelector('.modale:has-text("Ticket client")', { timeout: 20000 })
  await page.click('.modale .principal')
  await page.waitForSelector('.grille-tables', { timeout: 20000 })
})

let rendu = 0
await etape('le reçu s’ouvre depuis « Reçus », sur le ticket exact', async () => {
  await ouvrirTiroir()
  await page.click('.tiroir-lien:has-text("Reçus")')
  await page.waitForSelector('.liste-recus .ouvrir-recu', { timeout: 15000 })
  await page.locator('.liste-recus .ouvrir-recu').first().click()
  await page.waitForSelector('.modale .ticket-ecran', { timeout: 10000 })
  const ticket = await page.textContent('.modale .ticket-ecran')
  if (!/Coca-Cola/.test(ticket)) throw new Error('le ticket affiché n’est pas celui de la vente')
  if (/Remboursé/.test(ticket)) throw new Error('le ticket parle de remboursement avant tout remboursement')
})

await etape('la caissière choisit la ligne et le motif — le montant vient du domaine', async () => {
  await page.click('.modale button:has-text("Rembourser…")')
  await page.waitForSelector('.lignes-remboursables', { timeout: 10000 })
  const ligne = page.locator('.lignes-remboursables li:has-text("Coca-Cola") label')
  rendu = montantDans(await ligne.locator('.montant').textContent())
  await ligne.locator('input[type="checkbox"]').check()
  // Sans motif, le bouton reste inactif : un remboursement s'explique.
  if (await page.isEnabled('.modale footer .principal')) {
    throw new Error('le remboursement est possible SANS motif')
  }
  await page.click('.modale .options button:has-text("Plat non conforme")')
  const bouton = await page.textContent('.modale footer .principal')
  if (montantDans(bouton) !== rendu) {
    throw new Error(`le bouton annonce ${bouton}, la ligne vaut ${rendu}`)
  }
})

await etape('sans le PIN d’un gérant, RIEN n’est enregistré', async () => {
  await page.click('.modale footer .principal')
  await page.waitForSelector('text=Autorisation requise', { timeout: 10000 })
  // On annule l'autorisation : le remboursement ne doit pas exister.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const annuler = await page.$('button:has-text("Annuler")')
  if (annuler) await annuler.click()
  await page.waitForTimeout(500)
  // La liste des reçus n'affiche aucun montant remboursé.
  if (await page.$('.badge.rembourse')) throw new Error('remboursé sans autorisation')
})

await etape('le gérant pose son PIN : le remboursement est enregistré', async () => {
  if (!(await page.$('.lignes-remboursables'))) {
    if (!(await page.$('.modale .ticket-ecran'))) {
      await page.locator('.liste-recus .ouvrir-recu').first().click()
      await page.waitForSelector('.modale .ticket-ecran', { timeout: 10000 })
    }
    await page.click('.modale button:has-text("Rembourser…")')
    await page.waitForSelector('.lignes-remboursables', { timeout: 10000 })
    await page.locator('.lignes-remboursables li:has-text("Coca-Cola") input[type="checkbox"]').check()
    await page.click('.modale .options button:has-text("Plat non conforme")')
  }
  await page.click('.modale footer .principal')
  await page.waitForSelector('text=Autorisation requise', { timeout: 10000 })
  const liste = await page.$('.liste-employes button:has-text("Ahmed")')
  if (liste) await liste.click()
  await page.waitForSelector('.saisie-pin .pave', { timeout: 10000 })
  await pin('1357')
  await page.waitForSelector('.modale .ticket-ecran', { timeout: 15000 })
  const ticket = await page.textContent('.modale .ticket-ecran')
  if (!/Remboursé/.test(ticket)) throw new Error('le ticket réédité ne dit pas « Remboursé »')
  if (!/Net encaissé/.test(ticket)) throw new Error('le ticket réédité ne donne pas le net encaissé')
  if (!/Plat non conforme/.test(ticket)) throw new Error('le motif n’apparaît pas sur le ticket')
})

await etape('la ligne rendue ne peut plus l’être', async () => {
  await page.click('.modale button:has-text("Rembourser…")')
  await page.waitForSelector('.lignes-remboursables', { timeout: 10000 })
  const coche = page.locator('.lignes-remboursables li:has-text("Coca-Cola") input[type="checkbox"]')
  if (!(await coche.isDisabled())) throw new Error('le Coca déjà remboursé reste sélectionnable')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.badge.rembourse', { timeout: 10000 })
})

await etape('à la clôture, l’argent rendu SORT du tiroir attendu', async () => {
  await ouvrirTiroir()
  await page.click('.tiroir-lien:has-text("Clôturer la caisse")')
  await page.waitForSelector('.bloc-cloture', { timeout: 15000 })
  const bloc = await page.textContent('.bloc-cloture')
  if (!/Remboursé en espèces/.test(bloc)) throw new Error('la clôture ne mentionne pas le remboursement')
  const ligne = await page.locator('dt:has-text("Remboursé en espèces") + dd').textContent()
  if (montantDans(ligne) !== rendu) {
    throw new Error(`la clôture déduit ${ligne}, il a été rendu ${rendu}`)
  }
})

await nav.close()
if (erreurs.length > 0) {
  console.log(`✗ erreurs de page :\n  ${erreurs.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✓ Remboursement : autorisé par un gérant, tracé, et déduit du tiroir — hors ligne.')
