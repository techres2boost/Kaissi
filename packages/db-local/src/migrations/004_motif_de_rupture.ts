/**
 * Migration locale 004 — pourquoi un produit est hors carte.
 *
 * Depuis la migration Postgres 0023, un produit sort de la carte pour deux
 * raisons bien différentes : le gérant l'a retiré (« manuel »), ou son stock
 * suivi est tombé à zéro (« stock »). La caisse affichait la même phrase dans
 * les deux cas, ce qui n'aide ni le caissier ni le client :
 *
 *   • « en rupture de stock » quand c'est une décision de gestion est faux —
 *     il en reste peut-être en réserve ;
 *   • « retiré de la carte » quand c'est un stock à zéro n'explique rien.
 *
 * ADDITIVE : une tablette restée en version 3 ignore simplement la colonne,
 * et continue d'appliquer `is_available` comme avant.
 */

export const SQL_004 = `
ALTER TABLE products ADD COLUMN unavailable_reason TEXT;
`
