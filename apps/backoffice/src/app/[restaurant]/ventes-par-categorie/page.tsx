/**
 * « Ventes par catégorie » — la carte vue de haut.
 *
 * L'article dit quoi garder ; la catégorie dit où va le service. « Les
 * boissons font 40 % du chiffre » est une phrase qu'aucun classement
 * d'articles ne donne, parce qu'elle demande d'additionner trente lignes.
 *
 * La catégorie vient du produit AU MOMENT de la lecture, pas de la vente :
 * reclasser un article change donc les rapports passés. C'est le comportement
 * voulu — « combien font mes boissons » se pose sur la carte d'aujourd'hui.
 */

import { formaterPourcentage } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { chargerRapport } from '../../../serveur/rapport.js'
import {
  calculerIndicateurs,
  ventilerParCategorie,
  ventilerParJournee,
} from '../../../serveur/rapports.js'
import { libelleJournee } from '../../../serveur/journee.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { BandeauIndicateurs } from '../../../composants/BandeauIndicateurs.js'
import { FiltresRapport } from '../../../composants/FiltresRapport.js'
import { GraphiqueSerie } from '../../../composants/GraphiqueSerie.js'
import {
  colonnesVentilation,
  lignesVentilation,
  TopCinq,
} from '../../../composants/RapportVentilation.js'
import { TableauRapport } from '../../../composants/TableauRapport.js'

export const dynamic = 'force-dynamic'

export default async function PageVentesParCategorie({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { restaurant } = await params
  const recherche = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const { periode, filtres, ventes, precedent, fiche, aujourdhui, employes } =
    await chargerRapport(restaurant, recherche)

  if (ventes.erreur) {
    return (
      <section className="bloc">
        <h1>Ventes par catégorie</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const categories = ventilerParCategorie(ventes.lignes)
  const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
  const p = calculerIndicateurs(precedent.lignes, precedent.commandes, precedent.remboursements)

  return (
    <>
      <header className="entete-rapport">
        <h1>Ventes par catégorie</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du)
            : `Du ${libelleJournee(periode.du)} au ${libelleJournee(periode.au)}`}
        </p>
      </header>

      <FiltresRapport
        du={periode.du}
        au={periode.au}
        aujourdhui={aujourdhui}
        heureDebut={filtres.heureDebut}
        heureFin={filtres.heureFin}
        employeId={filtres.employeId}
        employes={employes}
      />

      <BandeauIndicateurs
        indicateurs={[
          {
            libelle: 'Catégories vendues',
            valeurMillimes: categories.length * 1000,
            precedentMillimes: null,
            detail: `${i.articlesVendus} article(s)`,
          },
          { libelle: 'Ventes brutes', valeurMillimes: i.caBrutMillimes, precedentMillimes: p.caBrutMillimes },
          {
            libelle: 'Réductions',
            valeurMillimes: i.remisesMillimes,
            precedentMillimes: p.remisesMillimes,
            hausseDefavorable: true,
          },
          { libelle: 'Ventes nettes', valeurMillimes: i.caNetMillimes, precedentMillimes: p.caNetMillimes },
          {
            libelle: 'Marge brute',
            valeurMillimes: i.marge.margeMillimes,
            precedentMillimes: p.marge.margeMillimes,
            detail:
              i.marge.margeBp === null
                ? 'coût non saisi'
                : `${formaterPourcentage(i.marge.margeBp)} % du CA net`,
          },
        ]}
      />

      <TopCinq lignes={categories} entete="Catégories" />

      <section className="bloc">
        <GraphiqueSerie
          titre="Ventes par catégorie"
          journees={ventilerParJournee(ventes.commandes, fiche.timezone, fiche.bascule, {
            du: periode.du,
            au: periode.au,
          })}
          parts={categories.map((c) => ({
            cle: c.cle,
            libelle: c.libelle,
            valeurMillimes: c.marge.caMillimes,
          }))}
        />
      </section>

      <TableauRapport
        lignes={lignesVentilation(categories)}
        colonnes={colonnesVentilation('Catégorie')}
        actions={
          <BoutonsExport
            restaurantId={restaurant}
            exports={[{ quoi: 'categories', libelle: 'Exporter' }]}
            du={periode.du}
            au={periode.au}
          />
        }
      />
    </>
  )
}
