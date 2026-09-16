import { coutLigneExact, formaterTND } from '@kaissi/domain'
import { montant } from '../serveur/montant.js'

/**
 * Le détail de la valorisation, article par article.
 *
 * ── La colonne « Valeur » est arrondie POUR L'AFFICHAGE, et le dit ────────
 *
 * Le total, lui, ne l'est qu'une fois — c'est `valoriserStock()` qui le
 * calcule, sur les coûts EXACTS. Les valeurs de ce tableau, additionnées à la
 * main, peuvent donc différer du total de quelques millimes.
 *
 * C'est le comportement correct, et il est contre-intuitif : quelqu'un qui
 * additionne la colonne et trouve deux millimes d'écart doit lire pourquoi,
 * sans quoi il conclut à un bug. D'où la note sous le tableau — et d'où le
 * fait qu'on ne « corrige » pas l'écart en arrondissant ligne à ligne, ce qui
 * ferait dériver le total de plusieurs dinars sur quatre cents références.
 */
export interface LigneValorisee {
  readonly id: string
  readonly nom: string
  readonly quantite: number
  readonly coutUnitaire: number | null
}

/** Une quantité de stock : `numeric`, jamais un entier — 0,25 kg existe. */
function quantite(valeur: number): string {
  return valeur.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
}

export function TableauValorisation({ lignes }: { lignes: readonly LigneValorisee[] }) {
  if (lignes.length === 0) {
    return (
      <p className="vide">
        Aucun article suivi en stock. Activez le suivi article par article dans
        l’écran Stock : sans quantité, il n’y a rien à valoriser.
      </p>
    )
  }

  return (
    <>
      <div className="tableau-defilant">
        <table className="valorisation">
          <thead>
            <tr>
              <th scope="col">Article</th>
              <th scope="col" className="nombre">Quantité</th>
              <th scope="col" className="nombre cout-unitaire">Coût unitaire</th>
              <th scope="col" className="nombre">Valeur</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id}>
                <th scope="row">
                  {l.nom}
                  {/*
                    Le coût unitaire REDIT sous le nom, et masqué au-dessus de
                    560 px où la colonne suffit.

                    Sur un téléphone, quatre colonnes de chiffres poussent la
                    colonne « Valeur » hors de l'écran — c'est-à-dire
                    précisément celle qu'on vient lire. Faire défiler pour
                    l'atteindre marche, mais on ne défile que si l'on sait
                    qu'il y a quelque chose à voir. Le coût unitaire, lui, est
                    une donnée de vérification : il descend donc sous le nom
                    plutôt que de disparaître.
                  */}
                  <span className="cout-replie">
                    {l.coutUnitaire === null
                      ? 'coût non saisi'
                      : `coût unitaire ${l.coutUnitaire.toLocaleString('fr-FR', { maximumFractionDigits: 6 })}`}
                  </span>
                </th>
                <td className={l.quantite < 0 ? 'nombre ecart negatif' : 'nombre'}>
                  {quantite(l.quantite)}
                </td>
                <td className="nombre cout-unitaire">
                  {l.coutUnitaire === null ? (
                    <span className="detail">non saisi</span>
                  ) : (
                    /*
                      Le coût unitaire s'affiche avec ses décimales : c'est la
                      seule grandeur de ce logiciel qui n'est pas un entier de
                      millimes, et l'afficher arrondi ferait lire « 0,000 TND »
                      sur un gramme de mozzarella.
                    */
                    <>{l.coutUnitaire.toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</>
                  )}
                </td>
                <td className="nombre">
                  {l.coutUnitaire === null ? (
                    <span className="detail">—</span>
                  ) : (
                    formaterTND(
                      montant(Math.round(coutLigneExact(l.coutUnitaire, l.quantite))),
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="indication">
        Les valeurs de la colonne de droite sont arrondies <strong>pour
        l’affichage</strong>. Le total, lui, n’est arrondi qu’une fois, sur les
        coûts exacts : additionner cette colonne à la main peut donner quelques
        millimes d’écart, et c’est le total qui est juste. Arrondir chaque ligne
        ferait dériver la valeur d’un stock de plusieurs dinars.
      </p>
    </>
  )
}
