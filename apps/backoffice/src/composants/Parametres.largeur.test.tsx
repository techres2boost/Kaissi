/**
 * Les écrans à FORMULAIRES EN RANGÉE tiennent-ils dans un téléphone ?
 *
 * ── Pourquoi ces écrans-là, et pas seulement « ça compile » ───────────────
 *
 * Ce sont ceux qui posent plusieurs champs sur une MÊME LIGNE : un nom, un
 * taux, une case, un bouton. C'est exactement la forme qui a cassé sur
 * l'iPhone — l'adresse e-mail et « Se déconnecter » l'un par-dessus l'autre —
 * et elle ne casse aucun test fonctionnel : l'écran devient inutilisable sans
 * que rien n'échoue.
 *
 * Le fichier porte encore le nom « Parametres » ; « Modificateurs » vit dans
 * « Articles ». Ce qui les réunit n'est pas la rubrique mais la FORME, et
 * c'est elle qu'on mesure.
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
import { etatAbonnement, finEssaiDepuis } from '@kaissi/domain'

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

vi.mock('../app/[restaurant]/modificateurs/actions.js', () => ({
  archiverGroupe: () => undefined,
  archiverModificateur: () => undefined,
  creerGroupe: () => undefined,
  creerModificateur: () => undefined,
  modifierGroupe: () => undefined,
  modifierModificateur: () => undefined,
  rattacherGroupe: () => undefined,
}))

const { GestionTaxes } = await import('./GestionTaxes.js')
const { GestionModesPaiement } = await import('./GestionModesPaiement.js')
const { GestionImprimantes } = await import('./GestionImprimantes.js')
const { OptionsRestauration } = await import('./OptionsRestauration.js')
// Aucune action serveur à simuler : `ListeFonctionnalites` est en LECTURE
// seule, et c'est le sujet de l'écran.
const { ListeFonctionnalites, ICONES } = await import('./ListeFonctionnalites.js')
const { GestionModificateurs } = await import('./GestionModificateurs.js')
// En lecture seule lui aussi, et c'est un TABLEAU — la forme qui déborde le
// plus facilement d'un téléphone, et celle que `.tableau-defilant` est censé
// tenir. Le mesurer vérifie que ce conteneur fait bien son travail.
const { ComparatifFormules } = await import('./ComparatifFormules.js')
vi.mock('../app/[restaurant]/inventaire/actions.js', () => ({
  archiverFournisseur: () => undefined,
  creerFournisseur: () => undefined,
  modifierFournisseur: () => undefined,
}))
// Quatre champs et un bouton sur une même rangée : la forme exacte qui a
// cassé sur l'iPhone, et celle que ce fichier existe pour mesurer.
const { GestionFournisseurs } = await import('./GestionFournisseurs.js')
// Un TABLEAU de chiffres à quatre colonnes — l'autre forme qui déborde, et
// que `.tableau-defilant` doit tenir.
const { TableauValorisation } = await import('./TableauValorisation.js')

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

      /*
       * Dans un conteneur qui DÉFILE à l'horizontale, dépasser est le
       * comportement voulu.
       *
       * `.tableau-defilant` existe pour cela : un tableau de chiffres à
       * quatre colonnes ne rentre pas dans 320 px, et le comprimer jusqu'à ce
       * qu'il rentre le rendrait illisible. Ce qu'on exige alors, c'est que
       * le CONTENEUR, lui, tienne — il est mesuré comme tout le reste, et la
       * page ne défile donc jamais latéralement.
       *
       * Sans cette exception, le garde-fou interdirait le seul motif que ce
       * dépôt a retenu pour les tableaux larges, et on le contournerait en
       * ajoutant des exclusions au cas par cas — ce qui finirait par le
       * rendre inoffensif.
       */
      const dansUnDefilant = (el: Element): boolean => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX
          if (o === 'auto' || o === 'scroll') return true
        }
        return false
      }

      const depassent: string[] = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (dansUnDefilant(el)) continue
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
        /*
         * Le texte réservé aux lecteurs d'écran est rogné EXPRÈS, à 1 px :
         * c'est toute sa raison d'être. Le compter ferait échouer le garde-fou
         * sur chaque écran qui nomme une icône — c'est-à-dire sur les écrans
         * les plus soigneusement accessibles, et ce serait le contraire de ce
         * qu'on veut encourager.
         */
        if (el.classList.contains('visuellement-cache')) continue
        /*
         * Un CHAMP de saisie n'est pas un contenu hors d'atteinte : son texte
         * défile avec le curseur, et c'est ainsi que tout champ se comporte
         * dès qu'on y tape plus large que lui. Le compter ferait échouer ce
         * garde-fou sur chaque écran dont un champ porte une valeur longue —
         * une note de fournisseur, une adresse — alors que rien n'est perdu
         * ni inaccessible.
         */
        if (el.matches('input, textarea, select')) continue
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

const FONCTIONNALITES = [
  {
    cle: 'tickets',
    nom: 'Tickets ouverts',
    icone: ICONES.Ticket,
    etat: 'structurelle' as const,
    quoi: 'Une commande reste ouverte sur une table, s’enrichit au fil du service, et ne s’encaisse qu’à la fin.',
    pourquoi:
      'Non débrayable, parce que ce n’est pas une option chez Kaissi : la salle est BÂTIE dessus. ' +
      'Une commande est un journal d’événements, pas une ligne qu’on remplit d’un coup — c’est ce ' +
      'qui permet à deux tablettes hors ligne d’ajouter chacune un article à la table 12 sans le moindre conflit.',
    chemin: 'preparation',
    lien: 'Voir les commandes en cours',
  },
  {
    cle: 'postes',
    nom: 'Postes de préparation',
    icone: ICONES.UtensilsCrossed,
    etat: 'active' as const,
    quoi: 'Cuisine, bar, pâtisserie : chaque poste voit les lignes qu’il prépare, et rien d’autre.',
    pourquoi: 'Le poste vient de la CATÉGORIE, pas de l’article.',
    constat: '3 poste(s), dont 1 avec une imprimante réglée.',
    chemin: 'categories',
    lien: 'Régler les postes et leurs catégories',
  },
  {
    cle: 'impression',
    nom: 'Impression des tickets et bons',
    icone: ICONES.Printer,
    etat: 'eteinte' as const,
    quoi: 'Ticket client et bon de cuisine envoyés à une imprimante réseau.',
    pourquoi: 'Le module est ÉCRIT, TESTÉ et embarqué — simplement pas allumé dans cette version.',
    chemin: 'imprimantes',
    lien: 'Régler les imprimantes malgré tout',
  },
  {
    cle: 'fidelite',
    nom: 'Programme de fidélité',
    icone: ICONES.Percent,
    etat: 'absente' as const,
    quoi: 'Points cumulés par client, et récompenses à dépenser en caisse.',
    pourquoi: 'Rien n’existe en base pour le porter — ni les points, ni leur historique.',
  },
]

/*
 * Un groupe RATTACHÉ et un groupe ORPHELIN : le second déplie tout seul sa
 * liste d'articles — c'est l'état le plus large de l'écran, et celui qu'un
 * jeu « propre » aurait laissé replié, donc jamais mesuré.
 */
const MODIF_ARTICLES = [
  { id: 'p1', nom: 'Pizza Quatre Fromages', categorieNom: 'Plats' },
  { id: 'p2', nom: 'Ojja merguez aux œufs', categorieNom: 'Plats' },
  { id: 'p3', nom: 'Coca', categorieNom: 'Boissons' },
]
const MODIF_GROUPES = [
  {
    id: 'g1',
    nom: 'Cuisson',
    minSelect: 1,
    maxSelect: 1,
    archive: false,
    choix: [
      { id: 'c1', nom: 'Saignant', deltaMillimes: 0, archive: false },
      { id: 'c2', nom: 'Bien cuit', deltaMillimes: 0, archive: false },
    ],
    produits: ['p2'],
  },
  {
    id: 'g2',
    nom: 'Suppléments à la demande',
    minSelect: 0,
    maxSelect: 0,
    archive: false,
    // Un delta NÉGATIF : le champ affiche alors un signe en plus, et c'est
    // la valeur la plus large que ce champ reçoive.
    choix: [{ id: 'c3', nom: 'Sans oignon', deltaMillimes: -500, archive: false }],
    produits: [],
  },
]

const FOURNISSEURS = [
  {
    id: 'f1',
    nom: 'Sfax Primeurs et Maraîchers Réunis',
    contact: 'Monsieur Slim Ben Abdallah',
    telephone: '+216 74 000 000',
    note: 'Livraisons le mardi et le vendredi matin, facture à trente jours.',
    archive: false,
    receptions: 24,
  },
  { id: 'f2', nom: 'Boucherie', contact: null, telephone: null, note: null, archive: false, receptions: 0 },
  {
    id: 'f3',
    nom: 'Ancien Grossiste',
    contact: null,
    telephone: null,
    note: null,
    archive: true,
    receptions: 3,
  },
]

const VALORISATION = [
  { id: 'v1', nom: 'Pizza Quatre Fromages surgelée', quantite: 12.5, coutUnitaire: 4250.125 },
  // Le coût non saisi : la cellule dit « non saisi », la valeur reste vide.
  { id: 'v2', nom: 'Ojja merguez', quantite: 3, coutUnitaire: null },
  // La quantité négative — le cas normal d'une réception oubliée.
  { id: 'v3', nom: 'Coca 33 cl', quantite: -40, coutUnitaire: 0.6 },
]

describe('les écrans de réglage, en largeur téléphone', () => {
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
    {
      nom: 'Modificateurs',
      html: () =>
        renderToStaticMarkup(
          <GestionModificateurs
            restaurantId="r1"
            modifiable
            groupes={MODIF_GROUPES}
            articles={MODIF_ARTICLES}
          />,
        ),
    },
    {
      /*
       * Les fiches fournisseurs avec le jeu le plus LARGE : un nom long d'un
       * seul tenant, une note de deux lignes, et une fiche archivée — celle
       * qui déplie son bloc et ajoute une phrase de plus sous la rangée.
       */
      nom: 'Fournisseurs',
      html: () =>
        renderToStaticMarkup(
          <GestionFournisseurs restaurantId="r1" modifiable fournisseurs={FOURNISSEURS} />,
        ),
    },
    {
      /*
       * La valorisation avec un coût NON SAISI et une quantité NÉGATIVE :
       * les deux cellules les plus larges de ce tableau, et les deux cas que
       * l'écran existe pour montrer.
       */
      nom: 'Valorisation du stock',
      html: () => renderToStaticMarkup(<TableauValorisation lignes={VALORISATION} />),
    },
    {
      /*
       * Le comparatif des formules PENDANT UN ESSAI : aucune colonne n'est
       * mise en évidence, l'en-tête porte deux noms de formule, et le rappel
       * sous le tableau est la phrase la plus longue de l'écran. C'est aussi
       * le seul tableau de la rubrique, donc le seul endroit où une colonne
       * qui refuse de rétrécir pousserait la page entière.
       */
      nom: 'Comparatif des formules',
      html: () =>
        renderToStaticMarkup(
          <ComparatifFormules
            etat={etatAbonnement(
              { plan: 'essai', finEssai: finEssaiDepuis(new Date('2026-09-15T10:00:00Z')) },
              new Date('2026-09-15T10:00:00Z'),
            )}
          />,
        ),
    },
    {
      /*
       * Les quatre états à la fois, avec les textes les PLUS LONGS de
       * l'écran — l'explication des tickets ouverts fait quatre lignes sur un
       * téléphone, et l'étiquette « Éteinte dans cette version » est la plus
       * large. Un jeu court aurait laissé passer l'en-tête, qui pose le nom et
       * l'étiquette sur une même rangée.
       */
      nom: 'Fonctionnalités',
      html: () =>
        renderToStaticMarkup(
          <ListeFonctionnalites restaurantId="r1" fonctionnalites={FONCTIONNALITES} />,
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
