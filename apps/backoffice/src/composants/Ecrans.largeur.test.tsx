/**
 * Les écrans À TABLEAUX tiennent-ils dans un téléphone ?
 *
 * ── La panne que ce fichier fige ──────────────────────────────────────────
 *
 * Sur un iPhone, en démonstration : « tout est décalé » — Articles,
 * Catégories, Stock, Tableau de bord, Journée, Récapitulatif. La barre
 * « Menu » n'occupait plus que les deux tiers de l'écran, le texte était
 * minuscule, un grand vide à droite.
 *
 * Ce n'était pas dix pannes mais une seule : un TABLEAU plus large que sa
 * carte élargissait la page entière, et Safari dézoomait pour la montrer.
 * Tout le reste — barre, cartes, titres — paraissait alors rétréci. Et dans
 * Catégories, le champ du nom, écrasé par ses voisins, tombait à trente
 * pixels : le nom de la catégorie n'était même plus lisible.
 *
 * Les tests de largeur existants (`Parametres.largeur.test.tsx`) mesuraient
 * les formulaires en rangée ; aucun ne rendait un de ces écrans-là.
 *
 * ── Ce qu'on exige ────────────────────────────────────────────────────────
 *
 *   1. aucune page plus large que l'écran (l'élargissement EST le dézoom) ;
 *   2. dans les écrans de SAISIE, chaque nom reste lisible : le champ garde
 *      au moins 7 rem — au-delà de six caractères, on ne relit plus ce qu'on
 *      tape ;
 *   3. aucun bouton d'action poussé hors de l'écran.
 */

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { renderToStaticMarkup as rendreBrut } from 'react-dom/server'
import type { ReactElement } from 'react'
import { direction } from '@kaissi/i18n'
import { FournisseurLangue } from '../i18n/client.js'
import { LANGUE_DU_PASSAGE } from '../i18n/largeur.setup.js'

const rendre = (element: ReactElement) =>
  rendreBrut(<FournisseurLangue langue={LANGUE_DU_PASSAGE}>{element}</FournisseurLangue>)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => '/resto/stock',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../app/[restaurant]/catalogue/actions.js', () => ({
  archiverCategorie: () => undefined,
  archiverPoste: () => undefined,
  creerCategorie: () => undefined,
  creerPoste: () => undefined,
  deplacerCategorie: () => undefined,
  desarchiverCategorie: () => undefined,
  modifierCategorie: () => undefined,
  renommerPoste: () => undefined,
  archiverProduit: () => undefined,
  basculerDisponibilite: () => undefined,
  deplacerProduit: () => undefined,
  desarchiverProduit: () => undefined,
  enregistrerProduit: () => undefined,
}))
vi.mock('../app/[restaurant]/stock/actions.js', () => ({
  activerSuivi: () => undefined,
  basculerDisponibilite: () => undefined,
  basculerRuptureAuto: () => undefined,
  enregistrerMouvement: () => undefined,
}))

vi.mock('../app/[restaurant]/caisses/actions.js', () => ({
  revoquerCaisse: () => undefined,
  renommerCaisse: () => undefined,
}))
vi.mock('../app/[restaurant]/preparation/actions.js', () => ({
  marquerPrete: () => undefined,
  retirerPrete: () => undefined,
}))

const { GestionCategories } = await import('./GestionCategories.js')
const { GestionCaisses } = await import('./GestionCaisses.js')
const { TableauCuisine } = await import('./TableauCuisine.js')
const { EditeurCatalogue } = await import('./EditeurCatalogue.js')
const { TableauStock } = await import('./TableauStock.js')
const { TableauRapport } = await import('./TableauRapport.js')

const STYLES = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8')

// ── Les données d'un vrai snack : les mêmes noms que sur les captures ──────

const stations = [
  { id: 's1', nom: 'Cuisine' },
  { id: 's2', nom: 'Bar' },
]
const categories = [
  { id: 'c1', nom: 'Plats', position: 0, stationId: 's1' },
  { id: 'c2', nom: 'Snacks', position: 1, stationId: 's1' },
  { id: 'c3', nom: 'Boissons chaudes et froides', position: 2, stationId: 's2' },
  { id: 'c4', nom: 'Desserts', position: 3, stationId: null },
]
const produit = (id: string, nom: string, cat: string, prix: number, cout: number | null) => ({
  id,
  nom,
  description: '',
  categorieId: cat,
  stationId: 's1',
  tauxId: 't1',
  prixMillimes: prix,
  prixAffiche: `${(prix / 1000).toFixed(3).replace('.', ',')} TND`,
  coutUnitaire: cout,
  position: 0,
  disponible: true,
})
const produits = [
  produit('p1', 'Couscous poulet', 'c1', 19_000, 7_200),
  produit('p2', 'Spaghetti aux fruits de mer', 'c1', 25_000, 20_000),
  produit('p3', 'Penne au saumon', 'c1', 50_000, null),
  produit('p4', 'Citronnade maison', 'c3', 4_500, 900),
]
const produitsStock = produits.map((p, i) => ({
  id: p.id,
  nom: p.nom,
  categorie: categories.find((c) => c.id === p.categorieId)?.nom ?? null,
  categorieId: p.categorieId,
  prixMillimes: p.prixMillimes,
  coutUnitaire: p.coutUnitaire,
  margeMillimes: p.prixMillimes - (p.coutUnitaire ?? 0),
  margeBp: 6211,
  suivi: i % 2 === 0,
  enVente: i !== 1,
  motifRetrait: i === 1 ? 'manuel' : null,
  ruptureAuto: true,
  quantite: i % 2 === 0 ? 12.5 : null,
  seuil: 5,
  vendue: 3,
  compteA: '2026-10-18T08:00:00.000Z',
  etat: (['ok', 'non_suivi', 'faible', 'non_suivi'] as const)[i]!,
}))

/** La coquille de la vraie page : barre « Menu » du téléphone, puis le contenu. */
function page(contenu: ReactElement): string {
  return (
    `<aside class="laterale"></aside><button class="bouton-menu">☰ Menu</button>` +
    `<main class="enveloppe">${rendre(contenu)}</main>`
  )
}

const ECRANS: { nom: string; html: () => string; saisie: boolean }[] = [
  {
    nom: 'Catégories (postes et catégories)',
    saisie: true,
    html: () =>
      page(
        <GestionCategories
          restaurantId="resto"
          modifiable
          categories={categories}
          stations={stations}
          produits={produits}
          archivees={[]}
        />,
      ),
  },
  {
    nom: 'Liste d’articles',
    saisie: true,
    html: () =>
      page(
        <EditeurCatalogue
          restaurantId="resto"
          modifiable
          categories={categories}
          stations={stations}
          taux={[{ id: 't1', nom: 'TVA 19 %', libelle: '19 % (incluse)', defaut: true }]}
          produits={produits}
          produitsArchives={[produit('p9', 'Ancienne pizza', 'c1', 14_500, null)]}
        />,
      ),
  },
  {
    nom: 'Stock',
    saisie: true,
    html: () =>
      page(
        <TableauStock
          restaurantId="resto"
          produits={produitsStock}
          categories={categories}
          fournisseurs={[]}
        />,
      ),
  },
  {
    nom: 'Rapport (ventes par article, à huit colonnes)',
    saisie: false,
    html: () =>
      page(
        <TableauRapport
          titre="Ventes par article"
          colonnes={['Article', 'Catégorie', 'Quantité', 'CA TTC', 'CA HT', 'Coût', 'Marge', 'Part'].map(
            (titre, i) => ({ cle: `c${i}`, titre, nombre: i > 1 }),
          )}
          lignes={produits.map((p) => ({
            cle: p.id,
            cellules: Object.fromEntries(
              ['Article', 'Catégorie', 'Quantité', 'CA TTC', 'CA HT', 'Coût', 'Marge', 'Part'].map((_, i) => [
                `c${i}`,
                { texte: i === 0 ? p.nom : i === 1 ? 'Plats' : '123 456,789 TND' },
              ]),
            ),
          }))}
        />,
      ),
  },
  {
    nom: 'Caisses',
    saisie: true,
    html: () =>
      page(
        <GestionCaisses
          restaurantId="resto"
          modifiable
          caisses={[
            {
              id: 'd1',
              libelle: 'Comptoir principal — salle du haut',
              prefixe: 'P19',
              derniereSynchro: '2026-10-19T04:09:35.000Z',
              appaireeLe: '2026-10-18T20:00:00.000Z',
              revoqueeLe: null,
              versionApplication: '1.4.2',
            },
          ]}
        />,
      ),
  },
  {
    nom: 'Préparation (un ajout après « prêt »)',
    saisie: false,
    html: () =>
      page(
        <TableauCuisine
          restaurantId="resto"
          plafond={60}
          postes={stations}
          posteActif={null}
          titre="Préparation"
          commandes={[
            {
              id: 'o1',
              numero: 'P17-000004',
              table: '1',
              type: 'dine_in',
              couverts: 4,
              envoyeeA: '2026-10-18T20:00:00.000Z',
              preteA: null,
              ajout: true,
              rangEnvoi: 1073,
              lignes: [
                { id: 'l1', designation: 'Couscous poulet', quantite: 1, options: [], note: null, nouvelle: false },
                { id: 'l2', designation: 'Steak de bœuf', quantite: 1, options: ['Saignant'], note: null, nouvelle: false },
                { id: 'l3', designation: 'Penne au saumon et aux herbes du jardin', quantite: 2, options: [], note: 'sans parmesan', nouvelle: true },
              ],
            },
          ]}
        />,
      ),
  },
  {
    nom: 'Journée / Tableau de bord (tableau écrit dans la page)',
    saisie: false,
    html: () =>
      `<aside class="laterale"></aside><button class="bouton-menu">☰ Menu</button>` +
      `<main class="enveloppe"><h1>Journée</h1><section class="carte"><table><thead><tr>` +
      ['Caisse', 'Ouverte par', 'Fermée par', 'Fond', 'Espèces', 'Attendu', 'Compté', 'Écart']
        .map((h) => `<th>${h}</th>`)
        .join('') +
      `</tr></thead><tbody><tr>` +
      ['Comptoir principal', 'Salma Trabelsi', 'Ahmed Ben Salah', '50,000 TND', '1 234,500 TND',
       '1 284,500 TND', '1 280,000 TND', '−4,500 TND']
        .map((c) => `<td>${c}</td>`)
        .join('') +
      `</tr></tbody></table></section></main>`,
  },
]

const APPAREILS = [
  { nom: 'iPhone 15', width: 390, height: 844 },
  { nom: 'petit Android', width: 320, height: 690 },
]

let nav: Browser
beforeAll(async () => {
  const chemin = process.env['CHROMIUM_PATH']
  nav = await chromium.launch(chemin ? { executablePath: chemin, args: ['--no-sandbox'] } : {})
})
afterAll(async () => {
  await nav?.close()
})

async function mesurer(html: string, largeur: number, hauteur: number) {
  const onglet = await nav.newPage({
    viewport: { width: largeur, height: hauteur },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  try {
    await onglet.setContent(
      `<!doctype html><html lang="${LANGUE_DU_PASSAGE}" dir="${direction(LANGUE_DU_PASSAGE)}"><head><meta charset="utf-8">
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <style>*{box-sizing:border-box}html,body{margin:0}</style>
       <style>${STYLES}</style></head><body>${html}</body></html>`,
      { waitUntil: 'load' },
    )
    return await onglet.evaluate((demandee) => {
      const nommer = (el: Element) =>
        el.tagName.toLowerCase() +
        (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).join('.')
          : '')
      // Dans un conteneur qui DÉFILE, dépasser est voulu : c'est le conteneur
      // qui doit tenir — et il est mesuré comme le reste.
      const dansUnDefilant = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX
          if (o === 'auto' || o === 'scroll') return true
        }
        return false
      }
      const depassent: string[] = []
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.laterale')) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (dansUnDefilant(el)) continue
        if (r.right > demandee + 1 || r.left < -1) depassent.push(`${nommer(el)} → ${Math.round(r.right)} px`)
      }
      // Les champs de NOM des lignes de saisie : assez larges pour se relire.
      const nomsEcrases = [...document.querySelectorAll('main table input:not([type=checkbox]):not([type=hidden])')]
        .map((el) => el as HTMLInputElement)
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 7 * 16)
        .map((el) => `${el.name || 'champ'} : ${Math.round(el.getBoundingClientRect().width)} px`)
      return {
        page: Math.max(document.documentElement.scrollWidth, window.innerWidth),
        depassent: depassent.slice(0, 8),
        nomsEcrases: nomsEcrases.slice(0, 8),
      }
    }, largeur)
  } finally {
    await onglet.close()
  }
}

describe(`écrans à tableaux — ${LANGUE_DU_PASSAGE === 'ar' ? 'arabe' : 'français'}`, () => {
  for (const appareil of APPAREILS) {
    for (const ecran of ECRANS) {
      it(`${ecran.nom} tient sur ${appareil.nom} (${appareil.width} px)`, async () => {
        const m = await mesurer(ecran.html(), appareil.width, appareil.height)
        expect(m.depassent, 'éléments hors de l’écran — la page s’élargit, Safari dézoome').toEqual([])
        expect(m.page, 'la PAGE est plus large que l’écran').toBeLessThanOrEqual(appareil.width + 1)
        if (ecran.saisie) {
          expect(m.nomsEcrases, 'un champ de saisie écrasé — le nom ne se lit plus').toEqual([])
        }
      })
    }
  }
})
