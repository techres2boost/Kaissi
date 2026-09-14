/**
 * Les types que `payment_methods.type` accepte.
 *
 * ── Pourquoi un fichier à part, et pas dans `actions.ts` ──────────────────
 *
 * Un module « use server » ne peut exporter QUE des fonctions async : Next.js
 * transforme chacun de ses exports en point d'entrée appelable depuis le
 * navigateur, et une constante n'en est pas un. La garde
 * `src/serveur/use-server.test.ts` l'a dit avant Next.js — la liste vivait
 * d'abord à côté des actions.
 *
 * Fermée, et reprise telle quelle de la contrainte SQL : un type inventé
 * passerait la validation applicative et se ferait refuser par Postgres, avec
 * un message que personne ne relie à ce formulaire.
 */

export const TYPES_PAIEMENT = ['cash', 'card', 'online', 'other'] as const

export type TypePaiement = (typeof TYPES_PAIEMENT)[number]
