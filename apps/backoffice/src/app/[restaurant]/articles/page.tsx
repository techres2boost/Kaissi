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
  calculerIndicateurs,
  ventilerParJournee,
  ventilerParProduit,
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

export default async function PageArticles({
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
        <h1>Ventes par article</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const articles = ventilerParProduit(ventes.lignes)
  const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
  const p = calculerIndicateurs(precedent.lignes, precedent.commandes, precedent.remboursements)

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
            libelle: 'Articles vendus',
            valeurMillimes: i.articlesVendus * 1000,
            precedentMillimes: p.articlesVendus * 1000,
            detail: `${articles.length} référence(s)`,
            aide: 'Nombre d’articles vendus, toutes références confondues.',
          },
          {
            libelle: 'Ventes brutes',
            valeurMillimes: i.caBrutMillimes,
            precedentMillimes: p.caBrutMillimes,
          },
          {
            libelle: 'Réductions',
            valeurMillimes: i.remisesMillimes,
            precedentMillimes: p.remisesMillimes,
            hausseDefavorable: true,
          },
          {
            libelle: 'Ventes nettes',
            valeurMillimes: i.caNetMillimes,
            precedentMillimes: p.caNetMillimes,
          },
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

      <TopCinq lignes={articles} entete="Articles" />

      <section className="bloc">
        <GraphiqueSerie
          titre="Tableau des ventes par article"
          journees={ventilerParJournee(ventes.commandes, fiche.timezone, fiche.bascule, {
            du: periode.du,
            au: periode.au,
          })}
          parts={articles.map((a) => ({
            cle: a.cle,
            libelle: a.libelle,
            valeurMillimes: a.marge.caMillimes,
          }))}
        />
      </section>

      {i.lignesSansCout > 0 && (
        <p className="message avertissement">
          ⚠ {i.lignesSansCout} ligne(s) sans coût d’achat saisi : leur marge
          apparaît « — » plutôt qu’à 100 %, qui aurait l’air juste.
        </p>
      )}

      <TableauRapport
        lignes={lignesVentilation(articles, (l) => ({
          categorie: {
            // La catégorie du PREMIER passage suffit : un article n'en a
            // qu'une, et la ventilation regroupe déjà par article.
            texte:
              ventes.lignes.find(
                (x) => (x.produitId ?? `designation:${x.designation}`) === l.cle,
              )?.categorieNom ?? '—',
          },
        }))}
        colonnes={colonnesVentilation('Article', [
          { cle: 'categorie', titre: 'Catégorie', secondaire: true },
        ])}
        actions={
          <BoutonsExport
            restaurantId={restaurant}
            exports={[{ quoi: 'articles', libelle: 'Exporter' }]}
            du={periode.du}
            au={periode.au}
          />
        }
      />
    </>
  )
}
