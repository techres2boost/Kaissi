/**
 * Le corps commun des rapports de ventilation.
 *
 * Par article, par catégorie, par employé : trois écrans qui répondent à la
 * même forme de question — « qui fait le chiffre, et avec quelle marge ». Ce
 * module porte leur structure pour qu'ils ne divergent pas à la première
 * retouche.
 *
 * ── Ce qui traverse la frontière serveur → client ─────────────────────────
 *
 * Des CHAÎNES, jamais des fonctions. Les cellules sont formatées ici, côté
 * serveur, et le tableau ne reçoit que du texte et des clés de tri. Une
 * fonction ne se sérialise pas : la version qui en passait a fait tomber six
 * écrans en production, sans que ni TypeScript ni `next build` ne le voient.
 */

import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import type { Ventilation } from '../serveur/rapports.js'
import type { Cellule, ColonneRapport, LigneRapport } from './TableauRapport.js'

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

/** Une cellule de montant : le texte à lire, le nombre pour trier. */
export function celluleMontant(valeurMillimes: number): Cellule {
  return { texte: formaterTND(millimes(Math.round(valeurMillimes))), valeur: valeurMillimes }
}

export function cellulePourcent(bp: number | null): Cellule {
  // « Coût non saisi » et « marge nulle » sont deux états différents.
  // Afficher 0 % ferait passer le premier pour le second, et le total
  // paraîtrait juste.
  return bp === null
    ? { texte: '—', classe: 'detail', aide: 'Coût d’achat non saisi', valeur: -1 }
    : { texte: `${formaterPourcentage(bp)} %`, valeur: bp }
}

/** Les colonnes chiffrées communes à toutes les ventilations. */
export const COLONNES_VENTILATION: readonly ColonneRapport[] = [
  { cle: 'quantite', titre: 'Articles vendus', nombre: true },
  { cle: 'brut', titre: 'Ventes brutes', nombre: true, secondaire: true },
  { cle: 'remises', titre: 'Réductions', nombre: true, secondaire: true },
  { cle: 'net', titre: 'Ventes nettes', nombre: true },
  { cle: 'cout', titre: 'Coût des marchandises', nombre: true, secondaire: true },
  { cle: 'marge', titre: 'Marge brute', nombre: true },
  { cle: 'margeBp', titre: 'Marge', nombre: true },
  { cle: 'taxes', titre: 'Taxes', nombre: true, secondaire: true },
  { cle: 'part', titre: 'Part du CA', nombre: true },
]

/** Les cellules chiffrées d'une ventilation, dans l'ordre ci-dessus. */
export function cellulesVentilation(l: Ventilation): Record<string, Cellule> {
  return {
    quantite: { texte: String(l.quantite), valeur: l.quantite },
    brut: celluleMontant(l.brutMillimes),
    remises: celluleMontant(l.remisesMillimes),
    net: celluleMontant(l.marge.caMillimes),
    cout: celluleMontant(l.marge.coutMillimes),
    marge: celluleMontant(l.marge.margeMillimes),
    margeBp: cellulePourcent(l.marge.margeBp),
    taxes: celluleMontant(l.taxesMillimes),
    part: { texte: `${formaterPourcentage(l.part)} %`, valeur: l.part },
  }
}

/** Une ventilation entière, prête pour le tableau. */
export function lignesVentilation(
  lignes: readonly Ventilation[],
  /** Cellules d'identité supplémentaires — la catégorie d'un article, par exemple. */
  supplement: (l: Ventilation) => Record<string, Cellule> = () => ({}),
): LigneRapport[] {
  return lignes.map((l) => ({
    cle: l.cle,
    cellules: {
      libelle: { texte: l.libelle, valeur: l.libelle },
      ...supplement(l),
      ...cellulesVentilation(l),
    },
  }))
}

export function colonnesVentilation(
  entete: string,
  supplement: readonly ColonneRapport[] = [],
): ColonneRapport[] {
  return [{ cle: 'libelle', titre: entete }, ...supplement, ...COLONNES_VENTILATION]
}
