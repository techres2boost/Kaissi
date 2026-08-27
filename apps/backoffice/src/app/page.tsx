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

export default async function Accueil() {
  const session = await sessionObligatoire()

  if (session.etablissements.length === 1) {
    redirect(`/${session.etablissements[0]!.id}/journee`)
  }

  return (
    <>
      <BarreCompte session={session} />
      <main className="enveloppe">
        <h1>Vos établissements</h1>
        <p className="sous-titre">Choisissez celui que vous voulez administrer.</p>

        {session.etablissements.length === 0 ? (
          <div className="carte">
            <p className="message avertissement">
              Votre compte n&apos;est rattaché à aucun établissement.
            </p>
            <p className="indication">
              Un compte Supabase seul ne suffit pas : il faut une ligne dans
              <code> kaissi.memberships</code> qui vous relie à un restaurant, avec un
              rôle. C&apos;est cette ligne que lisent les politiques RLS —
              sans elle, la base ne vous rend aucune donnée, ce qui est le
              comportement voulu.
            </p>
          </div>
        ) : (
          <div className="grille deux">
            {session.etablissements.map((etablissement) => (
              <Link
                key={etablissement.id}
                href={`/${etablissement.id}/journee`}
                className="carte"
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <h2 style={{ marginBottom: '0.35rem' }}>{etablissement.nom}</h2>
                <span className="etiquette">{etablissement.role}</span>
                {!etablissement.gestionnaire && (
                  <p className="indication">
                    Consultation seule — la modification du catalogue et des employés
                    demande le rôle gérant.
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
