/**
 * Taxes, modes de paiement et imprimantes tiennent-ils dans un téléphone ?
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

/*
 * Seule l'ACTION est remplacée. `PORT_PAR_DEFAUT` vit dans `port.ts`, un
 * module ordinaire qui ne tire ni `next/cache` ni Supabase : le simuler
 * aussi masquerait une divergence entre la valeur du test et celle que la
 * production affiche.
 */
vi.mock('../app/[restaurant]/imprimantes/actions.js', () => ({
  definirImprimante: () => undefined,
}))

vi.mock('../app/[restaurant]/restauration/actions.js', () => ({
  enregistrerOptions: () => undefined,
}))

const { GestionTaxes } = await import('./GestionTaxes.js')
const { GestionModesPaiement } = await import('./GestionModesPaiement.js')
const { GestionImprimantes } = await import('./GestionImprimantes.js')
const { OptionsRestauration } = await import('./OptionsRestauration.js')

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
    return await page.evaluate(([tolerance, demandee]) => {
      const nommer = (el: Element) =>
        el.tagName.toLowerCase() +
        (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).join('.')
          : '')

      /*
       * La largeur DEMANDée, et non `window.innerWidth`.
       *
       * ⛑ C'est le trou qu'avait ce garde-fou, et il le rendait incapable
       *   d'échouer. Avec `isMobile: true` et `width=device-width`, la fenêtre
       *   de mise en page s'ÉLARGIT pour absorber ce qui dépasse : un élément
       *   large de 384 px sur un écran de 320 faisait répondre 434 à
       *   `innerWidth`. Comparer le contenu à cette valeur-là, c'était comparer
       *   le débordement à lui-même : `r.right > fenetre` ne pouvait plus être
       *   vrai, et `documentElement.scrollWidth` grandissait d'autant.
       *
       *   VÉRIFIÉ PAR SABOTAGE : un `min-width: 24rem` posé sur le nom du
       *   poste passait les seize tests au vert. Avec la largeur demandée, il
       *   en fait échouer quatre, et les NOMME.
       *
       *   Sur un vrai téléphone, cet élargissement n'est pas une tolérance :
       *   c'est le moment où Safari dézoome la page entière, ou la laisse
       *   glisser latéralement. C'est exactement le symptôme qu'on traque.
       */
      const fenetre = demandee
      // Ce que la fenêtre a fait, elle, de la largeur demandée. Au-dessus,
      // quelque chose l'a poussée — et c'est un débordement, même si plus
      // aucun élément ne « dépasse » d'une fenêtre qui a cédé.
      const fenetreReelle = window.innerWidth
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
        fenetreReelle,
        page: document.documentElement.scrollWidth,
        depassent,
        rognes,
        etroits,
      }
    }, [TOLERANCE, largeur] as const)
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

/*
 * Les trois états de l'écran des imprimantes, dans un seul jeu — et pas un
 * jeu « propre » :
 *
 *  • un poste à nom long AVEC adresse, qui porte en plus la phrase du ticket
 *    client, la plus longue de l'écran ;
 *  • un poste sans imprimante, dont l'indication contient un lien ;
 *  • un poste sans rattachement, dont l'avertissement est le plus long des
 *    trois.
 *
 * Mesurer avec un seul poste bien réglé aurait laissé passer exactement ce
 * qu'on cherche : une rangée de quatre éléments comprimée sur 320 px.
 */
const POSTES = [
  { id: 'p1', nom: 'Cuisine chaude', hote: '192.168.1.50', port: 9100, rattachements: 7, ticketClient: true },
  { id: 'p2', nom: 'Bar', hote: null, port: 9100, rattachements: 3, ticketClient: false },
  { id: 'p3', nom: 'Pâtisserie', hote: '192.168.1.51', port: 9100, rattachements: 0, ticketClient: false },
  /*
   * Un nom LONG et d'un seul tenant. `texteObligatoire` en accepte 60, et un
   * restaurateur qui nomme ses postes d'après sa carte en écrit de ceux-là.
   * Le nom du poste ne rétrécit pas — c'est voulu, il distingue les rangées —
   * et sans coupure de mot il pousserait la rangée hors de l'écran.
   */
  { id: 'p4', nom: 'Pâtisserie-Boulangerie-Viennoiserie', hote: null, port: 9100, rattachements: 2, ticketClient: false },
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
    {
      nom: 'Imprimantes cuisine',
      html: () =>
        renderToStaticMarkup(
          <GestionImprimantes restaurantId="r1" modifiable postes={POSTES} />,
        ),
    },
    {
      /*
       * Avec le service TAXABLE : c'est l'état le plus chargé de l'écran — il
       * déplie une liste déroulante ET la phrase la plus longue, celle qui
       * prévient qu'une case sans taux ne taxe rien. Mesurer l'état replié
       * aurait laissé passer exactement ce qui déborde.
       */
      nom: 'Options de restauration',
      html: () =>
        renderToStaticMarkup(
          <OptionsRestauration
            restaurantId="r1"
            modifiable
            valeurs={{
              tauxServiceBp: 1000,
              serviceTaxable: true,
              serviceTauxTaxeId: 't1',
              timbreMillimes: 600,
            }}
            taux={TAUX.filter((t) => !t.archive).map((t) => ({
              id: t.id,
              nom: t.nom,
              tauxBp: t.tauxBp,
              incluse: t.incluse,
            }))}
          />,
        ),
    },
  ]

  for (const appareil of APPAREILS) {
    for (const c of cas) {
      it(`${c.nom} ne déborde pas sur ${appareil.nom} (${appareil.width} px)`, async () => {
        const m = await mesurer(c.html(), appareil.width, appareil.height)
        expect(m.depassent, `hors champ : ${m.depassent.join(' · ')}`).toEqual([])
        // Et la fenêtre elle-même n'a pas cédé. Après `depassent`, qui NOMME
        // l'élément fautif : cette ligne-ci ne dit que le symptôme.
        expect(
          m.fenetreReelle,
          `la fenêtre a cédé : demandée à ${m.fenetre} px, élargie à ${m.fenetreReelle}`,
        ).toBeLessThanOrEqual(m.fenetre + TOLERANCE)
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
