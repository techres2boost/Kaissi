'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { seDeconnecter } from '../app/connexion/actions.js'
import type { Etablissement, SessionBackoffice } from '../serveur/session.js'

const ONGLETS = [
  { chemin: 'journee', libelle: 'Journée' },
  { chemin: 'catalogue', libelle: 'Catalogue' },
  { chemin: 'employes', libelle: 'Employés' },
] as const

export function Navigation({
  session,
  etablissement,
}: {
  session: SessionBackoffice
  etablissement: Etablissement
}) {
  const cheminActuel = usePathname()

  return (
    <header className="barre">
      <span className="marque">Kaissi</span>

      {session.etablissements.length > 1 ? (
        <Link href="/" style={{ fontSize: '0.9rem' }}>
          {etablissement.nom} ↔
        </Link>
      ) : (
        <span style={{ fontSize: '0.9rem', color: 'var(--attenue)' }}>{etablissement.nom}</span>
      )}

      <nav>
        {ONGLETS.map((onglet) => {
          // Le gabarit est écrit dans le JSX plutôt que stocké dans un `const` :
          // TypeScript conserve alors son type littéral, et les routes typées
          // détectent un onglet qui pointerait vers une page inexistante.
          const href = `/${etablissement.id}/${onglet.chemin}` as const
          return (
            <Link
              key={onglet.chemin}
              href={href}
              aria-current={cheminActuel === href ? 'page' : undefined}
            >
              {onglet.libelle}
            </Link>
          )
        })}
      </nav>

      <div className="droite">
        <span className="etiquette">{etablissement.role}</span>
        <form action={seDeconnecter}>
          <button type="submit" className="discret">
            Se déconnecter
          </button>
        </form>
      </div>
    </header>
  )
}
