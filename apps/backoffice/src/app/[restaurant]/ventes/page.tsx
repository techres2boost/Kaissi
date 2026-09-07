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
import { journeeCourante, libelleJournee } from '../../../serveur/journee.js'
import { chargerRapport } from '../../../serveur/rapport.js'
import {
  agregerSerie,
  calculerIndicateurs,
  ventilerParJournee,
} from '../../../serveur/rapports.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { BandeauIndicateurs } from '../../../composants/BandeauIndicateurs.js'
import { FiltresRapport } from '../../../composants/FiltresRapport.js'
import { GraphiqueSerie } from '../../../composants/GraphiqueSerie.js'
import { TableauRapport } from '../../../composants/TableauRapport.js'
import { celluleMontant, cellulePourcent } from '../../../composants/RapportVentilation.js'
import { AvertissementTronque } from '../../../composants/AvertissementTronque.js'

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

  const socle = await chargerRapport(restaurant, recherche)
  const { periode, filtres, ventes, precedent, fiche, aujourdhui, employes } = socle

  if (ventes.erreur) {
    return (
      <section className="bloc">
        <h1>Récapitulatif des ventes</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
  const p = calculerIndicateurs(precedent.lignes, precedent.commandes, precedent.remboursements)

  const journees = ventilerParJournee(ventes.commandes, fiche.timezone, fiche.bascule, {
    du: periode.du,
    au: periode.au,
  })

  /*
   * Le tableau reprend le MÊME découpage que le graphique.
   *
   * Deux découpages différents sur un même écran, c'est la garantie qu'on
   * additionnera les colonnes de l'un en lisant les barres de l'autre.
   *
   * ⚑ La journée d'une commande vient de `journeeCourante`, JAMAIS des dix
   * premiers caractères de `closed_at`. Ce raccourci-là découperait sur le
   * jour calendaire UTC : une vente encaissée à 1 h du matin basculerait au
   * lendemain — et le samedi soir paraîtrait moitié moins bon qu'il ne l'a
   * été. C'est la même bascule que l'écran Journée, partout.
   */
  const journeeDe = new Map(
    ventes.commandes.map((c) => [
      c.id,
      c.closeA ? journeeCourante(fiche.timezone, fiche.bascule, new Date(c.closeA)) : '',
    ]),
  )
  const lignesParJournee = new Map<string, typeof ventes.lignes>()
  for (const ligne of ventes.lignes) {
    const journee = journeeDe.get(ligne.orderId) ?? ''
    lignesParJournee.set(journee, [...(lignesParJournee.get(journee) ?? []), ligne])
  }

  const lignesTableau = agregerSerie(journees, 'jours').map((point) => {
    const lignes = lignesParJournee.get(point.cle) ?? []
    const indicateurs = calculerIndicateurs(lignes, [], [])
    return {
      cle: point.cle,
      libelle: point.libelle,
      nettes: indicateurs.caNetMillimes,
      cout: indicateurs.coutMillimes,
      margeMillimes: indicateurs.marge.margeMillimes,
      margeBp: indicateurs.marge.margeBp,
      taxes: lignes.reduce((t, l) => t + l.taxeMillimes, 0),
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

      <AvertissementTronque tronque={ventes.tronque} />

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
