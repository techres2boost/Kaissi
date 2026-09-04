/**
 * « Ventes par article » — ce qui se vend, et ce qui rapporte.
 *
 * ── Pourquoi un écran à part, alors que Ventes a déjà un tableau ──────────
 *
 * L'écran Ventes répond à « combien ai-je fait ». Celui-ci répond à « avec
 * quoi » — et c'est la question qu'un restaurateur se pose pour décider quoi
 * garder à la carte, quoi mettre en avant, et quoi arrêter. Noyée en bas
 * d'un récapitulatif financier, elle se lit mal ; seule, elle se classe, se
 * bascule entre chiffre d'affaires et quantité, et s'exporte.
 *
 * ── Les deux classements ne donnent PAS le même gagnant ───────────────────
 *
 * Le plus vendu n'est presque jamais celui qui rapporte le plus : on vend
 * cent cafés et douze couscous. Trier par quantité désigne le café, trier
 * par chiffre d'affaires désigne le couscous — et la décision commerciale
 * n'est pas la même. L'écran refuse donc de choisir à la place du gérant :
 * il bascule, et le classement se renumérote.
 */

import { formaterPourcentage, formaterTND } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { chargerFiche, chargerVentes, resoudrePeriode } from '../../../serveur/ventes.js'
import {
  calculerIndicateurs,
  ventilerParCategorie,
  ventilerParJournee,
  ventilerParProduit,
  type Ventilation,
} from '../../../serveur/rapports.js'
import { journeeCourante, libelleJournee } from '../../../serveur/journee.js'
import { BarresClassement, type LigneClassement } from '../../../composants/BarresClassement.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { CourbeJournaliere } from '../../../composants/CourbeJournaliere.js'
import { SelecteurPeriode } from '../../../composants/SelecteurPeriode.js'
import { BasculeMesure } from '../../../composants/BasculeMesure.js'

export const dynamic = 'force-dynamic'

/** Adapte une ventilation du domaine à ce que le classement affiche. */
function versClassement(v: Ventilation): LigneClassement {
  return {
    cle: v.cle,
    libelle: v.libelle,
    quantite: v.quantite,
    caMillimes: v.marge.caMillimes,
    margeMillimes: v.marge.margeMillimes,
    margeBp: v.marge.margeBp,
    partBp: v.part,
  }
}

export default async function PageArticles({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<{ du?: string; au?: string; mesure?: string }>
}) {
  const { restaurant } = await params
  const { du, au, mesure: mesureBrute } = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const fiche = await chargerFiche(restaurant)
  const periode = resoudrePeriode(fiche, du, au)
  const ventes = await chargerVentes(restaurant, periode)
  const aujourdhui = journeeCourante(fiche.timezone, fiche.bascule)
  // Toute valeur inattendue retombe sur le chiffre d'affaires : c'est le
  // classement qu'on veut par défaut, et une URL bricolée ne doit pas
  // produire un écran vide.
  const mesure = mesureBrute === 'quantite' ? 'quantite' : 'ca'

  if (ventes.erreur) {
    return (
      <section className="bloc">
        <h1>Ventes par article</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
  const articles = ventilerParProduit(ventes.lignes).map(versClassement)
  const categories = ventilerParCategorie(ventes.lignes).map(versClassement)
  const jours = ventilerParJournee(ventes.commandes, fiche.timezone, fiche.bascule, {
    du: periode.du,
    au: periode.au,
  })

  // Le meneur DU CLASSEMENT AFFICHÉ, pas du chiffre d'affaires : afficher
  // « le plus vendu » en tête d'un écran trié par CA ferait lire deux
  // réponses différentes à la même question.
  const meneur =
    articles.length === 0
      ? null
      : [...articles].sort((a, b) =>
          mesure === 'ca' ? b.caMillimes - a.caMillimes : b.quantite - a.quantite,
        )[0]!

  return (
    <>
      <header className="entete-rapport">
        <h1>Ventes par article</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du)
            : `Du ${libelleJournee(periode.du)} au ${libelleJournee(periode.au)}`}
        </p>
      </header>

      <SelecteurPeriode du={periode.du} au={periode.au} aujourdhui={aujourdhui} />

      <BoutonsExport
        restaurantId={restaurant}
        exports={[
          { quoi: 'articles', libelle: 'Par article' },
          { quoi: 'categories', libelle: 'Par catégorie' },
        ]}
        du={periode.du}
        au={periode.au}
      />

      <div className="cartes-kpi">
        <div className="kpi">
          <span className="kpi-libelle">Articles vendus</span>
          <span className="kpi-valeur">{i.articlesVendus}</span>
          <span className="kpi-aide">{articles.length} référence(s) différentes</span>
        </div>
        <div className="kpi">
          <span className="kpi-libelle">
            {mesure === 'ca' ? 'Rapporte le plus' : 'Le plus vendu'}
          </span>
          <span className="kpi-valeur" style={{ fontSize: '1.1rem' }}>
            {meneur?.libelle ?? '—'}
          </span>
          <span className="kpi-aide">
            {meneur
              ? mesure === 'ca'
                ? `${formaterPourcentage(meneur.partBp)} % du chiffre d’affaires`
                : `${meneur.quantite} unité(s) vendues`
              : 'Aucune vente'}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-libelle">Chiffre d’affaires net</span>
          <span className="kpi-valeur">{formaterTND(i.caNetMillimes)}</span>
          <span className="kpi-aide">Après remises, hors taxe exclusive</span>
        </div>
        <div className="kpi">
          <span className="kpi-libelle">Marge brute</span>
          <span className={`kpi-valeur ${i.marge.margeMillimes < 0 ? 'negatif' : ''}`}>
            {formaterTND(i.marge.margeMillimes)}
          </span>
          <span className="kpi-aide">
            {i.marge.margeBp === null
              ? 'Non calculable'
              : `${formaterPourcentage(i.marge.margeBp)} % du CA`}
          </span>
        </div>
      </div>

      {i.lignesSansCout > 0 && (
        <p className="indication">
          ⚠ {i.lignesSansCout} ligne(s) sans coût d’achat saisi : les marges
          ci-dessous sont surestimées d’autant. Le coût se saisit au{' '}
          <strong>Menu</strong>.
        </p>
      )}

      <section className="bloc">
        <h2>Évolution jour par jour</h2>
        <CourbeJournaliere jours={jours} />
      </section>

      <section className="bloc">
        <div className="entete-bloc">
          <h2>Classement des articles</h2>
          <BasculeMesure restaurantId={restaurant} du={periode.du} au={periode.au} mesure={mesure} />
        </div>
        <BarresClassement lignes={articles} entete="Article" mesure={mesure} />
      </section>

      <section className="bloc">
        <h2>Par catégorie</h2>
        <BarresClassement lignes={categories} entete="Catégorie" mesure={mesure} />
      </section>
    </>
  )
}
