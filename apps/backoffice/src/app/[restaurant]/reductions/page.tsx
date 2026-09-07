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
 * ── Le motif ──────────────────────────────────────────────────────────────
 *
 * Depuis le référentiel (migration 0030), la caisse ne remonte plus seulement
 * un montant : elle remonte le NOM de la réduction choisie. « Happy hour »
 * chaque soir n'appelle pas la même question que « Geste commercial » trois
 * fois par jour, et sans ce nom les deux se ressemblaient exactement.
 *
 * Le libellé affiché est celui qui a été RECOPIÉ dans la vente, pas celui du
 * référentiel aujourd'hui : renommer un réglage ne doit pas réécrire les
 * rapports de l'an dernier. Le regroupement, lui, suit l'identifiant — un
 * « Happy hour » renommé reste une seule et même ligne.
 *
 * Une remise tapée à la main, sans motif, reste possible et se regroupe sous
 * « Sans motif ». La faire disparaître donnerait un total juste et une
 * répartition fausse.
 */

import { formaterPourcentage } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { libelleJournee } from '../../../serveur/journee.js'
import { chargerRapport } from '../../../serveur/rapport.js'
import {
  calculerIndicateurs,
  ventilerParJournee,
  ventilerParReduction,
} from '../../../serveur/rapports.js'
import { BandeauIndicateurs } from '../../../composants/BandeauIndicateurs.js'
import { FiltresRapport } from '../../../composants/FiltresRapport.js'
import { GraphiqueSerie } from '../../../composants/GraphiqueSerie.js'
import Link from 'next/link'
import { TableauRapport } from '../../../composants/TableauRapport.js'
import { celluleMontant } from '../../../composants/RapportVentilation.js'
import { AvertissementTronque } from '../../../composants/AvertissementTronque.js'

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

  /*
   * Par MOTIF : la première question qu'on se pose devant un total de remises.
   *
   * Le calcul vit dans `rapports.ts` parce qu'il n'est pas trivial — la remise
   * de ligne porte son propre motif, la remise globale celui de la commande,
   * et les deux se comptent ensemble.
   */
  const parMotif = ventilerParReduction(ventes.lignes, ventes.commandes)

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
        titre="Par motif"
        lignes={parMotif.map((l) => ({
          cle: l.cle,
          cellules: {
            libelle: { texte: l.libelle },
            ventes: { texte: String(l.ventes), valeur: l.ventes },
            montant: celluleMontant(l.montantMillimes),
            part: {
              texte:
                i.remisesMillimes === 0
                  ? '—'
                  : `${formaterPourcentage(
                      Math.round((l.montantMillimes / i.remisesMillimes) * 10_000),
                    )} %`,
              valeur: i.remisesMillimes === 0 ? 0 : l.montantMillimes / i.remisesMillimes,
            },
          },
        }))}
        vide="Aucune réduction accordée sur cette période."
        colonnes={[
          { cle: 'libelle', titre: 'Réduction' },
          { cle: 'ventes', titre: 'Ventes concernées', nombre: true },
          { cle: 'montant', titre: 'Montant', nombre: true },
          { cle: 'part', titre: 'Part des réductions', nombre: true, secondaire: true },
        ]}
      />
      <p className="indication">
        Les motifs proposés par la caisse se règlent dans{' '}
        <Link href={{ pathname: `/${restaurant}/reductions/gestion` }}>
          Articles → Réductions
        </Link>
        . Une remise tapée à la main apparaît sous « Sans motif ».
      </p>

      <TableauRapport
        titre="Par employé"
        lignes={classementEmployes.map((l) => ({
          cle: l.cle,
          cellules: {
            nom: { texte: l.nom },
            tickets: { texte: String(l.tickets), valeur: l.tickets },
            remise: celluleMontant(l.remise),
            moyenne: celluleMontant(Math.round(l.remise / l.tickets)),
          },
        }))}
        vide="Aucune réduction accordée sur cette période."
        colonnes={[
          { cle: 'nom', titre: 'Employé' },
          { cle: 'tickets', titre: 'Tickets remisés', nombre: true },
          { cle: 'remise', titre: 'Réductions', nombre: true },
          { cle: 'moyenne', titre: 'Moyenne par ticket', nombre: true },
        ]}
      />

      <TableauRapport
        titre="Les tickets concernés"
        lignes={ticketsRemises.map((t) => ({
          cle: t.id,
          cellules: {
            numero: {
              texte: t.numero ?? '—',
              valeur: t.numero ?? '',
              // Le reçu s'ouvre d'un clic : devant une remise qui interroge,
              // la question suivante est toujours « sur quoi ? ».
              lien: `/${restaurant}/recus?ticket=${t.id}`,
            },
            vendeur: { texte: t.vendeur },
            brut: celluleMontant(t.brutMillimes),
            remise: celluleMontant(t.remiseMillimes),
            taux: {
              texte:
                t.brutMillimes === 0
                  ? '—'
                  : `${formaterPourcentage(
                      Math.round((t.remiseMillimes / t.brutMillimes) * 10_000),
                    )} %`,
              valeur: t.brutMillimes === 0 ? 0 : t.remiseMillimes / t.brutMillimes,
            },
            paye: celluleMontant(t.totalMillimes),
          },
        }))}
        vide="Aucune réduction accordée sur cette période."
        colonnes={[
          { cle: 'numero', titre: 'Reçu', sansTri: true },
          { cle: 'vendeur', titre: 'Employé' },
          { cle: 'brut', titre: 'Avant réduction', nombre: true },
          { cle: 'remise', titre: 'Réduction', nombre: true },
          { cle: 'taux', titre: 'Taux', nombre: true },
          { cle: 'paye', titre: 'Payé', nombre: true, secondaire: true },
        ]}
      />
    </>
  )
}
