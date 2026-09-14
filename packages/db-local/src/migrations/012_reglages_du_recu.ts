/**
 * 012 — L'en-tête et le pied du REÇU arrivent jusqu'à la caisse.
 *
 * ── Ce qui manquait ───────────────────────────────────────────────────────
 *
 * Le ticket client porte une adresse, un téléphone et un identifiant fiscal
 * (`packages/domain/src/ticket.ts`, `EnteteEtablissement`). Ces trois valeurs
 * existent côté serveur depuis la migration 0002 — et n'ont jamais eu de
 * colonne ici. Le ticket les affichait donc toujours vides, quoi qu'on saisisse.
 *
 * ── Pourquoi elles descendent maintenant ──────────────────────────────────
 *
 * La migration Postgres 0035 pose un déclencheur `change_log` sur
 * `restaurants` et ajoute `receipt_footer`. `TABLES_MIROIR.restaurants` les
 * recopie ici, par le canal du catalogue — aucune voie de synchronisation
 * nouvelle, et la caisse ne fait qu'appliquer, exactement comme pour un
 * changement de prix.
 *
 * ADDITIVE : une version antérieure de l'application ignore ces colonnes et
 * continue de fonctionner sur la même base. C'est ce que demande le support
 * N−2 du protocole.
 */
export const SQL_012 = `
ALTER TABLE restaurants ADD COLUMN address TEXT;
ALTER TABLE restaurants ADD COLUMN phone TEXT;
ALTER TABLE restaurants ADD COLUMN fiscal_id TEXT;
ALTER TABLE restaurants ADD COLUMN receipt_footer TEXT;
`
