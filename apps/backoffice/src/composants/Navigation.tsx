'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { seDeconnecter } from '../app/connexion/actions.js'
import type { Etablissement, SessionBackoffice } from '../serveur/session.js'

/**
 * Les onglets, et qui les voit.
 *
 * `gestionnaire` marque ceux qui MODIFIENT le référentiel. Les afficher à
 * un cuisinier ne serait pas une faille — RLS refuserait l'écriture — mais
 * un bouton qui échoue toujours fait conclure que le logiciel est cassé.
 *
 * L'inverse est vrai aussi : « Cuisine » reste visible pour tout le monde.
 * Un gérant a de bonnes raisons de regarder ce que la cuisine voit.
 */
const ONGLETS = [
  { chemin: 'cuisine', libelle: 'Cuisine', gestionnaire: false },
  { chemin: 'journee', libelle: 'Journée', gestionnaire: false },
  { chemin: 'catalogue', libelle: 'Catalogue', gestionnaire: true },
  { chemin: 'employes', libelle: 'Employés', gestionnaire: true },
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
        {ONGLETS.filter((o) => !o.gestionnaire || etablissement.gestionnaire).map((onglet) => {
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
