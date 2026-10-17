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
import { AvertissementFormule } from '../../../composants/AvertissementFormule.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { BandeauIndicateurs } from '../../../composants/BandeauIndicateurs.js'
import { FiltresRapport } from '../../../composants/FiltresRapport.js'
import { GraphiqueSerie } from '../../../composants/GraphiqueSerie.js'
import { TableauRapport } from '../../../composants/TableauRapport.js'
import { celluleMontant } from '../../../composants/RapportVentilation.js'
import { traduction } from '../../../i18n/serveur.js'

export const dynamic = 'force-dynamic'

export default async function PageVentesParPaiement({
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
        <h1>{t('Ventes par mode de paiement')}</h1>
        <p className="message erreur">{t('Lecture impossible :')}{' '}{t.m(agregats.erreur)}</p>
      </section>
    )
  }

  const paiements = agregats.parPaiement
  const paiementsPrecedents = agregatsPrecedent.parPaiement
  const total = paiements.reduce((elt, p) => elt + p.montantMillimes, 0)
  const totalPrecedent = paiementsPrecedents.reduce((elt, p) => elt + p.montantMillimes, 0)
  const transactions = paiements.reduce((elt, p) => elt + p.nombre, 0)
  const i = agregats.indicateurs

  return (
    <>
      <header className="entete-rapport">
        <h1>{t('Ventes par mode de paiement')}</h1>
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
            libelle: t('Encaissé (TTC)'),
            valeurMillimes: total,
            precedentMillimes: totalPrecedent,
            detail: `${transactions} transaction(s)`,
            aide: t('Argent réellement entré en caisse, taxes et service compris.'),
          },
          ...paiements.slice(0, 3).map((p) => ({
            libelle: t.paiement(p.type),
            valeurMillimes: p.montantMillimes,
            precedentMillimes:
              paiementsPrecedents.find((x) => x.type === p.type)?.montantMillimes ?? null,
            detail: `${p.nombre} transaction(s)`,
          })),
          {
            libelle: t('Remboursements'),
            valeurMillimes: i.remboursementsMillimes,
            precedentMillimes: null,
            hausseDefavorable: true,
          },
        ]}
      />

      <p className="message avertissement">{t('Ces montants sont')}{' '}<strong>{t('TTC')}</strong>{' '}{t(': ils ne s’additionnent pas au chiffre d’affaires net des autres écrans, qui est hors taxe et après remises. Le total ci-dessus doit en revanche coller à l’écran')}{' '}<strong>{t('Journée')}</strong>.
      </p>

      <section className="bloc">
        <GraphiqueSerie
          titre={t('Encaissements')}
          journees={agregats.parJournee}
          parts={paiements.map((p) => ({
            cle: p.type,
            libelle: t.paiement(p.type),
            valeurMillimes: p.montantMillimes,
          }))}
        />
      </section>

      <TableauRapport
        lignes={paiements.map((p) => ({
          cle: p.type,
          cellules: {
            moyen: { texte: t.paiement(p.type) },
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
            exports={[{ quoi: 'paiements', libelle: t('Exporter') }]}
            du={periode.du}
            au={periode.au}
          />
        }
        colonnes={[
          { cle: 'moyen', titre: t('Mode de paiement') },
          { cle: 'nombre', titre: t('Transactions'), nombre: true },
          { cle: 'montant', titre: t('Montant encaissé'), nombre: true },
          { cle: 'part', titre: t('Part'), nombre: true },
          { cle: 'moyenne', titre: t('Ticket moyen'), nombre: true, secondaire: true },
        ]}
      />
    </>
  )
}
