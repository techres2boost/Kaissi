/**
 * Récapitulatif des ventes, et ses quatre ventilations.
 *
 * Par produit, par catégorie, par employé, par moyen de paiement — les
 * quatre questions qu'un gérant se pose devant son chiffre. Toutes calculées
 * à partir des MÊMES lignes que le tableau de bord (`chargerVentes`), donc
 * sans risque que les deux écrans se contredisent.
 */

import { formaterPourcentage, formaterTND } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { journeeCourante, libelleJournee } from '../../../serveur/journee.js'
import { chargerFiche, chargerVentes, resoudrePeriode } from '../../../serveur/ventes.js'
import {
  calculerIndicateurs,
  ventilerParCategorie,
  ventilerParEmploye,
  ventilerParJournee,
  ventilerParPaiement,
  ventilerParProduit,
} from '../../../serveur/rapports.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { CourbeJournaliere } from '../../../composants/CourbeJournaliere.js'
import { SelecteurPeriode } from '../../../composants/SelecteurPeriode.js'
import { TableauVentilation } from '../tableau-bord/page.js'

export const dynamic = 'force-dynamic'

export default async function PageVentes({
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
        <h1>Ventes</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
  const paiements = ventilerParPaiement(ventes.paiements)
  const totalEncaisse = paiements.reduce((t, p) => t + p.montantMillimes, 0)

  return (
    <>
      <header className="entete-rapport">
        <h1>Ventes</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du)
            : `Du ${libelleJournee(periode.du)} au ${libelleJournee(periode.au)}`}
        </p>
      </header>

      <SelecteurPeriode du={periode.du} au={periode.au} aujourdhui={aujourdhui} />

      {/* Les bornes affichées sont recopiées dans le lien : sans elles, on
          regarde septembre et on télécharge la semaine en cours. */}
      <BoutonsExport
        restaurantId={restaurant}
        exports={[{ quoi: 'ventes', libelle: 'Résumé' }, { quoi: 'articles', libelle: 'Par article' }, { quoi: 'categories', libelle: 'Par catégorie' }, { quoi: 'employes', libelle: 'Par employé' }, { quoi: 'paiements', libelle: 'Paiements' }]}
        du={periode.du}
        au={periode.au}
      />

      <section className="bloc">
        <h2>Évolution jour par jour</h2>
        <CourbeJournaliere
          jours={ventilerParJournee(ventes.commandes, fiche.timezone, fiche.bascule, {
            du: periode.du,
            au: periode.au,
          })}
        />
      </section>

      <section className="bloc">
        <h2>Récapitulatif</h2>
        <dl className="lignes-chiffres">
          <dt>Chiffre d’affaires brut</dt>
          <dd>{formaterTND(i.caBrutMillimes)}</dd>
          <dt>Remises accordées</dt>
          <dd className={i.remisesMillimes > 0 ? 'attention' : ''}>
            − {formaterTND(i.remisesMillimes)}
          </dd>
          <dt className="fort">Chiffre d’affaires net</dt>
          <dd className="fort">{formaterTND(i.caNetMillimes)}</dd>
          <dt>Coût d’achat des articles vendus</dt>
          <dd>− {formaterTND(i.coutMillimes)}</dd>
          <dt className="fort">Marge brute</dt>
          <dd className={`fort ${i.marge.margeMillimes < 0 ? 'ecart negatif' : ''}`}>
            {formaterTND(i.marge.margeMillimes)}
            {i.marge.margeBp !== null && `  (${formaterPourcentage(i.marge.margeBp)} %)`}
          </dd>
          <dt>Remboursements</dt>
          <dd className={i.remboursementsMillimes > 0 ? 'attention' : ''}>
            {formaterTND(i.remboursementsMillimes)}
          </dd>
          <dt>Tickets · panier moyen</dt>
          <dd>
            {i.nombreTickets} ·{' '}
            {i.panierMoyenMillimes === null ? '—' : formaterTND(i.panierMoyenMillimes)}
          </dd>
        </dl>
        {i.lignesSansCout > 0 && (
          <p className="indication">
            ⚠ {i.lignesSansCout} ligne(s) sans coût d’achat saisi : la marge
            ci-dessus est surestimée d’autant.
          </p>
        )}
      </section>

      <section className="bloc">
        <h2>Par produit</h2>
        {ventes.lignes.length === 0 ? (
          <p className="vide">Aucune vente sur cette période.</p>
        ) : (
          <TableauVentilation lignes={ventilerParProduit(ventes.lignes)} entete="Produit" />
        )}
      </section>

      <section className="bloc">
        <h2>Par catégorie</h2>
        {ventes.lignes.length === 0 ? (
          <p className="vide">Aucune vente sur cette période.</p>
        ) : (
          <TableauVentilation lignes={ventilerParCategorie(ventes.lignes)} entete="Catégorie" />
        )}
      </section>

      <section className="bloc">
        <h2>Par employé</h2>
        <p className="indication">
          La vente est attribuée à qui l’a <strong>encaissée</strong> : un serveur
          ouvre la table, c’est le caissier qui conclut.
        </p>
        {ventes.lignes.length === 0 ? (
          <p className="vide">Aucune vente sur cette période.</p>
        ) : (
          <TableauVentilation
            lignes={ventilerParEmploye(ventes.lignes, ventes.commandes, ventes.nomEmploye)}
            entete="Employé"
          />
        )}
      </section>

      <section className="bloc">
        <h2>Par moyen de paiement</h2>
        <p className="indication">
          Montants <strong>encaissés</strong>, donc TTC — ils ne s’additionnent pas
          au chiffre d’affaires net ci-dessus, qui est hors taxe.
        </p>
        {paiements.length === 0 ? (
          <p className="vide">Aucun encaissement sur cette période.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Moyen</th>
                <th className="nombre">Transactions</th>
                <th className="nombre">Montant</th>
                <th className="nombre">Part</th>
              </tr>
            </thead>
            <tbody>
              {paiements.map((p) => (
                <tr key={p.type}>
                  <td>{p.libelle}</td>
                  <td className="nombre">{p.nombre}</td>
                  <td className="nombre">{formaterTND(p.montantMillimes)}</td>
                  <td className="nombre">
                    {totalEncaisse === 0
                      ? '—'
                      : `${formaterPourcentage(Math.round((p.montantMillimes / totalEncaisse) * 10000))} %`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
