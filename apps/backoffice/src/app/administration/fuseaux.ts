/**
 * Les constantes de l'écran « Administration » — dans un module ORDINAIRE.
 *
 * ── Pourquoi ce fichier existe, alors qu'il ne contient qu'un tableau ─────
 *
 * PANNE RÉELLE, remontée depuis la production : la page
 * « Administration → Établissements » ne s'affichait pas du tout. À la
 * place, l'écran d'erreur — sans rien dire de plus.
 *
 * `FUSEAUX` vivait dans `actions.ts`, qui porte `'use server'`. Or un
 * fichier `'use server'` ne peut exporter QUE des fonctions asynchrones :
 * Next.js remplace chacun de ses exports, côté navigateur, par un
 * *mandataire* d'action serveur. Le composant client recevait donc un
 * mandataire là où il attendait un tableau, et `FUSEAUX.map(…)` levait
 * « u.map is not a function » — au rendu, pas au build.
 *
 * ── Ce qui rend ce défaut particulièrement traître ───────────────────────
 *
 * `next build` ne le signale pas (vérifié : la construction passe, et la CI
 * était verte). Le typage non plus — TypeScript voit bien un
 * `readonly string[]`, parce que le remplacement a lieu à l'empaquetage,
 * après lui. Rien, nulle part, ne prévient : la page est simplement morte.
 *
 * On l'a confirmé en cherchant `Africa/Casablanca` dans le paquet livré au
 * navigateur — absent, alors que le code appelait `.map` dessus.
 *
 * ⚑ La règle, générale : un fichier `'use server'` n'exporte QUE des
 *   fonctions `async`. Les types sont sans risque — ils s'effacent à la
 *   compilation. Tout le reste doit vivre dans un module ordinaire, que les
 *   deux côtés peuvent importer. `apps/backoffice/src/serveur/use-server.test.ts`
 *   le vérifie désormais sur TOUT le dépôt.
 */

/** Les fuseaux qu'un restaurant tunisien peut légitimement vouloir. */
export const FUSEAUX = [
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Casablanca',
  'Europe/Paris',
] as const

export type Fuseau = (typeof FUSEAUX)[number]

/**
 * Valide une saisie contre la liste.
 *
 * `as const` ferme le type — c'est ce qui fait qu'un fuseau écrit de travers
 * ne compile pas ailleurs — mais rend `includes()` inutilisable sur une
 * `string` quelconque. Ce garde rétablit le pont, à UN endroit, plutôt que
 * de disséminer des conversions de type sur chaque appel.
 */
export function estFuseauConnu(valeur: string): valeur is Fuseau {
  return (FUSEAUX as readonly string[]).includes(valeur)
}

export interface Resultat {
  erreur?: string
  succes?: string
  /** L'établissement tout juste créé, pour y aller d'un clic. */
  restaurantId?: string
}
