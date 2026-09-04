/**
 * Tableau de bord — les six chiffres qu'un restaurateur regarde d'abord.
 *
 * Chiffre d'affaires, tickets, panier moyen, coût, marge brute et marge %.
 * Tous calculés par `@kaissi/domain`, le MÊME module que la caisse : il n'y
 * a pas deux façons d'additionner de l'argent dans ce dépôt (RÈGLE 7).
 */

import Link from 'next/link'
import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { journeeCourante, libelleJournee } from '../../../serveur/journee.js'
import { chargerFiche, chargerVentes, resoudrePeriode } from '../../../serveur/ventes.js'
import {
  calculerIndicateurs,
  ventilerParCategorie,
  ventilerParProduit,
} from '../../../serveur/rapports.js'
import { SelecteurPeriode } from '../../../composants/SelecteurPeriode.js'

export const dynamic = 'force-dynamic'

export default async function PageTableauBord({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<{ du?: string; au?: string }>
}) {
  const { restaurant } = await params
  const { du, au } = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const fiche = await chargerFiche(restaurant)
  const periode = resoudrePeriode(fiche, du, au)
  const ventes = await chargerVentes(restaurant, periode)
  const aujourdhui = journeeCourante(fiche.timezone, fiche.bascule)

  if (ventes.erreur) {
    return (
      <section className="bloc">
        <h1>Tableau de bord</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
  const parProduit = ventilerParProduit(ventes.lignes)
  const parCategorie = ventilerParCategorie(ventes.lignes)

  return (
    <>
      <header className="entete-rapport">
        <h1>Tableau de bord</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du)
            : `Du ${libelleJournee(periode.du)} au ${libelleJournee(periode.au)}`}
        </p>
      </header>

      <SelecteurPeriode du={periode.du} au={periode.au} aujourdhui={aujourdhui} />

      {periode.tronquee && (
        <p className="message avertissement">
          Période ramenée à 92 jours. Au-delà, ce n’est plus un rapport de
          gestion mais un export comptable.
        </p>
      )}

      <div className="cartes-kpi">
        <Kpi
          libelle="Chiffre d'affaires"
          valeur={formaterTND(i.caNetMillimes)}
          aide="Hors taxe, après remises — la grandeur comparable au coût d'achat."
          fort
        />
        <Kpi libelle="Tickets" valeur={String(i.nombreTickets)} aide="Commandes encaissées." />
        <Kpi
          libelle="Panier moyen"
          valeur={i.panierMoyenMillimes === null ? '—' : formaterTND(i.panierMoyenMillimes)}
          aide="CA ÷ nombre de tickets."
        />
        <Kpi
          libelle="Coût total"
          valeur={formaterTND(i.coutMillimes)}
          aide="Somme des coûts d'achat des articles vendus."
        />
        <Kpi
          libelle="Marge brute"
          valeur={formaterTND(i.marge.margeMillimes)}
          aide="Chiffre d'affaires − coût d'achat."
          negatif={i.marge.margeMillimes < 0}
          fort
        />
        <Kpi
          libelle="Marge %"
          valeur={i.marge.margeBp === null ? '—' : `${formaterPourcentage(i.marge.margeBp)} %`}
          aide="Marge rapportée au chiffre d'affaires."
          negatif={(i.marge.margeBp ?? 0) < 0}
        />
      </div>

      {i.lignesSansCout > 0 && (
        <p className="message avertissement">
          <strong>{i.lignesSansCout} ligne(s) vendue(s) sans coût d’achat saisi.</strong> Le
          coût total est donc sous-estimé, et la marge d’autant surestimée.{' '}
          <Link href={`/${restaurant}/catalogue`}>Renseigner les coûts au catalogue</Link>.
        </p>
      )}

      <div className="grille deux">
        <section className="bloc">
          <h2>Remises et remboursements</h2>
          <dl className="lignes-chiffres">
            <dt>Chiffre d’affaires brut</dt>
            <dd>{formaterTND(i.caBrutMillimes)}</dd>
            <dt>Remises accordées</dt>
            <dd className={i.remisesMillimes > 0 ? 'attention' : ''}>
              − {formaterTND(i.remisesMillimes)}
            </dd>
            <dt className="fort">Chiffre d’affaires net</dt>
            <dd className="fort">{formaterTND(i.caNetMillimes)}</dd>
            <dt>Remboursements</dt>
            <dd className={i.remboursementsMillimes > 0 ? 'attention' : ''}>
              {formaterTND(i.remboursementsMillimes)}
            </dd>
          </dl>
          <p className="indication">
            Les remboursements sont des montants TTC portés sur un encaissement.
            Ils sont présentés à part du CA, qui est hors taxe : les additionner
            fausserait la marge d’un point de TVA.
          </p>
        </section>

        <section className="bloc">
          <h2>Volume</h2>
          <dl className="lignes-chiffres">
            <dt>Articles vendus</dt>
            <dd>{i.articlesVendus}</dd>
            <dt>Références différentes</dt>
            <dd>{parProduit.length}</dd>
            <dt>Catégories actives</dt>
            <dd>{parCategorie.length}</dd>
          </dl>
        </section>
      </div>

      <section className="bloc">
        <h2>Meilleures ventes</h2>
        {parProduit.length === 0 ? (
          <p className="vide">Aucune vente sur cette période.</p>
        ) : (
          <TableauVentilation lignes={parProduit.slice(0, 10)} entete="Produit" />
        )}
        <p style={{ marginTop: '0.75rem' }}>
          <Link
            href={{
              pathname: `/${restaurant}/ventes`,
              query: { du: periode.du, au: periode.au },
            }}
          >
            Voir toutes les ventilations →
          </Link>
        </p>
      </section>
    </>
  )
}

function Kpi({
  libelle,
  valeur,
  aide,
  fort,
  negatif,
}: {
  libelle: string
  valeur: string
  aide: string
  fort?: boolean
  negatif?: boolean
}) {
  return (
    <div className={`kpi ${fort ? 'fort' : ''}`}>
      <span className="kpi-libelle">{libelle}</span>
      <span className={`kpi-valeur ${negatif ? 'negatif' : ''}`}>{valeur}</span>
      <span className="kpi-aide">{aide}</span>
    </div>
  )
}

export function TableauVentilation({
  lignes,
  entete,
}: {
  lignes: readonly {
    cle: string
    libelle: string
    quantite: number
    part: number
    marge: { caMillimes: number; coutMillimes: number; margeMillimes: number; margeBp: number | null }
  }[]
  entete: string
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>{entete}</th>
          <th className="nombre">Qté</th>
          <th className="nombre">CA</th>
          <th className="nombre">Part</th>
          <th className="nombre">Coût</th>
          <th className="nombre">Marge</th>
          <th className="nombre">Marge %</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.cle}>
            <td>{l.libelle}</td>
            <td className="nombre">{l.quantite}</td>
            <td className="nombre">{formaterTND(millimes(l.marge.caMillimes))}</td>
            <td className="nombre">{formaterPourcentage(l.part)} %</td>
            <td className="nombre">{formaterTND(millimes(l.marge.coutMillimes))}</td>
            <td className={`nombre ${l.marge.margeMillimes < 0 ? 'ecart negatif' : ''}`}>
              {formaterTND(millimes(l.marge.margeMillimes))}
            </td>
            <td className="nombre">
              {l.marge.margeBp === null ? '—' : `${formaterPourcentage(l.marge.margeBp)} %`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
