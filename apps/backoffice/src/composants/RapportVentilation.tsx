/**
 * Le corps commun des rapports de ventilation.
 *
 * Par article, par catégorie, par employé : trois écrans qui répondent à la
 * même forme de question — « qui fait le chiffre, et avec quelle marge ». Ce
 * composant porte leur structure (top 5, graphique, tableau exportable) pour
 * qu'ils ne divergent pas à la première retouche ; ce qui change d'un écran à
 * l'autre — l'intitulé de la colonne d'identité, les colonnes
 * supplémentaires — reste passé en paramètre.
 */

import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import type { Ventilation } from '../serveur/rapports.js'
import type { ColonneRapport } from './TableauRapport.js'
import { TableauRapport } from './TableauRapport.js'

/** Les cinq premiers, en toutes lettres — ce que Loyverse montre en tête. */
export function TopCinq({ lignes, entete }: { lignes: readonly Ventilation[]; entete: string }) {
  const cinq = lignes.slice(0, 5)
  if (cinq.length === 0) return null
  return (
    <section className="bloc">
      <div className="entete-bloc">
        <h2>Top 5 · {entete}</h2>
        <span className="detail">Ventes nettes</span>
      </div>
      <ul className="top-cinq">
        {cinq.map((l, rang) => (
          <li key={l.cle}>
            <span className="rang">{rang + 1}</span>
            <span className="nom">{l.libelle}</span>
            <span className="valeur">
              {formaterTND(l.marge.caMillimes)}
              <small className="detail"> {formaterPourcentage(l.part)} %</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Les colonnes chiffrées communes à toutes les ventilations. */
export function colonnesVentilation(): ColonneRapport<Ventilation>[] {
  return [
    {
      cle: 'quantite',
      titre: 'Articles vendus',
      nombre: true,
      rendu: (l) => l.quantite,
      valeur: (l) => l.quantite,
    },
    {
      cle: 'brut',
      titre: 'Ventes brutes',
      nombre: true,
      secondaire: true,
      rendu: (l) => formaterTND(millimes(l.brutMillimes)),
      valeur: (l) => l.brutMillimes,
    },
    {
      cle: 'remises',
      titre: 'Réductions',
      nombre: true,
      secondaire: true,
      rendu: (l) => formaterTND(millimes(l.remisesMillimes)),
      valeur: (l) => l.remisesMillimes,
    },
    {
      cle: 'net',
      titre: 'Ventes nettes',
      nombre: true,
      rendu: (l) => formaterTND(l.marge.caMillimes),
      valeur: (l) => l.marge.caMillimes,
    },
    {
      cle: 'cout',
      titre: 'Coût des marchandises',
      nombre: true,
      secondaire: true,
      rendu: (l) => formaterTND(l.marge.coutMillimes),
      valeur: (l) => l.marge.coutMillimes,
    },
    {
      cle: 'marge',
      titre: 'Marge brute',
      nombre: true,
      rendu: (l) => formaterTND(l.marge.margeMillimes),
      valeur: (l) => l.marge.margeMillimes,
    },
    {
      cle: 'margeBp',
      titre: 'Marge',
      nombre: true,
      rendu: (l) =>
        // « Coût non saisi » et « marge nulle » sont deux états différents.
        // Afficher 0 % ferait passer le premier pour le second, et le total
        // paraîtrait juste.
        l.marge.margeBp === null ? (
          <span className="detail" title="Coût d’achat non saisi">
            —
          </span>
        ) : (
          `${formaterPourcentage(l.marge.margeBp)} %`
        ),
      valeur: (l) => l.marge.margeBp ?? -1,
    },
    {
      cle: 'taxes',
      titre: 'Taxes',
      nombre: true,
      secondaire: true,
      rendu: (l) => formaterTND(millimes(l.taxesMillimes)),
      valeur: (l) => l.taxesMillimes,
    },
    {
      cle: 'part',
      titre: 'Part du CA',
      nombre: true,
      rendu: (l) => `${formaterPourcentage(l.part)} %`,
      valeur: (l) => l.part,
    },
  ]
}

export function TableauVentilationRapport({
  lignes,
  entete,
  colonnesEnTete = [],
  actions,
}: {
  lignes: readonly Ventilation[]
  entete: string
  /** Colonnes d'identité, avant les chiffres (article, UGS, catégorie…). */
  colonnesEnTete?: readonly ColonneRapport<Ventilation>[]
  actions?: React.ReactNode
}) {
  return (
    <TableauRapport
      lignes={lignes}
      cleDe={(l) => l.cle}
      actions={actions}
      colonnes={[
        { cle: 'libelle', titre: entete, rendu: (l) => l.libelle, valeur: (l) => l.libelle },
        ...colonnesEnTete,
        ...colonnesVentilation(),
      ]}
    />
  )
}
