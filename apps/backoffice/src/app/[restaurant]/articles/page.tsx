/**
 * « Ventes par article » — ce qui se vend, et ce qui rapporte.
 *
 * ── Pourquoi un écran à part du récapitulatif ─────────────────────────────
 *
 * Le récapitulatif répond à « combien ai-je fait ». Celui-ci répond à « avec
 * quoi » — la question qu'un restaurateur se pose pour décider quoi garder à
 * la carte, quoi mettre en avant, et quoi arrêter.
 *
 * ── Ce qui a disparu, et pourquoi ─────────────────────────────────────────
 *
 * La barre de longueur dans le tableau. Elle répétait le classement que le
 * rang disait déjà : « Ojja merguez est premier » écrit deux fois, dont une
 * en couleur, dans une colonne qui prenait un tiers de la largeur. Le top 5
 * en tête donne le classement d'un coup d'œil ; le tableau donne les
 * chiffres, et rien qu'eux.
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

export default async function PageArticles({
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
        <h1>{t('Ventes par article')}</h1>
        <p className="message erreur">{t('Lecture impossible :')}{' '}{t.m(agregats.erreur)}</p>
      </section>
    )
  }

  const articles = agregats.parProduit
  const i = agregats.indicateurs
  const p = agregatsPrecedent.indicateurs

  return (
    <>
      <header className="entete-rapport">
        <h1>{t('Ventes par article')}</h1>
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
            libelle: t('Articles vendus'),
            valeurMillimes: i.articlesVendus * 1000,
            precedentMillimes: p.articlesVendus * 1000,
            detail: t('{length} référence(s)', { length: articles.length }),
            aide: t('Nombre d’articles vendus, toutes références confondues.'),
          },
          {
            libelle: t('Ventes brutes'),
            valeurMillimes: i.caBrutMillimes,
            precedentMillimes: p.caBrutMillimes,
          },
          {
            libelle: t('Réductions'),
            valeurMillimes: i.remisesMillimes,
            precedentMillimes: p.remisesMillimes,
            hausseDefavorable: true,
          },
          {
            libelle: t('Ventes nettes'),
            valeurMillimes: i.caNetMillimes,
            precedentMillimes: p.caNetMillimes,
          },
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

      <TopCinq lignes={articles} entete={t('Articles')} />

      <section className="bloc">
        <GraphiqueSerie
          titre={t('Tableau des ventes par article')}
          journees={agregats.parJournee}
          parts={articles.map((a) => ({
            cle: a.cle,
            libelle: a.libelle,
            valeurMillimes: a.marge.caMillimes,
          }))}
        />
      </section>

      {i.lignesSansCout > 0 && (
        <p className="message avertissement">
          ⚠ {i.lignesSansCout}{' '}{t('ligne(s) sans coût d’achat saisi : leur marge apparaît « — » plutôt qu’à 100 %, qui aurait l’air juste.')}</p>
      )}

      <TableauRapport
        lignes={lignesVentilation(articles, (l) => ({
          categorie: {
            // La catégorie du PREMIER passage suffit : un article n'en a
            // qu'une, et la ventilation regroupe déjà par article.
            // La catégorie descend avec l'agrégat, résolue par la même
            // requête que le chiffre : la chercher ici dans une liste de
            // lignes obligerait à charger ces lignes.
            texte: articles.find((a) => a.cle === l.cle)?.categorieNom ?? '—',
          },
        }))}
        colonnes={colonnesVentilation('Article', [
          { cle: 'categorie', titre: t('Catégorie'), secondaire: true },
        ])}
        actions={
          <BoutonsExport
            restaurantId={restaurant}
            exports={[{ quoi: 'articles', libelle: t('Exporter') }]}
            du={periode.du}
            au={periode.au}
          />
        }
      />
    </>
  )
}
