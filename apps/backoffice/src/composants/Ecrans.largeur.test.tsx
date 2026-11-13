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
vi.mock('../app/editeur/actions.js', () => ({
  traiterIncident: () => undefined,
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
const { VueSupervision } = await import('./VueSupervision.js')
const { creerTraduction } = await import('../i18n/commun.js')


// ── Le centre de supervision : un jour chargé, deux incidents, un journal ──
function supervisionDeTest() {
  const debut = Date.parse('2026-11-13T00:00:00.000Z')
  const serie = Array.from({ length: 120 }, (_, i) => ({
    debut: new Date(debut + i * 720_000).toISOString(),
    requetes: 400 + (i % 17) * 30, erreurs5xx: i % 40 === 0 ? 3 : 0, erreurs4xx: 12,
    latenceMoyenneMs: 38, pushP95Ms: 140 + (i % 9) * 20, pushP99Ms: 400, pullP95Ms: 90,
    concurrenceMax: 14, evenementsRecus: 900, cpuPourcent: 22.5, rssOctets: 180_000_000,
    boucleP99Ms: 24, baseLatenceMs: 6, baseTailleOctets: 812_000_000, baseConnexions: 31,
    poolEnAttente: 0, cachePourcent: 99.4, caissesVues15min: 46, echecsAuthentification: i % 30 === 0 ? 12 : 1,
    limitesDeDebit: 0, accesRefuses: 0, redemarrages: i === 60 ? 1 : 0,
  }))
  const incident = (id: string, niveau: string, statut: 'ouvert' | 'pris_en_charge' | 'resolu') => ({
    id, cle: 'securite.source:203.0.113.0/24', niveau, statut,
    sujet: 'Rafale de refus depuis un même réseau',
    message: '37 identifications refusées en 15 minutes depuis 203.0.113.0/24 — un essai systématique de mots de passe, ou une caisse mal configurée qui insiste.',
    ouvertLe: '2026-11-13T09:12:00.000Z', dernierVuLe: '2026-11-13T10:40:00.000Z', occurrences: 88,
    prisEnChargePar: statut === 'ouvert' ? null : 'exploitation@res2boost.tn', prisEnChargeLe: null,
    resoluLe: statut === 'resolu' ? '2026-11-13T11:00:00.000Z' : null,
    resolution: statut === 'resolu' ? 'automatique' : null, resoluPar: null,
    note: 'Appel au gérant du Snack Lac 1 : tablette réinitialisée, ancienne session encore ouverte.',
  })
  return {
    horodatage: '2026-11-13T23:59:00.000Z', fenetre: '24h' as const, categorie: null, niveau: null,
    collecteur: { instance: 'railway-7f3a', intervalleSecondes: 60, requetesEnCours: 3, evenementsEnAttente: 0, evenementsIgnores: 0, derniereEcriture: { instant: '2026-11-13T23:58:00.000Z', ok: true, erreur: null } },
    vivant: {
      horodatage: '2026-11-13T23:59:00.000Z', demarreLe: '2026-11-13T12:00:00.000Z', dureeVieSecondes: 43_000,
      processus: { node: 'v22.11.0', coeurs: 2, chargeSysteme: [0.42, 0.38, 0.35], memoireSystemeOctets: 8e9, memoireLibreOctets: 5e9, rssOctets: 1.8e8, tasOctets: 9e7, tasTotalOctets: 1.2e8, historique: [] },
      requetes: { parMinute: [], familles15min: [] }, erreursRecentes: [],
      base: { latenceMs: 6, tailleOctets: 812_000_000, connexions: 31, connexionsActives: 4, connexionsMax: 60, attentesVerrou: 0, requetePlusLongueSecondes: 0.4, cachePourcent: 99.4, validations: 1_284_331, annulations: 212, interblocages: 0, tables: [], pool: { total: 10, libres: 7, enAttente: 0, max: 10 }, metier: { evenements1h: 3_400, evenements24h: 61_000, commandes1h: 410, rejets24h: 2, caisses: 52, caissesVues15min: 46, caissesMuettes24h: 1, projectionsManquantes: 0 } },
      erreurBase: null, migrationsManquantes: [],
      alertes: [{ niveau: 'attention' as const, sujet: 'Caisses muettes', message: '1 caisse active ne s’est pas synchronisée depuis 24 h.' }],
    },
    historique: {
      seauSecondes: 720, serie,
      incidentsOuverts: [incident('i1', 'critique', 'ouvert'), incident('i2', 'attention', 'pris_en_charge')],
      incidentsRecents: [incident('i3', 'attention', 'resolu')],
      evenements: Array.from({ length: 6 }, (_, i) => ({
        id: i, instant: '2026-11-13T10:40:00.000Z', categorie: 'securite', type: i % 2 ? 'jeton_appareil_refuse' : 'operation_rejetee',
        niveau: 'attention', restaurant: 'Snack Lac 1 — Les Berges du Lac', terminal: 'Comptoir principal', origine: '2001:db8:85a3::/48',
        message: '3 opération(s) refusée(s) par le serveur — code « transition_invalide_depuis_un_etat_annule ».',
        detail: { code: 'transition_invalide_depuis_un_etat_annule', n: 3, famille: 'push' },
      })),
      comptesEvenements: [{ categorie: 'securite', niveau: 'attention', n: 41 }],
      terminaux: [
        { deviceId: 'd1', libelle: 'Comptoir principal — tablette Samsung', restaurant: 'Snack Lac 1 — Les Berges du Lac', version: '1.4.2', vuLe: '2026-11-13T23:58:00.000Z', dernierEnvoi: '2026-11-13T23:58:00.000Z', dernierPull: null, rejets24h: 2 },
        { deviceId: 'd2', libelle: 'Terrasse', restaurant: 'Café des Arts', version: null, vuLe: null, dernierEnvoi: null, dernierPull: null, rejets24h: 0 },
      ],
      totaux: { requetes: 61_200, erreurs5xx: 9, erreurs4xx: 1_440, echecsAuthentification: 172, limitesDeDebit: 0, redemarrages: 1, disponibilitePourcent: 99.985 },
    },
    erreurHistorique: null,
  }
}

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
    `<aside class="laterale"></aside><div class="barre-mobile"><button class="bouton-menu" aria-label="Menu">☰</button><div class="barre-mobile-titre"><strong>Liste d’articles</strong><span>Snack Lac 1 — Les Berges du Lac</span></div></div>` +
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
    nom: 'Éditeur → Supervision',
    saisie: false,
    html: () =>
      `<div class="barre"><span class="marque">Kaissi</span></div>` +
      rendre(
        <VueSupervision
          etat={supervisionDeTest()}
          fenetre="24h"
          categorie={null}
          niveau={null}
          t={creerTraduction(LANGUE_DU_PASSAGE)}
        />,
      ),
  },
  {
    nom: 'Journée / Tableau de bord (tableau écrit dans la page)',
    saisie: false,
    html: () =>
      `<aside class="laterale"></aside><div class="barre-mobile"><button class="bouton-menu" aria-label="Menu">☰</button><div class="barre-mobile-titre"><strong>Liste d’articles</strong><span>Snack Lac 1 — Les Berges du Lac</span></div></div>` +
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
