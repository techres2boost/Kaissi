/**
 * Un classement à barres — ce qui se vend, dans l'ordre.
 *
 * ── Pourquoi ce graphique EST le tableau ──────────────────────────────────
 *
 * Un graphique à côté d'un tableau des mêmes chiffres, c'est deux fois la
 * même chose à lire, et deux occasions de diverger le jour où l'un des deux
 * est modifié. La barre vit donc DANS une cellule : on garde le classement
 * visuel — la longueur se compare d'un coup d'œil, un nombre non — et on
 * garde le tableau, qui reste lisible au lecteur d'écran, copiable, et
 * exportable tel quel.
 *
 * ── Une seule teinte, et c'est un choix vérifié ───────────────────────────
 *
 * La longueur de la barre porte DÉJÀ la grandeur. Colorer chaque article
 * d'une teinte différente n'ajouterait aucune information, et coûterait
 * cher : le validateur de palette rejette le vert menthe de la marque et
 * l'olive atténuée comme deux séries — écart perceptuel 6,8 en deutéranopie,
 * 9,2 même en vision normale, sous le plancher de 15. Deux articles voisins
 * seraient donc indiscernables pour une partie des lecteurs, et à peine
 * distincts pour les autres.
 *
 * On ne colore pas non plus le premier différemment : la couleur suivrait
 * alors le RANG, qui change à chaque changement de période, et l'œil
 * apprendrait une association fausse.
 *
 * ── Ce que la barre représente ────────────────────────────────────────────
 *
 * Toujours une part du MAXIMUM de la liste, jamais du total. Une barre
 * proportionnelle au total serait invisible dès qu'un restaurant vend
 * quarante références — or c'est le cas normal.
 *
 * ── Pas de chiffre DANS la barre ──────────────────────────────────────────
 *
 * Première version : le montant était posé à droite de la piste. Sur écran
 * étroit, une barre longue passait dessous et le texte ivoire se retrouvait
 * sur la menthe — illisible, et précisément sur les premières lignes, celles
 * qu'on regarde. Le chiffre est déjà dans la colonne d'à côté : le répéter
 * coûtait sa lisibilité sans rien apprendre.
 */

import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'

export interface LigneClassement {
  readonly cle: string
  readonly libelle: string
  readonly quantite: number
  readonly caMillimes: number
  readonly margeMillimes: number
  readonly margeBp: number | null
  /** Part du CA de la période, en points de base. */
  readonly partBp: number
}

/** Ce que la barre mesure — le lecteur choisit, parce que ce n'est pas la
 *  même question : le plus VENDU n'est pas toujours celui qui RAPPORTE. */
export type Mesure = 'ca' | 'quantite'

export function BarresClassement({
  lignes,
  entete,
  mesure,
  /** Au-delà, on montre le reste en tableau sans barre : trente barres ne se
   *  comparent plus, elles se subissent. */
  plafondBarres = 15,
}: {
  lignes: readonly LigneClassement[]
  entete: string
  mesure: Mesure
  plafondBarres?: number
}) {
  if (lignes.length === 0) {
    return <p className="vide">Aucune vente sur cette période.</p>
  }

  const valeur = (l: LigneClassement) => (mesure === 'ca' ? l.caMillimes : l.quantite)
  const classees = [...lignes].sort((a, b) => valeur(b) - valeur(a))
  // `|| 1` : une période où tout vaut zéro diviserait par zéro et rendrait
  // des barres `NaN%`, donc invisibles sans que rien ne l'explique.
  const maximum = valeur(classees[0]!) || 1

  return (
    <div className="tableau-defilant">
      <table className="classement">
        <thead>
          <tr>
            <th className="nombre rang">#</th>
            <th>{entete}</th>
            <th className="colonne-barre">
              {mesure === 'ca' ? 'Chiffre d’affaires' : 'Quantité vendue'}
            </th>
            <th className="nombre">Quantité</th>
            <th className="nombre">CA</th>
            <th className="nombre">Marge</th>
            <th className="nombre">Part</th>
          </tr>
        </thead>
        <tbody>
          {classees.map((l, rang) => {
            const part = Math.max(0, Math.min(1, valeur(l) / maximum))
            const etiquette =
              mesure === 'ca'
                ? formaterTND(millimes(Math.round(l.caMillimes)))
                : String(l.quantite)
            return (
              <tr key={l.cle}>
                <td className="nombre rang">{rang + 1}</td>
                <td>{l.libelle}</td>
                <td className="colonne-barre">
                  {rang < plafondBarres ? (
                    /*
                     * `role="img"` + `aria-label` : la barre est décorative
                     * pour un lecteur d'écran, qui lit déjà les colonnes
                     * chiffrées juste à côté. Sans ce marquage, il annoncerait
                     * deux div vides par ligne.
                     */
                    <div
                      className="barre-piste"
                      role="img"
                      aria-label={`${etiquette}, soit ${Math.round(part * 100)} % du premier`}
                    >
                      <div className="barre-valeur" style={{ width: `${part * 100}%` }} />
                    </div>
                  ) : (
                    <span className="detail">{etiquette}</span>
                  )}
                </td>
                <td className="nombre">{l.quantite}</td>
                <td className="nombre">{formaterTND(millimes(Math.round(l.caMillimes)))}</td>
                <td className="nombre">
                  {l.margeBp === null ? (
                    // « Coût non saisi » et « marge nulle » sont deux états
                    // différents. Afficher 0 ferait passer le premier pour le
                    // second, et la marge globale paraîtrait juste.
                    <span className="detail" title="Coût d’achat non saisi">
                      —
                    </span>
                  ) : (
                    <>
                      {formaterTND(millimes(Math.round(l.margeMillimes)))}
                      <small className="detail"> {formaterPourcentage(l.margeBp)} %</small>
                    </>
                  )}
                </td>
                <td className="nombre detail">{formaterPourcentage(l.partBp)} %</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
