/**
 * Récapitulatif des ventes.
 *
 * ── Ce que cet écran répond, dans cet ordre ───────────────────────────────
 *
 * Combien ? (le bandeau) — comment cela évolue ? (le graphique) — et de quoi
 * c'est fait, période par période (le tableau). Les quatre ventilations qui
 * encombraient cette page ont chacune leur écran, comme dans Loyverse : on
 * vient ici pour le chiffre d'ensemble, pas pour comparer douze articles.
 *
 * Tout part des MÊMES lignes (`chargerRapport`), filtres compris. Deux
 * écrans qui rechargeraient les ventes chacun de leur côté finiraient par se
 * contredire, et personne ne saurait lequel a tort.
 */

import { formaterPourcentage } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { libelleJournee } from '../../../serveur/journee.js'
import { chargerRapport } from '../../../serveur/rapport.js'
import { agregerSerie } from '../../../serveur/rapports.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { BandeauIndicateurs } from '../../../composants/BandeauIndicateurs.js'
import { FiltresRapport } from '../../../composants/FiltresRapport.js'
import { GraphiqueSerie } from '../../../composants/GraphiqueSerie.js'
import { TableauRapport } from '../../../composants/TableauRapport.js'
import { celluleMontant, cellulePourcent } from '../../../composants/RapportVentilation.js'

export const dynamic = 'force-dynamic'

export default async function PageVentes({
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

  /*
   * Aucune ligne n'est demandée : cet écran n'affiche que des totaux, et
   * depuis la migration 0033 c'est PostgreSQL qui les additionne. Charger
   * les ~55 000 lignes d'un trimestre pour en tirer trente nombres était
   * exactement le défaut C-2 de l'audit.
   */
  const socle = await chargerRapport(restaurant, recherche)
  const { periode, filtres, agregats, agregatsPrecedent, aujourdhui, employes } = socle

  if (agregats.erreur) {
    return (
      <section className="bloc">
        <h1>Récapitulatif des ventes</h1>
        <p className="message erreur">Lecture impossible : {agregats.erreur}</p>
      </section>
    )
  }

  const i = agregats.indicateurs
  const p = agregatsPrecedent.indicateurs

  const journees = agregats.parJournee

  /*
   * Le tableau reprend le MÊME découpage que le graphique — et désormais
   * la même requête. Les deux grandeurs sont calculées côte à côte dans
   * `kaissi.rapport_ventes` : le total TTC pour les barres, le détail hors
   * taxe pour les colonnes. Deux découpages du « jour » sur un même écran,
   * c'est la garantie qu'on additionnera les colonnes de l'un en lisant les
   * barres de l'autre.
   *
   * ⚑ La journée vient de la bascule commerciale, JAMAIS des dix premiers
   * caractères de `closed_at`. Ce raccourci découperait sur le jour
   * calendaire UTC : une vente encaissée à 1 h du matin basculerait au
   * lendemain, et le samedi soir paraîtrait moitié moins bon qu'il ne l'a
   * été.
   */
  const detailDe = new Map(agregats.detailParJournee.map((d) => [d.journee, d]))

  const lignesTableau = agregerSerie(journees, 'jours').map((point) => {
    const detail = detailDe.get(point.cle)
    return {
      cle: point.cle,
      libelle: point.libelle,
      nettes: detail?.netMillimes ?? 0,
      cout: detail?.marge.coutMillimes ?? 0,
      margeMillimes: detail?.marge.margeMillimes ?? 0,
      margeBp: detail?.marge.margeBp ?? null,
      taxes: detail?.taxesMillimes ?? 0,
      tickets: point.tickets,
    }
  })

  return (
    <>
      <header className="entete-rapport">
        <h1>Récapitulatif des ventes</h1>
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
            libelle: 'Ventes brutes',
            valeurMillimes: i.caBrutMillimes,
            precedentMillimes: p.caBrutMillimes,
            aide: 'Le prix des articles vendus, avant réductions et hors remboursements.',
          },
          {
            libelle: 'Remboursements',
            valeurMillimes: i.remboursementsMillimes,
            precedentMillimes: p.remboursementsMillimes,
            hausseDefavorable: true,
            aide: 'Ce qui a été rendu au client après encaissement.',
          },
          {
            libelle: 'Réductions',
            valeurMillimes: i.remisesMillimes,
            precedentMillimes: p.remisesMillimes,
            hausseDefavorable: true,
            aide: 'Remises de ligne et remises globales, réparties au prorata.',
          },
          {
            libelle: 'Ventes nettes',
            valeurMillimes: i.caNetMillimes,
            precedentMillimes: p.caNetMillimes,
            detail: `${i.nombreTickets} ticket(s)`,
            aide: 'Ventes brutes moins les réductions. Hors taxe : c’est la seule grandeur comparable à un coût d’achat.',
          },
          {
            libelle: 'Marge brute',
            valeurMillimes: i.marge.margeMillimes,
            precedentMillimes: p.marge.margeMillimes,
            detail:
              i.marge.margeBp === null
                ? 'coût non saisi'
                : `${formaterPourcentage(i.marge.margeBp)} % du CA net`,
            aide: 'Ventes nettes moins le coût d’achat des articles vendus.',
          },
        ]}
      />

      <section className="bloc">
        <GraphiqueSerie journees={journees} titre="Ventes brutes" />
      </section>

      {i.lignesSansCout > 0 && (
        <p className="message avertissement">
          ⚠ {i.lignesSansCout} ligne(s) vendue(s) sans coût d’achat saisi : la marge
          est surestimée d’autant. Renseignez le coût au Menu pour la rendre juste.
        </p>
      )}

      <TableauRapport
        titre="Détail par journée"
        lignes={lignesTableau.map((l) => ({
          cle: l.cle,
          // Les cellules sont formatées ICI, côté serveur : seule de la
          // donnée traverse la frontière vers le tableau, qui est un
          // composant client.
          cellules: {
            jour: { texte: l.libelle, valeur: l.cle },
            tickets: { texte: String(l.tickets), valeur: l.tickets },
            nettes: celluleMontant(l.nettes),
            cout: celluleMontant(l.cout),
            marge: celluleMontant(l.margeMillimes),
            margeBp: cellulePourcent(l.margeBp),
            taxes: celluleMontant(l.taxes),
          },
        }))}
        actions={
          <BoutonsExport
            restaurantId={restaurant}
            exports={[{ quoi: 'ventes', libelle: 'Exporter' }]}
            du={periode.du}
            au={periode.au}
          />
        }
        colonnes={[
          { cle: 'jour', titre: 'Période' },
          { cle: 'tickets', titre: 'Tickets', nombre: true },
          { cle: 'nettes', titre: 'Ventes nettes', nombre: true },
          { cle: 'cout', titre: 'Coût des marchandises', nombre: true },
          { cle: 'marge', titre: 'Marge brute', nombre: true },
          { cle: 'margeBp', titre: 'Marge', nombre: true },
          { cle: 'taxes', titre: 'Taxes', nombre: true, secondaire: true },
        ]}
      />
    </>
  )
}
