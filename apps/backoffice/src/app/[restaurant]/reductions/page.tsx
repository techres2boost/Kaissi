/**
 * « Réductions » — ce qui a été accordé, et par qui.
 *
 * ── Pourquoi cet écran existe ─────────────────────────────────────────────
 *
 * Une remise est de l'argent qui sort, sans qu'aucun billet ne bouge. Elle ne
 * laisse donc aucune trace dans la caisse : ni écart de comptage, ni ligne
 * suspecte. Le seul endroit où elle se voit, c'est ici — et le seul moment
 * où l'on s'en aperçoit autrement, c'est quand la marge du mois est
 * inexplicablement basse.
 *
 * ── Ce qu'on regarde vraiment ─────────────────────────────────────────────
 *
 * Pas le total : la RÉPARTITION. Une remise exceptionnelle sur une grosse
 * table, c'est du commerce ; la même remise sur un ticket sur trois, tous
 * les jours, chez la même personne, c'est autre chose. L'écran classe donc
 * par employé et laisse voir chaque ticket concerné.
 *
 * ── Ce qui n'est pas encore là ────────────────────────────────────────────
 *
 * Le MOTIF. La caisse enregistre un montant ou un pourcentage, pas une
 * raison. Une réduction nommée (« Happy hour », « Personnel ») demande un
 * référentiel de réductions et son écran sur la tablette — c'est le chantier
 * suivant, et il n'a pas de sens tant que la caisse ne sait pas la choisir.
 */

import Link from 'next/link'
import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { libelleJournee } from '../../../serveur/journee.js'
import { chargerRapport } from '../../../serveur/rapport.js'
import { calculerIndicateurs, ventilerParJournee } from '../../../serveur/rapports.js'
import { BandeauIndicateurs } from '../../../composants/BandeauIndicateurs.js'
import { FiltresRapport } from '../../../composants/FiltresRapport.js'
import { GraphiqueSerie } from '../../../composants/GraphiqueSerie.js'
import { TableauRapport } from '../../../composants/TableauRapport.js'

export const dynamic = 'force-dynamic'

export default async function PageReductions({
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
        <h1>Réductions</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
  const p = calculerIndicateurs(precedent.lignes, precedent.commandes, precedent.remboursements)

  /*
   * Une remise par COMMANDE : c'est l'unité de décision.
   *
   * Les remises de ligne et la part de remise globale sont additionnées —
   * pour celui qui regarde, « ce ticket a été remisé de 4 dinars » est la
   * seule question. Le détail ligne à ligne est dans le reçu.
   */
  const remisesParCommande = new Map<string, number>()
  const brutParCommande = new Map<string, number>()
  for (const ligne of ventes.lignes) {
    const remise = ligne.remiseLigneMillimes + ligne.remiseGlobaleMillimes
    remisesParCommande.set(ligne.orderId, (remisesParCommande.get(ligne.orderId) ?? 0) + remise)
    brutParCommande.set(
      ligne.orderId,
      (brutParCommande.get(ligne.orderId) ?? 0) + ligne.brutMillimes,
    )
  }

  const ticketsRemises = ventes.tickets
    .map((t) => ({
      ...t,
      remiseMillimes: remisesParCommande.get(t.id) ?? 0,
      brutMillimes: brutParCommande.get(t.id) ?? 0,
    }))
    .filter((t) => t.remiseMillimes > 0)

  /** Par employé : c'est la répartition qui parle, pas le total. */
  const parEmploye = new Map<string, { nom: string; remise: number; tickets: number }>()
  for (const t of ticketsRemises) {
    const seau = parEmploye.get(t.vendeur) ?? { nom: t.vendeur, remise: 0, tickets: 0 }
    seau.remise += t.remiseMillimes
    seau.tickets += 1
    parEmploye.set(t.vendeur, seau)
  }
  const classementEmployes = [...parEmploye.entries()]
    .map(([cle, v]) => ({ cle, ...v }))
    .sort((a, b) => b.remise - a.remise)

  const partDuBrut =
    i.caBrutMillimes === 0
      ? 0
      : Math.round((i.remisesMillimes / i.caBrutMillimes) * 10_000)

  return (
    <>
      <header className="entete-rapport">
        <h1>Réductions</h1>
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
            libelle: 'Réductions accordées',
            valeurMillimes: i.remisesMillimes,
            precedentMillimes: p.remisesMillimes,
            hausseDefavorable: true,
            detail: `${formaterPourcentage(partDuBrut)} % des ventes brutes`,
          },
          {
            libelle: 'Tickets remisés',
            valeurMillimes: ticketsRemises.length * 1000,
            precedentMillimes: null,
            detail:
              i.nombreTickets === 0
                ? 'aucun ticket'
                : `sur ${i.nombreTickets} ticket(s)`,
          },
          {
            libelle: 'Remise moyenne',
            valeurMillimes:
              ticketsRemises.length === 0
                ? 0
                : Math.round(i.remisesMillimes / ticketsRemises.length),
            precedentMillimes: null,
            detail: 'par ticket remisé',
          },
          {
            libelle: 'Ventes brutes',
            valeurMillimes: i.caBrutMillimes,
            precedentMillimes: p.caBrutMillimes,
          },
          {
            libelle: 'Ventes nettes',
            valeurMillimes: i.caNetMillimes,
            precedentMillimes: p.caNetMillimes,
          },
        ]}
      />

      <section className="bloc">
        <GraphiqueSerie
          titre="Réductions dans le temps"
          journees={ventilerParJournee(ventes.commandes, fiche.timezone, fiche.bascule, {
            du: periode.du,
            au: periode.au,
          })}
          parts={classementEmployes.map((e) => ({
            cle: e.cle,
            libelle: e.nom,
            valeurMillimes: e.remise,
          }))}
        />
        <p className="indication">
          La forme <strong>circulaire</strong> montre qui accorde les remises ;
          les colonnes montrent l’activité de la période. Une remise
          exceptionnelle est du commerce — la même, chaque jour, chez la même
          personne, est autre chose.
        </p>
      </section>

      <TableauRapport
        titre="Par employé"
        lignes={classementEmployes}
        cleDe={(l) => l.cle}
        vide="Aucune réduction accordée sur cette période."
        colonnes={[
          { cle: 'nom', titre: 'Employé', rendu: (l) => l.nom, valeur: (l) => l.nom },
          {
            cle: 'tickets',
            titre: 'Tickets remisés',
            nombre: true,
            rendu: (l) => l.tickets,
            valeur: (l) => l.tickets,
          },
          {
            cle: 'remise',
            titre: 'Réductions',
            nombre: true,
            rendu: (l) => formaterTND(millimes(l.remise)),
            valeur: (l) => l.remise,
          },
          {
            cle: 'moyenne',
            titre: 'Moyenne par ticket',
            nombre: true,
            rendu: (l) => formaterTND(millimes(Math.round(l.remise / l.tickets))),
            valeur: (l) => l.remise / l.tickets,
          },
        ]}
      />

      <TableauRapport
        titre="Les tickets concernés"
        lignes={ticketsRemises}
        cleDe={(t) => t.id}
        vide="Aucune réduction accordée sur cette période."
        colonnes={[
          {
            cle: 'numero',
            titre: 'Reçu',
            rendu: (t) => (
              <Link href={{ pathname: `/${restaurant}/recus`, query: { ticket: t.id } }}>
                {t.numero ?? '—'}
              </Link>
            ),
            valeur: (t) => t.numero ?? '',
          },
          { cle: 'vendeur', titre: 'Employé', rendu: (t) => t.vendeur, valeur: (t) => t.vendeur },
          {
            cle: 'brut',
            titre: 'Avant réduction',
            nombre: true,
            rendu: (t) => formaterTND(millimes(t.brutMillimes)),
            valeur: (t) => t.brutMillimes,
          },
          {
            cle: 'remise',
            titre: 'Réduction',
            nombre: true,
            rendu: (t) => formaterTND(millimes(t.remiseMillimes)),
            valeur: (t) => t.remiseMillimes,
          },
          {
            cle: 'taux',
            titre: 'Taux',
            nombre: true,
            rendu: (t) =>
              t.brutMillimes === 0
                ? '—'
                : `${formaterPourcentage(Math.round((t.remiseMillimes / t.brutMillimes) * 10_000))} %`,
            valeur: (t) => (t.brutMillimes === 0 ? 0 : t.remiseMillimes / t.brutMillimes),
          },
          {
            cle: 'paye',
            titre: 'Payé',
            nombre: true,
            secondaire: true,
            rendu: (t) => formaterTND(millimes(t.totalMillimes)),
            valeur: (t) => t.totalMillimes,
          },
        ]}
      />
    </>
  )
}
