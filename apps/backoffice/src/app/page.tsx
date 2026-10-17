/**
 * Accueil — le choix de l'établissement.
 *
 * Le back-office est multi-établissements dès le premier jour : c'est le
 * modèle de tenance du schéma, et le rajouter après coup serait un chantier.
 * Un gérant qui n'en a qu'un est envoyé directement dessus — lui demander de
 * choisir dans une liste d'un seul élément serait une friction gratuite.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sessionObligatoire } from '../serveur/session.js'
import { BarreCompte } from '../composants/BarreCompte.js'
import { estEditeur } from './[restaurant]/abonnement/actions.js'
import { traduction } from '../i18n/serveur.js'

export default async function Accueil() {
  const t = await traduction()
  const session = await sessionObligatoire()
  /*
   * Les établissements FERMÉS à part.
   *
   * PANNE DE LECTURE SIGNALÉE : un établissement fermé depuis
   * l'administration réapparaissait ici, identique aux autres — on croyait
   * la fermeture ratée. On ne le CACHE pas (on ne cache pas à quelqu'un un
   * restaurant dont il est responsable, et ses rapports restent
   * consultables), on le range à part, avec ce qu'il est.
   */
  const ouverts = session.etablissements.filter((e) => !e.ferme)
  const fermes = session.etablissements.filter((e) => e.ferme)
  const [editeur] = await Promise.all([estEditeur()])

  // Un seul établissement EN SERVICE : on y va directement — sauf pour
  // l'éditeur, qui a un second écran à atteindre depuis ici.
  if (ouverts.length === 1 && !editeur) {
    redirect(`/${ouverts[0]!.id}/journee`)
  }

  return (
    <>
      <BarreCompte session={session} />
      <main className="enveloppe">
        <h1>{t('Vos établissements')}</h1>
        <p className="sous-titre">{t('Choisissez celui que vous voulez administrer.')}</p>

        {/*
          Le raccourci d'administration, pour qui en a le rôle. Il est ici
          parce que c'est l'écran où l'on arrive quand on gère plusieurs
          établissements — donc l'endroit où l'on pense à en ouvrir un.
        */}
        {(session.etablissements.some((e) => e.administrateur) || editeur) && (
          <p style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {session.etablissements.some((e) => e.administrateur) && (
              <Link className="bouton discret" href="/administration">{t('🏢 Administration — ouvrir un établissement')}</Link>
            )}
            {editeur && (
              <>
                <Link className="bouton discret" href="/editeur">{t('🧾 Éditeur — clients et formules')}</Link>
                <Link className="bouton discret" href="/editeur/surveillance">{t('📈 Surveillance du service')}</Link>
              </>
            )}
          </p>
        )}

        {session.etablissements.length === 0 ? (
          <div className="carte">
            <p className="message avertissement">{t('Votre compte n\'est rattaché à aucun établissement.')}</p>
            <p className="indication">{t('Un compte Supabase seul ne suffit pas : il faut une ligne dans')}<code>{' '}{t('kaissi.memberships')}</code>{' '}{t('qui vous relie à un restaurant, avec un rôle. C\'est cette ligne que lisent les politiques RLS — sans elle, la base ne vous rend aucune donnée, ce qui est le comportement voulu.')}</p>
          </div>
        ) : (
          <div className="grille deux">
            {ouverts.map((etablissement) => (
              <Link
                key={etablissement.id}
                href={`/${etablissement.id}/journee`}
                className="carte"
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <h2 style={{ marginBottom: '0.35rem' }}>{etablissement.nom}</h2>
                <span className="etiquette">{etablissement.role}</span>
                {!etablissement.gestionnaire && (
                  <p className="indication">{t('Consultation seule — la modification du catalogue et des employés demande le rôle gérant.')}</p>
                )}
              </Link>
            ))}
          </div>
        )}

        {fermes.length > 0 && (
          <section style={{ marginTop: '1.5rem' }}>
            <h2>{t('Établissements fermés')}</h2>
            <p className="indication">{t('Aucune caisse ne peut y être mise en service. Leurs rapports restent consultables ; on les rouvre depuis l’Administration.')}</p>
            <div className="grille deux">
              {fermes.map((etablissement) => (
                <Link
                  key={etablissement.id}
                  href={`/${etablissement.id}/ventes`}
                  className="carte"
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block', opacity: 0.75 }}
                >
                  <h2 style={{ marginBottom: '0.35rem' }}>{etablissement.nom}</h2>
                  <span className="etiquette inactif">{t('fermé')}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
