/**
 * « Ventes par mode de paiement » — ce qui est entré en caisse, et comment.
 *
 * ── Ces montants ne s'additionnent PAS au chiffre d'affaires ──────────────
 *
 * Ils sont ENCAISSÉS, donc TTC, service et timbre compris. Le chiffre
 * d'affaires net des autres écrans est hors taxe et après remises. Les
 * rapprocher ligne à ligne donnerait un écart que rien n'explique — c'est la
 * confusion la plus fréquente devant un rapport de caisse, et la raison pour
 * laquelle cet écran le dit en toutes lettres.
 *
 * Le total ici doit, lui, coller à l'écran Journée : c'est le même argent.
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
import { TableauRapport } from '../../../composants/TableauRapport.js'
import { celluleMontant } from '../../../composants/RapportVentilation.js'

export const dynamic = 'force-dynamic'

export default async function PageVentesParPaiement({
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
        <h1>Ventes par mode de paiement</h1>
        <p className="message erreur">Lecture impossible : {agregats.erreur}</p>
      </section>
    )
  }

  const paiements = agregats.parPaiement
  const paiementsPrecedents = agregatsPrecedent.parPaiement
  const total = paiements.reduce((t, p) => t + p.montantMillimes, 0)
  const totalPrecedent = paiementsPrecedents.reduce((t, p) => t + p.montantMillimes, 0)
  const transactions = paiements.reduce((t, p) => t + p.nombre, 0)
  const i = agregats.indicateurs

  return (
    <>
      <header className="entete-rapport">
        <h1>Ventes par mode de paiement</h1>
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
            libelle: 'Encaissé (TTC)',
            valeurMillimes: total,
            precedentMillimes: totalPrecedent,
            detail: `${transactions} transaction(s)`,
            aide: 'Argent réellement entré en caisse, taxes et service compris.',
          },
          ...paiements.slice(0, 3).map((p) => ({
            libelle: p.libelle,
            valeurMillimes: p.montantMillimes,
            precedentMillimes:
              paiementsPrecedents.find((x) => x.type === p.type)?.montantMillimes ?? null,
            detail: `${p.nombre} transaction(s)`,
          })),
          {
            libelle: 'Remboursements',
            valeurMillimes: i.remboursementsMillimes,
            precedentMillimes: null,
            hausseDefavorable: true,
          },
        ]}
      />

      <p className="message avertissement">
        Ces montants sont <strong>TTC</strong> : ils ne s’additionnent pas au chiffre
        d’affaires net des autres écrans, qui est hors taxe et après remises. Le
        total ci-dessus doit en revanche coller à l’écran <strong>Journée</strong>.
      </p>

      <section className="bloc">
        <GraphiqueSerie
          titre="Encaissements"
          journees={agregats.parJournee}
          parts={paiements.map((p) => ({
            cle: p.type,
            libelle: p.libelle,
            valeurMillimes: p.montantMillimes,
          }))}
        />
      </section>

      <TableauRapport
        lignes={paiements.map((p) => ({
          cle: p.type,
          cellules: {
            moyen: { texte: p.libelle },
            nombre: { texte: String(p.nombre), valeur: p.nombre },
            montant: celluleMontant(p.montantMillimes),
            part: {
              texte:
                total === 0
                  ? '—'
                  : `${formaterPourcentage(
                      Math.round((p.montantMillimes / total) * 10_000),
                    )} %`,
              valeur: p.montantMillimes,
            },
            moyenne: celluleMontant(
              p.nombre === 0 ? 0 : Math.round(p.montantMillimes / p.nombre),
            ),
          },
        }))}
        actions={
          <BoutonsExport
            restaurantId={restaurant}
            exports={[{ quoi: 'paiements', libelle: 'Exporter' }]}
            du={periode.du}
            au={periode.au}
          />
        }
        colonnes={[
          { cle: 'moyen', titre: 'Mode de paiement' },
          { cle: 'nombre', titre: 'Transactions', nombre: true },
          { cle: 'montant', titre: 'Montant encaissé', nombre: true },
          { cle: 'part', titre: 'Part', nombre: true },
          { cle: 'moyenne', titre: 'Ticket moyen', nombre: true, secondaire: true },
        ]}
      />
    </>
  )
}
