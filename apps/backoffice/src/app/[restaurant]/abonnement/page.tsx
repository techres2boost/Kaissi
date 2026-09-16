/**
 * Paramètres → Abonnement.
 *
 * ── Ce que cet écran fait, et ce qu'il ne fera jamais ─────────────────────
 *
 * Il DIT la formule en cours, ce qu'elle ouvre, et par où en changer. Il n'a
 * aucun bouton qui en change, et ce n'est pas un manque :
 *
 *   • le back-office n'utilise que la clé publique de Supabase, donc toutes
 *     ses écritures passent par RLS. La table `subscriptions` n'a AUCUNE
 *     politique d'écriture (migration 0040) : un bouton « passer en Pro »
 *     serait, littéralement, un `update` que n'importe qui peut rejouer
 *     depuis la console de son navigateur ;
 *
 *   • et il n'y a pas de prélèvement branché. Un bouton qui changerait la
 *     formule sans encaisser serait un cadeau ; un bouton qui prétendrait
 *     encaisser sans le faire serait pire.
 *
 * La formule se change donc là où elle est décidée : chez l'éditeur, par
 * `pnpm sync:abonnement`, après que quelqu'un a payé. C'est le même chemin
 * que le tout premier accès (`pnpm sync:acces`), et pour la même raison.
 *
 * ── Aucun montant n'est affiché ───────────────────────────────────────────
 *
 * ⚠ Les tarifs ne sont écrits nulle part dans ce dépôt, et surtout pas ici.
 *   Un prix affiché dans une page engage commercialement, se retrouve dans
 *   une capture d'écran, et ne se corrige pas rétroactivement. Tant que la
 *   grille n'est pas arrêtée par l'éditeur, cet écran compare des DROITS,
 *   pas des prix.
 */

import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { abonnementDe } from '../../../serveur/abonnement.js'
import { libelleJournee } from '../../../serveur/journee.js'
import { ComparatifFormules } from '../../../composants/ComparatifFormules.js'
import { EDITEUR } from '../../../editeur.js'

export const dynamic = 'force-dynamic'

/** « 2026-09-15T…Z » → « 15 septembre 2026 ». Nul rendu par un tiret. */
function jour(horodatage: string | null): string {
  return horodatage ? libelleJournee(horodatage.slice(0, 10)) : '—'
}

export default async function PageAbonnement({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const supabase = await supabaseServeur()
  const [etat, ligne] = await Promise.all([
    abonnementDe(etablissement.organizationId),
    supabase
      .from('subscriptions')
      .select('started_at, trial_ends_at, note')
      .eq('organization_id', etablissement.organizationId)
      .maybeSingle(),
  ])

  return (
    <>
      <h1>Abonnement</h1>
      <p className="sous-titre">
        La formule de votre compte, et ce qu’elle ouvre. Elle est portée par{' '}
        <strong>l’organisation</strong>, pas par l’établissement : ouvrir un
        second restaurant ne recommence pas un essai, et ne double rien.
      </p>

      <section className="carte">
        <h2>
          Formule en cours : {etat.nom}
          {etat.essaiExpire && <span className="etiquette inactif">essai terminé</span>}
        </h2>

        {etat.enEssai && (
          <p className="message info" role="status">
            <CalendarClock size={17} strokeWidth={1.75} aria-hidden="true" />{' '}
            <strong>
              {etat.joursRestants === 1
                ? 'Il vous reste 1 jour d’essai.'
                : `Il vous reste ${etat.joursRestants} jours d’essai.`}
            </strong>{' '}
            Jusqu’au {jour((ligne.data?.trial_ends_at as string | null) ?? null)}, vous
            avez tout ce que la formule « Pro » ouvre.
          </p>
        )}

        {etat.essaiExpire && (
          <p className="message avertissement" role="status">
            <strong>Votre essai s’est terminé le{' '}
            {jour((ligne.data?.trial_ends_at as string | null) ?? null)}.</strong> Vous
            avez désormais les droits de la formule « Gratuit ». Rien n’a été perdu :
            vos ventes, vos articles et vos employés sont intacts, et{' '}
            <strong>votre caisse encaisse exactement comme avant</strong>.
          </p>
        )}

        <dl className="lignes-chiffres">
          <dt>Depuis le</dt>
          <dd>{jour((ligne.data?.started_at as string | null) ?? null)}</dd>
          <dt>Historique consultable</dt>
          <dd>
            {etat.joursHistorique === null
              ? 'Sans limite'
              : `${etat.joursHistorique} derniers jours`}
          </dd>
          <dt>Inventaire avancé</dt>
          <dd>{etat.modules.includes('inventaire_avance') ? 'Ouvert' : 'Fermé'}</dd>
        </dl>

        {/*
          La note du support, telle qu'elle a été écrite. Elle explique
          pourquoi CE compte a CETTE formule — « installé avant la mise en
          place des formules », « offert trois mois ». Sans elle, un gérant
          qui hérite du dossier ne peut que supposer.
        */}
        {ligne.data?.note && <p className="indication">{ligne.data.note as string}</p>}
      </section>

      <section className="bloc">
        <h2>Ce que chaque formule ouvre</h2>
        <ComparatifFormules etat={etat} />
      </section>

      <section className="carte">
        <h2>Changer de formule</h2>
        <p>
          Écrivez à{' '}
          <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a> en indiquant
          le nom de votre établissement. Le changement prend effet dès qu’il est
          enregistré : rien à réinstaller, aucune tablette à toucher, et{' '}
          <strong>aucune interruption de service</strong>.
        </p>
        <p className="indication">
          Il n’y a volontairement <strong>aucun bouton</strong> sur cette page.
          Kaissi ne conserve aucun moyen de paiement et ne prélève rien tout
          seul — un abonnement se règle avec quelqu’un, pas avec un formulaire.
        </p>
      </section>

      <div className="message info">
        <strong>Une formule ne touche jamais à la caisse.</strong> Quelle que
        soit la vôtre, et même expirée, la tablette ouvre, encaisse hors ligne
        et se synchronise. Ce qu’un abonnement peut fermer, ce sont des écrans
        de gestion — des rapports longs, l’inventaire avancé. Jamais une vente.{' '}
        <Link href={{ pathname: `/${restaurant}/fonctionnalites` }}>
          Voir tout ce que Kaissi fait
        </Link>
        .
      </div>
    </>
  )
}
