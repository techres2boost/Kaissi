/**
 * La colonne de navigation se parcourt ENTIÈRE sur une tablette en paysage.
 *
 * PANNE OBSERVÉE sur une tablette Android (650 px de haut) : « je ne vois
 * pas les onglets à gauche ». Articles, Paramètres et « Se déconnecter »
 * étaient sous le bord de l'écran, sans barre visible pour le dire.
 *
 * Ce test rend la VRAIE colonne avec la VRAIE feuille de styles, la fait
 * glisser au doigt, et exige que le pied (« Se déconnecter ») finisse par
 * entrer dans l'écran. Il échouerait si quelqu'un retirait `overflow-y`,
 * ou donnait à la colonne une hauteur qui suit son contenu.
 */

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import { direction } from '@kaissi/i18n'
import { FournisseurLangue } from '../i18n/client.js'
import { LANGUE_DU_PASSAGE } from '../i18n/largeur.setup.js'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => '/r1/periodes',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../app/connexion/actions.js', () => ({ seDeconnecter: () => undefined }))

const { Navigation } = await import('./Navigation.js')
const STYLES = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8')

const etablissement = {
  id: 'r1',
  organizationId: 'o1',
  nom: 'Snack Lac 1',
  role: 'admin',
  gestionnaire: true,
  administrateur: true,
  ferme: false,
  fermeLe: null,
  preparation: false,
  stationId: null,
  stationNom: null,
} as const

const html = renderToStaticMarkup(
  <FournisseurLangue langue={LANGUE_DU_PASSAGE}>
    <Navigation
      session={{
        compteId: 'c1',
        employeId: null,
        email: 'gerant@snack.tn',
        nom: 'Ahmed Ben Salah',
        etablissements: [etablissement, { ...etablissement, id: 'r2' }],
      }}
      etablissement={etablissement}
    />
  </FournisseurLangue>,
)

let nav: Browser
beforeAll(async () => {
  const chemin = process.env['CHROMIUM_PATH']
  nav = await chromium.launch(chemin ? { executablePath: chemin, args: ['--no-sandbox'] } : {})
})
afterAll(async () => {
  await nav?.close()
})

describe(`colonne de navigation — ${LANGUE_DU_PASSAGE === 'ar' ? 'arabe' : 'français'}`, () => {
  it('sur une tablette de 650 px de haut, le doigt mène jusqu’à « Se déconnecter »', async () => {
    const page = await nav.newPage({
      viewport: { width: 1200, height: 650 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    try {
      await page.setContent(
        `<!doctype html><html lang="${LANGUE_DU_PASSAGE}" dir="${direction(LANGUE_DU_PASSAGE)}"><head>
         <meta name="viewport" content="width=device-width, initial-scale=1">
         <style>${STYLES}</style></head><body>${html}
         <main class="enveloppe"><div style="height: 3000px"></div></main></body></html>`,
      )
      const pied = () =>
        page.evaluate(() => {
          const r = document.querySelector('.laterale-pied button')!.getBoundingClientRect()
          return r.bottom <= window.innerHeight
        })
      expect(await pied(), 'le pied tient déjà dans l’écran : le test ne prouve rien').toBe(false)

      // Glisser le doigt de bas en haut sur la colonne, trois fois.
      const cdp = await page.context().newCDPSession(page)
      const x = LANGUE_DU_PASSAGE === 'ar' ? 1100 : 100
      for (let passe = 0; passe < 3; passe++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 600 }] })
        for (let y = 590; y >= 100; y -= 15) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await page.waitForTimeout(150)
      }
      expect(await pied(), '« Se déconnecter » est resté hors de l’écran').toBe(true)
    } finally {
      await page.close()
    }
  })
})
