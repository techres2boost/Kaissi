/**
 * « Ventes par employé » — qui encaisse quoi.
 *
 * ── La vente est attribuée à qui l'a ENCAISSÉE ────────────────────────────
 *
 * `closed_by` d'abord, `opened_by` en repli. Un serveur ouvre la table, le
 * caissier conclut : attribuer la vente à l'ouverture ferait porter le
 * chiffre à quelqu'un qui n'a jamais touché l'argent. C'est la même règle que
 * partout ailleurs dans les rapports — et elle est écrite une seule fois,
 * dans le chargement des ventes.
 *
 * ── Ce que cet écran n'est PAS ────────────────────────────────────────────
 *
 * Un classement de performance. Un caissier posté à midi encaisse plus qu'un
 * serveur de soirée sans mieux travailler. Le filtre horaire, en tête, est là
 * pour comparer ce qui est comparable.
 */

import { formaterPourcentage } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { chargerRapport } from '../../../serveur/rapport.js'
import {
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

export default async function PageVentesParEmploye({
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

  const { periode, filtres, agregats, agregatsPrecedent, aujourdhui, employes } =
    await chargerRapport(restaurant, recherche)

  if (agregats.erreur) {
    return (
      <section className="bloc">
        <h1>Ventes par employé</h1>
        <p className="message erreur">Lecture impossible : {agregats.erreur}</p>
      </section>
    )
  }

  const parEmploye = agregats.parEmploye
  const i = agregats.indicateurs
  const p = agregatsPrecedent.indicateurs

  /*
   * Tickets encaissés par employé — la vente ENTIÈRE, pas la ligne. Le
   * compte descend avec l'agrégat : `kaissi.rapport_ventes` groupe cette
   * ventilation-là sur les commandes et non sur les lignes, précisément
   * pour pouvoir les compter (et pour qu'une commande dont toutes les
   * lignes ont été annulées reste un ticket de cet employé).
   */
  const ticketsPar = new Map(parEmploye.map((e) => [e.cle, e.tickets]))

  return (
    <>
      <header className="entete-rapport">
        <h1>Ventes par employé</h1>
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
            libelle: 'Tickets',
            valeurMillimes: i.nombreTickets * 1000,
            precedentMillimes: p.nombreTickets * 1000,
            detail:
              i.panierMoyenMillimes === null
                ? 'aucune vente'
                : `panier moyen ${(i.panierMoyenMillimes / 1000).toFixed(3)} TND`,
          },
          { libelle: 'Ventes brutes', valeurMillimes: i.caBrutMillimes, precedentMillimes: p.caBrutMillimes },
          {
            libelle: 'Réductions',
            valeurMillimes: i.remisesMillimes,
            precedentMillimes: p.remisesMillimes,
            hausseDefavorable: true,
            aide: 'À rapprocher du plafond de remise du rôle : une remise systématique se voit ici.',
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

      <TopCinq lignes={parEmploye} entete="Employés" />

      <section className="bloc">
        <GraphiqueSerie
          titre="Ventes par employé"
          journees={agregats.parJournee}
          parts={parEmploye.map((e) => ({
            cle: e.cle,
            libelle: e.libelle,
            valeurMillimes: e.marge.caMillimes,
          }))}
        />
      </section>

      <TableauRapport
        lignes={lignesVentilation(parEmploye, (l) => ({
          tickets: {
            texte: String(ticketsPar.get(l.cle) ?? 0),
            valeur: ticketsPar.get(l.cle) ?? 0,
          },
        }))}
        colonnes={colonnesVentilation('Employé', [
          { cle: 'tickets', titre: 'Tickets', nombre: true },
        ])}
        actions={
          <BoutonsExport
            restaurantId={restaurant}
            exports={[{ quoi: 'employes', libelle: 'Exporter' }]}
            du={periode.du}
            au={periode.au}
          />
        }
      />
    </>
  )
}
