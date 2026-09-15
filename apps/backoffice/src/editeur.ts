/**
 * Qui édite Kaissi, et comment le joindre.
 *
 * ── Pourquoi ces quatre valeurs vivent ICI ────────────────────────────────
 *
 * Elles sont affichées à deux endroits au moins : la page d'assistance
 * PUBLIQUE (`/support`, qu'Apple visite pendant la revue) et l'écran
 * « Paramètres → Aide », réservé au gérant connecté. Recopiées, elles
 * divergent — et le jour où l'adresse change, l'une des deux continue
 * d'envoyer les clients dans le vide pendant des mois, sans que personne ne
 * s'en aperçoive : celui qui écrit à la mauvaise adresse n'obtient pas de
 * réponse, donc ne le signale pas.
 *
 * ⚠ À COMPLÉTER PAR L'ÉDITEUR avant publication : le téléphone et les
 *   horaires réels. Ils restent VIDES tant qu'aucune ligne n'est réellement
 *   tenue, et les deux écrans s'adaptent — une page qui promet une hotline
 *   inexistante est pire que pas de hotline.
 */
/*
 * Types ÉCRITS, et surtout pas `as const`.
 *
 * Avec `as const`, `telephone: ''` a pour type le littéral `''` : TypeScript
 * en déduit que `EDITEUR.telephone ? …` est toujours faux, réduit la branche
 * à `never`, et refuse de compiler le code qui affiche le numéro. C'est-à-dire
 * exactement la branche qui existe POUR être remplie. Le type était trop malin :
 * il interdisait ce que le commentaire promet.
 */
export interface Editeur {
  readonly nom: string
  readonly contact: string
  /** Laisser vide tant qu'aucune ligne n'est réellement tenue. */
  readonly telephone: string
  /** Idem : vide affiche « nous répondons sous un jour ouvré » à la place. */
  readonly horaires: string
}

export const EDITEUR: Editeur = {
  nom: 'Res2Boost',
  contact: 'contact@res2boost.com',
  telephone: '',
  horaires: '',
}

/** Le repli affiché quand `horaires` est vide. Une seule formulation. */
export const DELAI_PAR_DEFAUT =
  'Nous répondons sous un jour ouvré. Le service se fait en français et en arabe.'
