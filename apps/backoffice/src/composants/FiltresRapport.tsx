'use client'

/**
 * Les trois filtres de tête, communs à tous les rapports.
 *
 * Période · tranche horaire · employé. Ils vivent dans l'URL, comme la
 * période l'a toujours fait : un rapport se partage par copier-coller, se met
 * en favori et survit à un rechargement. C'est aussi ce qui permet aux
 * composants serveur de les lire sans qu'aucune donnée ne transite par le
 * navigateur.
 *
 * ── Pourquoi la tranche horaire existe ────────────────────────────────────
 *
 * « Combien fait le service du midi ? » ne se lit pas sur un total de
 * journée. Les heures sont celles de l'établissement, et la borne haute est
 * INCLUSE : « 12–15 » retient tout ce qui a été encaissé jusqu'à 15 h 59.
 */

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { destinationSure } from '../serveur/redirection.js'
import { Calendrier } from './Calendrier.js'

/** Décale une journée « AAAA-MM-JJ » de n jours, en UTC pour rester stable. */
function decaler(journee: string, jours: number): string {
  const [a, m, j] = journee.split('-').map(Number)
  const d = new Date(Date.UTC(a!, m! - 1, j! + jours))
  return d.toISOString().slice(0, 10)
}

const HEURES = Array.from({ length: 24 }, (_, h) => h)

export interface EmployeFiltre {
  readonly id: string
  readonly nom: string
}

export function FiltresRapport({
  du,
  au,
  aujourdhui,
  heureDebut,
  heureFin,
  employeId,
  employes,
}: {
  du: string
  au: string
  /** La journée COMMERCIALE en cours — pas `new Date()` du navigateur. */
  aujourdhui: string
  heureDebut: number
  heureFin: number
  employeId: string | null
  employes: readonly EmployeFiltre[]
}) {
  const router = useRouter()
  const chemin = usePathname()
  const parametres = useSearchParams()
  const [enCours, demarrer] = useTransition()

  const aller = (changements: Record<string, string | null>) => {
    const suivants = new URLSearchParams(parametres.toString())
    for (const [cle, valeur] of Object.entries(changements)) {
      if (valeur === null) suivants.delete(cle)
      else suivants.set(cle, valeur)
    }
    // `typedRoutes` refuse une chaîne construite dynamiquement : ce n'est pas
    // une route connue à la compilation. `destinationSure` n'accepte qu'un
    // chemin interne, ce qui interdit au passage toute redirection ouverte.
    demarrer(() => router.push(destinationSure(`${chemin}?${suivants.toString()}`)))
  }

  const raccourcis = [
    { libelle: "Aujourd'hui", du: aujourdhui, au: aujourdhui },
    { libelle: 'Hier', du: decaler(aujourdhui, -1), au: decaler(aujourdhui, -1) },
    { libelle: '7 derniers jours', du: decaler(aujourdhui, -6), au: aujourdhui },
    { libelle: '30 derniers jours', du: decaler(aujourdhui, -29), au: aujourdhui },
    { libelle: 'Ce mois', du: `${aujourdhui.slice(0, 7)}-01`, au: aujourdhui },
  ]

  const horaireNeutre = heureDebut === 0 && heureFin === 23

  return (
    <div className="periode" aria-busy={enCours}>
      <div className="periode-raccourcis">
        {raccourcis.map((r) => (
          <button
            key={r.libelle}
            type="button"
            className={du === r.du && au === r.au ? 'actif' : ''}
            onClick={() => aller({ du: r.du, au: r.au })}
          >
            {r.libelle}
          </button>
        ))}
      </div>

      <div className="periode-bornes">
        {/*
          Un seul contrôle pour les deux bornes.
          
          Deux champs « Du » et « au » posaient deux questions là où il n'y en
          a qu'une : quelle période. On les remplissait dans le désordre, et
          entre les deux saisies la page rechargeait un rapport sur une
          période que personne n'avait demandée.
        */}
        <Calendrier
          du={du}
          au={au}
          aujourdhui={aujourdhui}
          onChoisir={(d, a) => aller({ du: d, au: a })}
        />

        <label>
          🕐
          <select
            value={heureDebut}
            aria-label="Heure de début"
            onChange={(e) => aller({ h: `${e.target.value}-${Math.max(Number(e.target.value), heureFin)}` })}
          >
            {HEURES.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')} h
              </option>
            ))}
          </select>
        </label>
        <label>
          à
          <select
            value={heureFin}
            aria-label="Heure de fin (incluse)"
            onChange={(e) => aller({ h: `${Math.min(heureDebut, Number(e.target.value))}-${e.target.value}` })}
          >
            {HEURES.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')} h 59
              </option>
            ))}
          </select>
        </label>
        {!horaireNeutre && (
          <button type="button" className="discret" onClick={() => aller({ h: null })}>
            Toute la journée
          </button>
        )}

        {employes.length > 0 && (
          <label>
            👤
            <select
              value={employeId ?? ''}
              aria-label="Employé"
              onChange={(e) => aller({ employe: e.target.value || null })}
            >
              <option value="">Tous les employés</option>
              {employes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nom}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}
