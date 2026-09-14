/**
 * Taxes et modes de paiement tiennent-ils dans un téléphone ?
 *
 * ── Pourquoi ces deux écrans-là, et pas seulement « ça compile » ──────────
 *
 * Ce sont les premiers FORMULAIRES du back-office à poser plusieurs champs
 * sur une même ligne : un nom, un taux, une case, un bouton. C'est exactement
 * la forme qui a cassé sur l'iPhone — l'adresse e-mail et « Se déconnecter »
 * l'un par-dessus l'autre — et elle ne casse aucun test fonctionnel : l'écran
 * devient inutilisable sans que rien n'échoue.
 *
 * On rend les VRAIS composants contre la VRAIE feuille de style. Les actions
 * serveur sont remplacées — elles tirent `next/cache` et le client Supabase,
 * qui n'existent pas hors d'une requête Next — mais le balisage mesuré reste
 * celui que la production rend.
 */

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../app/[restaurant]/taxes/actions.js', () => ({
  creerTaux: () => undefined,
  modifierTaux: () => undefined,
  definirParDefaut: () => undefined,
  archiverTaux: () => undefined,
}))

vi.mock('../app/[restaurant]/paiements/actions.js', () => ({
  creerModePaiement: () => undefined,
  modifierModePaiement: () => undefined,
  archiverModePaiement: () => undefined,
}))

const { GestionTaxes } = await import('./GestionTaxes.js')
const { GestionModesPaiement } = await import('./GestionModesPaiement.js')

const STYLES = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8')

const APPAREILS = [
  { nom: 'iPhone 15', width: 390, height: 844 },
  { nom: 'petit Android', width: 320, height: 690 },
]

const TOLERANCE = 1

let nav: Browser

beforeAll(async () => {
  const chemin = process.env['CHROMIUM_PATH']
  nav = await chromium.launch(chemin ? { executablePath: chemin, args: ['--no-sandbox'] } : {})
})

afterAll(async () => {
  await nav?.close()
})

async function mesurer(html: string, largeur: number, hauteur: number) {
  const page = await nav.newPage({
    viewport: { width: largeur, height: hauteur },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  try {
    await page.setContent(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8">
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <style>*{box-sizing:border-box}html,body{margin:0}</style>
       <style>${STYLES}</style>
       <style>body{padding:1rem}</style></head><body>${html}</body></html>`,
      { waitUntil: 'load' },
    )
    return await page.evaluate((tolerance) => {
      const nommer = (el: Element) =>
        el.tagName.toLowerCase() +
        (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).join('.')
          : '')

      const fenetre = window.innerWidth
      const depassent: string[] = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.right > fenetre + tolerance) {
          depassent.push(`${nommer(el)} jusqu'à ${Math.round(r.right)} px`)
        }
      }

      /*
       * Le débordement ROGNÉ, que `scrollWidth` ne dit pas : un conteneur en
       * `overflow: hidden` découpe la différence, et la page ne déborde donc
       * pas. Sans cette mesure, le garde-fou répond ✓ sur un écran dont le
       * contenu est inatteignable. Une ellipse de texte rogne à dessein.
       */
      const rognes: string[] = []
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue
        if (cs.textOverflow === 'ellipsis') continue
        if (el.scrollWidth > el.clientWidth + tolerance) {
          rognes.push(`${nommer(el)} montre ${el.clientWidth} px sur ${el.scrollWidth}`)
        }
      }

      /*
       * Et la LARGEUR UTILE de chaque champ de saisie. Un formulaire peut
       * tenir dans la fenêtre en comprimant ses champs à six caractères : on
       * ne relit alors plus ce qu'on vient de taper, et rien n'échoue. C'est
       * le symptôme qu'on attend d'une rangée de quatre éléments sur 320 px.
       */
      const etroits: string[] = []
      for (const el of document.querySelectorAll('input[type="text"], input:not([type])')) {
        const l = el.getBoundingClientRect().width
        if (l > 0 && l < 90) etroits.push(`${nommer(el)} : ${Math.round(l)} px`)
      }

      return {
        fenetre,
        page: document.documentElement.scrollWidth,
        depassent,
        rognes,
        etroits,
      }
    }, TOLERANCE)
  } finally {
    await page.close()
  }
}

const TAUX = [
  /*
   * Un taux à ZÉRO : c'est celui qu'un restaurant ouvert depuis la caisse
   * reçoit, et il déclenche l'avertissement le plus long de l'écran. Le
   * mesurer avec un jeu « propre » aurait laissé passer un bandeau qui
   * déborde.
   */
  { id: 't0', nom: 'À régler — taux non défini', tauxBp: 0, incluse: true, parDefaut: true, archive: false },
  { id: 't1', nom: 'Taux réduit restauration sur place', tauxBp: 1350, incluse: true, parDefaut: false, archive: false },
  { id: 't2', nom: 'Ancien taux', tauxBp: 1900, incluse: false, parDefaut: false, archive: true },
]

const MODES = [
  { id: 'm1', nom: 'Espèces', type: 'cash', ouvreTiroir: true, archive: false },
  { id: 'm2', nom: 'Carte bancaire nationale', type: 'card', ouvreTiroir: false, archive: false },
  { id: 'm3', nom: 'Flouci', type: 'online', ouvreTiroir: false, archive: true },
]

describe('les écrans de Paramètres, en largeur téléphone', () => {
  const cas = [
    {
      nom: 'Taxes',
      html: () =>
        renderToStaticMarkup(
          <GestionTaxes restaurantId="r1" modifiable taux={TAUX} />,
        ),
    },
    {
      nom: 'Modes de paiement',
      html: () =>
        renderToStaticMarkup(
          <GestionModesPaiement restaurantId="r1" modifiable modes={MODES} />,
        ),
    },
  ]

  for (const appareil of APPAREILS) {
    for (const c of cas) {
      it(`${c.nom} ne déborde pas sur ${appareil.nom} (${appareil.width} px)`, async () => {
        const m = await mesurer(c.html(), appareil.width, appareil.height)
        expect(m.depassent, `hors champ : ${m.depassent.join(' · ')}`).toEqual([])
        expect(m.rognes, `rogné : ${m.rognes.join(' · ')}`).toEqual([])
        expect(m.page).toBeLessThanOrEqual(m.fenetre + TOLERANCE)
      })

      it(`${c.nom} garde des champs LISIBLES sur ${appareil.nom}`, async () => {
        const m = await mesurer(c.html(), appareil.width, appareil.height)
        expect(
          m.etroits,
          `champs comprimés à l'illisible : ${m.etroits.join(' · ')}`,
        ).toEqual([])
      })
    }
  }
})
