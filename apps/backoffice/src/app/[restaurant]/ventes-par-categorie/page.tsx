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
} from '../../../serveur/rapports.js'
import { libelleJournee } from '../../../serveur/journee.js'
import { AvertissementFormule } from '../../../composants/AvertissementFormule.js'
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
import { traduction } from '../../../i18n/serveur.js'

export const dynamic = 'force-dynamic'

export default async function PageVentesParCategorie({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const t = await traduction()
  const { restaurant } = await params
  const recherche = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const { periode, filtres, agregats, agregatsPrecedent, aujourdhui, employes } =
    await chargerRapport(restaurant, recherche)

  if (agregats.erreur) {
    return (
      <section className="bloc">
        <h1>{t('Ventes par catégorie')}</h1>
        <p className="message erreur">{t('Lecture impossible :')}{' '}{t.m(agregats.erreur)}</p>
      </section>
    )
  }

  const categories = agregats.parCategorie
  const i = agregats.indicateurs
  const p = agregatsPrecedent.indicateurs

  return (
    <>
      <header className="entete-rapport">
        <h1>{t('Ventes par catégorie')}</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du, t.locale)
            : t('Du {valeur} au {valeur2}', { valeur: libelleJournee(periode.du, t.locale), valeur2: libelleJournee(periode.au, t.locale) })}
        </p>
      </header>

      <AvertissementFormule restaurantId={restaurant} periode={periode} />

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
            libelle: t('Catégories vendues'),
            valeurMillimes: categories.length * 1000,
            precedentMillimes: null,
            detail: `${i.articlesVendus} article(s)`,
          },
          { libelle: t('Ventes brutes'), valeurMillimes: i.caBrutMillimes, precedentMillimes: p.caBrutMillimes },
          {
            libelle: t('Réductions'),
            valeurMillimes: i.remisesMillimes,
            precedentMillimes: p.remisesMillimes,
            hausseDefavorable: true,
          },
          { libelle: t('Ventes nettes'), valeurMillimes: i.caNetMillimes, precedentMillimes: p.caNetMillimes },
          {
            libelle: t('Marge brute'),
            valeurMillimes: i.marge.margeMillimes,
            precedentMillimes: p.marge.margeMillimes,
            detail:
              i.marge.margeBp === null
                ? t('coût non saisi')
                : t('{valeur} % du CA net', { valeur: formaterPourcentage(i.marge.margeBp) }),
          },
        ]}
      />

      <TopCinq lignes={categories} entete={t('Catégories')} />

      <section className="bloc">
        <GraphiqueSerie
          titre={t('Ventes par catégorie')}
          journees={agregats.parJournee}
          parts={categories.map((c) => ({
            cle: c.cle,
            libelle: c.libelle,
            valeurMillimes: c.marge.caMillimes,
          }))}
        />
      </section>

      <TableauRapport
        lignes={lignesVentilation(categories)}
        colonnes={colonnesVentilation(t('Catégorie'))}
        actions={
          <BoutonsExport
            restaurantId={restaurant}
            exports={[{ quoi: 'categories', libelle: t('Exporter') }]}
            du={periode.du}
            au={periode.au}
          />
        }
      />
    </>
  )
}
