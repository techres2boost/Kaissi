/**
 * Le back-office tient-il dans un téléphone ?
 *
 * ── Pourquoi ce test existe ───────────────────────────────────────────────
 *
 * PANNE OBSERVÉE, sur un iPhone : la barre du compte affichait l'adresse
 * e-mail et « Se déconnecter » l'un par-dessus l'autre, le bouton sortant de
 * l'écran. Le back-office n'avait AUCUN test de largeur — la caisse en avait
 * un depuis qu'un vrai iPhone y avait montré le même défaut, et il n'avait
 * jamais été porté ici.
 *
 * Un débordement horizontal ne casse aucun test fonctionnel : il rend l'écran
 * inutilisable sans que rien n'échoue.
 *
 * ── Ce qu'il couvre, et ce qu'il NE couvre PAS ────────────────────────────
 *
 * Il rend le VRAI composant — pas une copie de son balisage, qui aurait
 * dérivé au premier renommage — contre la VRAIE feuille de style, dans un
 * vrai navigateur. C'est la chaîne complète pour tout ce qui est mise en page.
 *
 * Il ne remplace pas un parcours authentifié : les pages qui exigent une
 * session Supabase ne sont pas ici. Ce qu'on gagne est un contrôle sans
 * identifiants, donc exécutable partout ; ce qu'on perd est nommé plutôt que
 * laissé à supposer.
 */

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import { vi } from 'vitest'

/*
 * `BarreCompte` importe l'action serveur `seDeconnecter`, qui tire à sa suite
 * `next/navigation` et le client Supabase côté serveur — rien de tout cela
 * n'existe hors d'une requête Next. On remplace donc le MODULE, jamais le
 * composant : le balisage mesuré reste celui que la production rend.
 */
vi.mock('../app/connexion/actions.js', () => ({
  seDeconnecter: () => undefined,
  seConnecter: () => undefined,
}))

const { BarreCompte } = await import('./BarreCompte.js')

const STYLES = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8')

const APPAREILS = [
  { nom: 'iPhone 15', width: 390, height: 844 },
  { nom: 'petit Android', width: 320, height: 690 },
]

/** Un pixel de tolérance : les arrondis sub-pixels ne sont pas un débordement. */
const TOLERANCE = 1

let nav: Browser

beforeAll(async () => {
  const chemin = process.env['CHROMIUM_PATH']
  nav = await chromium.launch(
    chemin ? { executablePath: chemin, args: ['--no-sandbox'] } : {},
  )
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
       <style>${STYLES}</style></head><body>${html}</body></html>`,
      { waitUntil: 'load' },
    )
    return await page.evaluate(([tolerance, demandee]) => {
      const nommer = (el: Element) =>
        el.tagName.toLowerCase() +
        (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).join('.')
          : '')

      /*
       * La largeur DEMANDÉE, et non `window.innerWidth`.
       *
       * ⛑ C'est le trou qu'avait ce garde-fou, et il le rendait incapable
       *   d'échouer. Avec `isMobile: true` et `width=device-width`, la fenêtre
       *   de mise en page s'ÉLARGIT pour absorber ce qui dépasse : un élément
       *   large de 384 px sur un écran de 320 faisait répondre 434 à
       *   `innerWidth`. Comparer le contenu à cette valeur-là, c'était comparer
       *   le débordement à lui-même : `r.right > fenetre` ne pouvait plus être
       *   vrai, et `documentElement.scrollWidth` grandissait d'autant.
       *
       *   VÉRIFIÉ PAR SABOTAGE, dans `Parametres.largeur.test.tsx` : un
       *   `min-width: 24rem` posé sur une rangée de réglage passait les seize
       *   tests au vert. Avec la largeur demandée, il en fait échouer quatre,
       *   et les NOMME.
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
       * pas. Même leçon que côté caisse — sans cette mesure, le garde-fou
       * répond ✓ sur un écran dont le contenu est inatteignable. Une ellipse
       * de texte, elle, rogne à dessein.
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
       * ── Le bouton, et la HAUTEUR de sa ligne ──────────────────────────
       *
       * C'est le symptôme réellement observé sur l'iPhone, et il n'est pas
       * horizontal : « Se déconnecter » passait À LA LIGNE dans sa boîte, à
       * cheval sur l'adresse. La page ne débordait pas pour autant — le texte
       * qui se coupe grandit vers le BAS. Mesurer `scrollWidth` seul répondait
       * donc ✓ sur exactement l'écran que la capture montrait cassé.
       *
       * On compare la hauteur du bouton à celle d'une seule ligne de son
       * propre texte : plus haut, c'est qu'il s'est coupé. La mesure ne
       * dépend d'aucune police en particulier — c'est ce qu'il fallait, la
       * panne venant justement d'un rendu iOS plus large que le nôtre.
       */
      const bouton = document.querySelector('.barre button') as HTMLElement | null
      let boutonCoupe = false
      let lignes = 0
      if (bouton) {
        const hauteurLigne = parseFloat(getComputedStyle(bouton).lineHeight) || 0
        const interieur =
          bouton.clientHeight -
          parseFloat(getComputedStyle(bouton).paddingTop) -
          parseFloat(getComputedStyle(bouton).paddingBottom)
        lignes = hauteurLigne > 0 ? Math.round(interieur / hauteurLigne) : 1
        boutonCoupe = lignes > 1 || bouton.scrollWidth > bouton.clientWidth + tolerance
      }

      const rb = bouton?.getBoundingClientRect() ?? null
      return {
        fenetre,
        fenetreReelle,
        page: document.documentElement.scrollWidth,
        depassent,
        rognes,
        bouton: rb
          ? { gauche: Math.round(rb.left), droite: Math.round(rb.right), lignes, coupe: boutonCoupe }
          : null,
      }
    }, [tolerance(), largeur] as const)
  } finally {
    await page.close()
  }
}

const tolerance = () => TOLERANCE

describe('la barre du compte, en largeur téléphone', () => {
  /*
   * ── Pourquoi une adresse VOLONTAIREMENT longue ────────────────────────
   *
   * La première version mesurait l'adresse réelle du gérant, 27 caractères.
   * Elle passait — avec 16 px de marge — AVANT comme APRÈS le correctif : le
   * sabotage ne la faisait pas échouer, et elle n'aurait donc rien protégé.
   *
   * La cause est que les métriques de police d'un Chromium sur Linux ne sont
   * pas celles de Safari sur iOS, où la même adresse est sensiblement plus
   * large — c'est précisément pourquoi la panne s'est vue sur un iPhone et
   * pas ici. Un test qui ne tient qu'à cette chance-là répond ✓ sur un écran
   * cassé.
   *
   * On ne mesure donc plus « est-ce que ça rentre », qui dépend de la police,
   * mais « est-ce que ça DÉGRADE BIEN » : avec une adresse qui ne peut tenir
   * sur aucun téléphone, la barre doit abréger le texte et garder le bouton
   * entier. C'est vrai quelle que soit la police, et c'est la propriété qu'on
   * veut vraiment.
   */
  const ADRESSE_LONGUE = 'prenom.nom-tres-long@restaurant-du-lac-de-tunis.com.tn'

  const html = () =>
    renderToStaticMarkup(
      <BarreCompte session={{ email: ADRESSE_LONGUE, userId: 'u1' } as never} />,
    )

  for (const appareil of APPAREILS) {
    it(`ne déborde pas sur ${appareil.nom} (${appareil.width} px)`, async () => {
      const m = await mesurer(html(), appareil.width, appareil.height)
      expect(m.depassent, `éléments hors champ : ${m.depassent.join(' · ')}`).toEqual([])
      // Et la fenêtre elle-même n'a pas cédé. Après `depassent`, qui NOMME
      // l'élément fautif : cette ligne-ci ne dit que le symptôme.
      expect(
        m.fenetreReelle,
        `la fenêtre a cédé : demandée à ${m.fenetre} px, élargie à ${m.fenetreReelle}`,
      ).toBeLessThanOrEqual(m.fenetre + TOLERANCE)
      expect(m.rognes, `contenu rogné : ${m.rognes.join(' · ')}`).toEqual([])
      expect(m.page).toBeLessThanOrEqual(m.fenetre + TOLERANCE)
    })

    it(`garde « Se déconnecter » ENTIER sur ${appareil.nom}`, async () => {
      /*
       * Une barre peut tenir dans la fenêtre tout en ayant poussé le bouton
       * sous l'adresse, à cheval dessus : la page ne déborde pas, et l'écran
       * est cassé quand même. On vérifie donc que le bouton est entièrement
       * visible, pas seulement que rien ne dépasse.
       *
       * Ce qui cède est le TEXTE, jamais le bouton : on sait toujours à qui
       * appartient la session (l'attribut `title` rend l'adresse en entier),
       * alors qu'un bouton de déconnexion coupé ne se rattrape pas.
       */
      const m = await mesurer(html(), appareil.width, appareil.height)
      expect(m.bouton, 'aucun bouton dans la barre').not.toBeNull()
      expect(
        m.bouton!.coupe,
        `« Se déconnecter » tient sur ${m.bouton!.lignes} ligne(s) au lieu d'une`,
      ).toBe(false)
      expect(m.bouton!.gauche).toBeGreaterThanOrEqual(-TOLERANCE)
      expect(m.bouton!.droite).toBeLessThanOrEqual(m.fenetre + TOLERANCE)
    })
  }
})
