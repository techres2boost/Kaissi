'use client'

/**
 * Le tableau d'un rapport : colonnes au choix, pagination, export.
 *
 * ── Pourquoi la pagination est côté NAVIGATEUR ────────────────────────────
 *
 * La page charge déjà toute la période — les indicateurs et le graphique en
 * ont besoin, et une somme partielle serait fausse. Repaginer côté serveur
 * ajouterait un aller-retour par clic pour redécouper des lignes déjà là.
 *
 * ── Pourquoi un choix de colonnes ─────────────────────────────────────────
 *
 * Douze colonnes ne tiennent pas sur un écran de gérant, et les masquer
 * d'autorité, c'est décider à sa place ce qu'il regarde. Le choix est
 * mémorisé pendant la visite, pas au-delà : une préférence stockée qu'on a
 * oublié d'avoir posée fait croire à des colonnes disparues.
 *
 * ── L'export ne suit PAS la pagination ────────────────────────────────────
 *
 * Il porte la période entière. Exporter « la page 2 » serait le genre de
 * piège qu'on ne découvre qu'en rapprochant deux totaux qui ne collent pas.
 */

import { useState } from 'react'

export interface ColonneRapport<L> {
  readonly cle: string
  readonly titre: string
  /** Aligné à droite : tout ce qui se compare verticalement. */
  readonly nombre?: boolean
  /** Colonne masquée au premier affichage — l'essentiel reste visible. */
  readonly secondaire?: boolean
  readonly rendu: (ligne: L) => React.ReactNode
  /** Clé de tri ; à défaut, la colonne n'est pas triable. */
  readonly valeur?: (ligne: L) => number | string
}

const TAILLES = [10, 25, 50, 100] as const

export function TableauRapport<L>({
  lignes,
  colonnes,
  cleDe,
  titre,
  actions,
  vide = 'Aucune ligne sur cette période.',
}: {
  lignes: readonly L[]
  colonnes: readonly ColonneRapport<L>[]
  cleDe: (ligne: L) => string
  titre?: string
  /** Boutons d'export, rendus à droite du titre. */
  actions?: React.ReactNode
  vide?: string
}) {
  const [taille, setTaille] = useState<number>(10)
  const [page, setPage] = useState(1)
  const [masquees, setMasquees] = useState<ReadonlySet<string>>(
    () => new Set(colonnes.filter((c) => c.secondaire).map((c) => c.cle)),
  )
  const [choixOuvert, setChoixOuvert] = useState(false)
  const [tri, setTri] = useState<{ cle: string; descendant: boolean } | null>(null)

  const visibles = colonnes.filter((c) => !masquees.has(c.cle))

  const colonneTri = tri ? colonnes.find((c) => c.cle === tri.cle) : null
  const triees =
    colonneTri?.valeur === undefined
      ? lignes
      : [...lignes].sort((a, b) => {
          const va = colonneTri.valeur!(a)
          const vb = colonneTri.valeur!(b)
          const ordre =
            typeof va === 'number' && typeof vb === 'number'
              ? va - vb
              : String(va).localeCompare(String(vb), 'fr')
          return tri!.descendant ? -ordre : ordre
        })

  const pages = Math.max(1, Math.ceil(triees.length / taille))
  // La page courante est bornée à chaque rendu : après un filtre qui réduit
  // la liste, rester sur la page 7 afficherait un tableau vide sans rien dire.
  const pageSure = Math.min(page, pages)
  const visiblesLignes = triees.slice((pageSure - 1) * taille, pageSure * taille)

  return (
    <section className="bloc">
      <div className="entete-bloc">
        {titre ? <h2>{titre}</h2> : <span />}
        <div className="actions-tableau">
          {actions}
          <button
            type="button"
            className="discret"
            aria-expanded={choixOuvert}
            onClick={() => setChoixOuvert((o) => !o)}
          >
            ▥ Colonnes
          </button>
        </div>
      </div>

      {choixOuvert && (
        <fieldset className="choix-colonnes">
          <legend>Champs affichés</legend>
          {colonnes.map((c) => (
            <label key={c.cle}>
              <input
                type="checkbox"
                checked={!masquees.has(c.cle)}
                onChange={(e) => {
                  const suivantes = new Set(masquees)
                  if (e.target.checked) suivantes.delete(c.cle)
                  else suivantes.add(c.cle)
                  setMasquees(suivantes)
                }}
              />
              {c.titre}
            </label>
          ))}
        </fieldset>
      )}

      {lignes.length === 0 ? (
        <p className="vide">{vide}</p>
      ) : (
        <>
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  {visibles.map((c) => (
                    <th key={c.cle} className={c.nombre ? 'nombre' : undefined}>
                      {c.valeur ? (
                        <button
                          type="button"
                          className="tri"
                          onClick={() =>
                            setTri((t) =>
                              t?.cle === c.cle
                                ? { cle: c.cle, descendant: !t.descendant }
                                : { cle: c.cle, descendant: true },
                            )
                          }
                        >
                          {c.titre}
                          {tri?.cle === c.cle ? (tri.descendant ? ' ↓' : ' ↑') : ''}
                        </button>
                      ) : (
                        c.titre
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiblesLignes.map((ligne) => (
                  <tr key={cleDe(ligne)}>
                    {visibles.map((c) => (
                      <td key={c.cle} className={c.nombre ? 'nombre' : undefined}>
                        {c.rendu(ligne)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              type="button"
              className="discret"
              disabled={pageSure <= 1}
              onClick={() => setPage(pageSure - 1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="discret"
              disabled={pageSure >= pages}
              onClick={() => setPage(pageSure + 1)}
            >
              ›
            </button>
            <span className="detail">
              Page {pageSure} de {pages} · {triees.length} ligne(s)
            </span>
            <label className="detail">
              Lignes par page :
              <select
                value={taille}
                onChange={(e) => {
                  setTaille(Number(e.target.value))
                  setPage(1)
                }}
              >
                {TAILLES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
    </section>
  )
}
