'use client'

/**
 * Le tableau d'un rapport : colonnes au choix, tri, pagination, export.
 *
 * ── Pourquoi les cellules arrivent DÉJÀ formatées ─────────────────────────
 *
 * Première version : chaque colonne portait une fonction `rendu(ligne)`. Le
 * code se lisait bien, et il a fait tomber SIX écrans en production —
 * « Application error: a server-side exception has occurred ».
 *
 * La cause n'a rien à voir avec les données : une fonction ne traverse pas la
 * frontière entre un composant serveur et un composant client. React doit
 * sérialiser les propriétés pour les envoyer au navigateur, et une clôture
 * ne se sérialise pas. Le compilateur ne le voit pas, `next build` non plus :
 * l'erreur n'apparaît qu'au rendu, une fois déployé.
 *
 * Les cellules sont donc du TEXTE, calculé côté serveur, accompagné d'une
 * valeur de tri facultative. Ce qui traverse la frontière est de la donnée,
 * et rien d'autre — ce qui est aussi la règle générale de ce dépôt.
 *
 * ── Pourquoi la pagination est côté NAVIGATEUR ────────────────────────────
 *
 * La page charge déjà toute la période — les indicateurs et le graphique en
 * ont besoin, et une somme partielle serait fausse. Repaginer côté serveur
 * ajouterait un aller-retour par clic pour redécouper des lignes déjà là.
 *
 * ── L'export ne suit PAS la pagination ────────────────────────────────────
 *
 * Il porte la période entière. Exporter « la page 2 » serait le genre de
 * piège qu'on ne découvre qu'en rapprochant deux totaux qui ne collent pas.
 */

import Link from 'next/link'
import { useState } from 'react'
import { destinationSure } from '../serveur/redirection.js'

/** Une cellule : du texte, et de quoi la trier ou la nuancer. */
export interface Cellule {
  readonly texte: string
  /** Clé de tri. À défaut, on trie sur le texte — donc alphabétiquement. */
  readonly valeur?: number | string
  /** Classe supplémentaire : « detail » pour un tiret gris, « negatif »… */
  readonly classe?: string
  /** Infobulle — « Coût d'achat non saisi » sur un tiret, par exemple. */
  readonly aide?: string
  /** Chemin interne : la cellule devient un lien. */
  readonly lien?: string
}

export interface ColonneRapport {
  readonly cle: string
  readonly titre: string
  /** Aligné à droite : tout ce qui se compare verticalement. */
  readonly nombre?: boolean
  /** Colonne masquée au premier affichage — l'essentiel reste visible. */
  readonly secondaire?: boolean
  /** Colonne non triable (un lien, une action). */
  readonly sansTri?: boolean
}

export interface LigneRapport {
  readonly cle: string
  readonly cellules: Readonly<Record<string, Cellule>>
}

const TAILLES = [10, 25, 50, 100] as const

export function TableauRapport({
  lignes,
  colonnes,
  titre,
  actions,
  vide = 'Aucune ligne sur cette période.',
}: {
  lignes: readonly LigneRapport[]
  colonnes: readonly ColonneRapport[]
  titre?: string
  /** Boutons d'export, rendus à droite du titre. Un ÉLÉMENT traverse la
   *  frontière sans problème — c'est une fonction qui ne le peut pas. */
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

  const cle = (ligne: LigneRapport, colonne: string) =>
    ligne.cellules[colonne]?.valeur ?? ligne.cellules[colonne]?.texte ?? ''

  const triees = tri
    ? [...lignes].sort((a, b) => {
        const va = cle(a, tri.cle)
        const vb = cle(b, tri.cle)
        const ordre =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'fr')
        return tri.descendant ? -ordre : ordre
      })
    : lignes

  const pages = Math.max(1, Math.ceil(triees.length / taille))
  // La page courante est bornée à chaque rendu : après un filtre qui réduit
  // la liste, rester sur la page 7 afficherait un tableau vide sans rien dire.
  const pageSure = Math.min(page, pages)
  const affichees = triees.slice((pageSure - 1) * taille, pageSure * taille)

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
                      {c.sansTri ? (
                        c.titre
                      ) : (
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
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {affichees.map((ligne) => (
                  <tr key={ligne.cle}>
                    {visibles.map((c) => {
                      const cellule = ligne.cellules[c.cle]
                      const classes = [c.nombre ? 'nombre' : '', cellule?.classe ?? '']
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <td key={c.cle} className={classes || undefined} title={cellule?.aide}>
                          {cellule?.lien ? (
                            <Link href={destinationSure(cellule.lien)}>{cellule.texte}</Link>
                          ) : (
                            (cellule?.texte ?? '—')
                          )}
                        </td>
                      )
                    })}
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
