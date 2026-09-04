'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { seDeconnecter } from '../app/connexion/actions.js'
import type { Etablissement, SessionBackoffice } from '../serveur/session.js'

/**
 * Les onglets, et qui les voit.
 *
 * `gestionnaire` marque ceux qui MODIFIENT le référentiel. Les afficher à
 * un caissier ne serait pas une faille — RLS refuserait l'écriture — mais
 * un bouton qui échoue toujours fait conclure que le logiciel est cassé.
 *
 * L'inverse est vrai aussi : « Préparation » reste visible pour tout le
 * monde. Un gérant a de bonnes raisons de regarder ce que la cuisine voit.
 *
 * ── Les rôles de PRÉPARATION n'ont pas de barre du tout ───────────────────
 *
 * Cuisine et bar ne voient qu'un écran, le leur. Pas même « Journée », qui
 * affiche le fond de caisse et l'écart : celui qui prépare n'encaisse pas.
 * Et masquer un onglet n'a jamais rien interdit — c'est `ecranReserve()`,
 * côté serveur, qui refuse l'URL tapée à la main.
 */
const ONGLETS = [
  { chemin: 'preparation', libelle: 'Préparation', gestionnaire: false },
  { chemin: 'tableau-bord', libelle: 'Tableau de bord', gestionnaire: true },
  { chemin: 'ventes', libelle: 'Ventes', gestionnaire: true },
  { chemin: 'tickets', libelle: 'Tickets', gestionnaire: true },
  { chemin: 'journee', libelle: 'Journée', gestionnaire: false },
  { chemin: 'stock', libelle: 'Stock', gestionnaire: true },
  { chemin: 'catalogue', libelle: 'Menu', gestionnaire: true },
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

      {session.etablissements.length > 1 && !etablissement.preparation ? (
        <Link href="/" style={{ fontSize: '0.9rem' }}>
          {etablissement.nom} ↔
        </Link>
      ) : (
        <span style={{ fontSize: '0.9rem', color: 'var(--attenue)' }}>{etablissement.nom}</span>
      )}

      <nav>
        {ONGLETS.filter(
          (o) =>
            etablissement.preparation
              ? o.chemin === 'preparation'
              : !o.gestionnaire || etablissement.gestionnaire,
        ).map((onglet) => {
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
