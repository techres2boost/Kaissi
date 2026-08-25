/**
 * @kaissi/ui — jetons de style partagés entre le POS et le back-office.
 *
 * Phase 0 : uniquement les jetons. Les composants React viendront quand deux
 * applications auront réellement besoin du MÊME composant — mutualiser avant
 * ce moment produit des abstractions qu'il faut ensuite défaire.
 */

export const JETONS = {
  couleurs: {
    fond: '#0f1214',
    surface: '#171b1f',
    surface2: '#1f252a',
    bordure: '#2a3238',
    texte: '#eceeea',
    texteSecondaire: '#9aa3a8',
    accent: '#e0a33f',
    ok: '#3fbf8f',
    alerte: '#e4756a',
  },
  rayon: { petit: '6px', normal: '10px', pastille: '999px' },
  /**
   * Cible tactile minimale sur un terminal de caisse. 56 px, pas 44 :
   * on tape vite, parfois les mains grasses, souvent debout.
   */
  cibleTactileMin: '56px',
  espacement: { xs: '0.25rem', s: '0.5rem', m: '0.75rem', l: '1rem', xl: '1.5rem' },
} as const

export type Jetons = typeof JETONS
