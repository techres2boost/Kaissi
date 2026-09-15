/**
 * 013 — Le taux applicable au SERVICE descend jusqu'à la caisse.
 *
 * ── Ce qui manquait, et ce qui ne manquait pas ────────────────────────────
 *
 * `service_rate_bp`, `service_taxable` et `stamp_duty_millimes` ont leur
 * colonne ici depuis la 001 : la caisse pouvait les stocker, simplement rien
 * ne les lui envoyait et rien ne les lisait. Une seule colonne manque
 * vraiment, celle que la migration Postgres 0036 vient d'ajouter :
 * `service_tax_rate_id`.
 *
 * Sans elle, `service_taxable` à vrai n'a AUCUN effet — le domaine ne calcule
 * la taxe du service que s'il connaît aussi le taux. La case pouvait être
 * cochée sans rien changer au total.
 *
 * ── Ce qui rend la descente sûre ──────────────────────────────────────────
 *
 * `TABLES_MIROIR.restaurants` énumère désormais les quatre colonnes, et elles
 * arrivent par `change_log`, comme un changement de prix. Le déclencheur
 * existe depuis la 0035 ; il n'y a donc aucune voie de synchronisation
 * nouvelle, et la caisse ne fait qu'appliquer.
 *
 * ADDITIVE : une version antérieure de l'application ignore cette colonne et
 * continue de fonctionner sur la même base — elle calculera simplement sans
 * taxe sur le service, comme elle le faisait déjà. C'est ce que demande le
 * support N−2 du protocole.
 */
export const SQL_013 = `
ALTER TABLE restaurants ADD COLUMN service_tax_rate_id TEXT;
`
