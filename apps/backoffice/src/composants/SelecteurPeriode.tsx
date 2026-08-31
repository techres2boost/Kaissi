'use client'

/**
 * Le filtre de période, partagé par tous les rapports.
 *
 * Les bornes vivent dans l'URL (`?du=…&au=…`) et non dans un état React :
 * un rapport se partage par copier-coller, se met en favori, et survit à un
 * rechargement. C'est aussi ce qui permet aux composants serveur de lire la
 * période sans qu'aucune donnée ne transite par le navigateur.
 */

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { destinationSure } from '../serveur/redirection.js'

/** Décale une journée « AAAA-MM-JJ » de n jours, en UTC pour rester stable. */
function decaler(journee: string, jours: number): string {
  const [a, m, j] = journee.split('-').map(Number)
  const d = new Date(Date.UTC(a!, m! - 1, j! + jours))
  return d.toISOString().slice(0, 10)
}

export function SelecteurPeriode({
  du,
  au,
  aujourdhui,
}: {
  du: string
  au: string
  /** La journée COMMERCIALE en cours — pas `new Date()` du navigateur. */
  aujourdhui: string
}) {
  const router = useRouter()
  const chemin = usePathname()
  const parametres = useSearchParams()
  const [enCours, demarrer] = useTransition()

  const aller = (nouveauDu: string, nouveauAu: string) => {
    const suivants = new URLSearchParams(parametres.toString())
    suivants.set('du', nouveauDu)
    suivants.set('au', nouveauAu)
    // `typedRoutes` refuse une chaîne construite dynamiquement : ce n'est pas
    // une route connue à la compilation. On passe donc par `destinationSure`,
    // le filtre déjà utilisé après connexion — il n'accepte qu'un chemin
    // interne, ce qui interdit au passage toute redirection ouverte.
    demarrer(() => router.push(destinationSure(`${chemin}?${suivants.toString()}`)))
  }

  const raccourcis: { libelle: string; du: string; au: string }[] = [
    { libelle: "Aujourd'hui", du: aujourdhui, au: aujourdhui },
    { libelle: 'Hier', du: decaler(aujourdhui, -1), au: decaler(aujourdhui, -1) },
    { libelle: '7 derniers jours', du: decaler(aujourdhui, -6), au: aujourdhui },
    { libelle: '30 derniers jours', du: decaler(aujourdhui, -29), au: aujourdhui },
    { libelle: 'Ce mois', du: `${aujourdhui.slice(0, 7)}-01`, au: aujourdhui },
  ]

  return (
    <div className="periode" aria-busy={enCours}>
      <div className="periode-raccourcis">
        {raccourcis.map((r) => (
          <button
            key={r.libelle}
            type="button"
            className={du === r.du && au === r.au ? 'actif' : ''}
            onClick={() => aller(r.du, r.au)}
          >
            {r.libelle}
          </button>
        ))}
      </div>
      <div className="periode-bornes">
        <label>
          Du
          <input type="date" value={du} max={au} onChange={(e) => aller(e.target.value, au)} />
        </label>
        <label>
          au
          <input type="date" value={au} min={du} onChange={(e) => aller(du, e.target.value)} />
        </label>
      </div>
    </div>
  )
}
