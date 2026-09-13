/**
 * Migration locale 011 — un article créé SUR la caisse, et qui remonte.
 *
 * ── Ce qui manquait, et pourquoi ce n'est pas anodin ──────────────────────
 *
 * Le catalogue ne descendait que dans un sens : serveur → caisse, par
 * `change_log`. C'est la bonne asymétrie par défaut — le serveur voit tous
 * les terminaux, une tablette n'en voit qu'un. Mais elle obligeait à sortir
 * de la caisse pour ajouter un plat du jour, c'est-à-dire au moment où l'on
 * a le moins le temps.
 *
 * ── La colonne, et pourquoi UNE SEULE suffit ──────────────────────────────
 *
 * `local_event_id` porte l'identifiant de la mutation qui a créé l'article
 * depuis cette caisse. Tout l'état en découle, sans qu'aucun code n'ait à
 * l'entretenir :
 *
 *   • une ligne d'outbox `en_attente` pour cet identifiant → l'article
 *     attend d'être remonté ;
 *   • une ligne `rejete`                                   → le serveur l'a
 *     refusé, et le gérant doit le savoir ;
 *   • plus aucune ligne                                    → c'est réglé.
 *     `accuserReception` supprime l'entrée d'outbox, et l'article redevient
 *     un article comme les autres, sans une ligne de code de plus.
 *
 * Un drapeau `en_attente` séparé aurait demandé qu'on pense à l'éteindre —
 * au bon endroit, dans la bonne transaction, y compris sur le chemin du
 * rejet. C'est exactement le genre de compteur qui dérive en silence. Ici,
 * l'outbox est déjà la vérité sur « qu'est-ce qui n'est pas parti » ; on s'y
 * raccroche au lieu de la dupliquer.
 *
 * ── Pourquoi le miroir n'y touche pas ─────────────────────────────────────
 *
 * `TABLES_MIROIR.products` énumère ses colonnes, et celle-ci n'y est pas :
 * la redescente par `change_log` réécrit l'article sans l'effacer. La trace
 * reste, inoffensive — l'outbox, elle, est vide, et c'est elle qui décide.
 *
 * ADDITIVE : une version antérieure de l'application ignore cette colonne et
 * continue de fonctionner sur la même base.
 */
export const SQL_011 = `
ALTER TABLE products ADD COLUMN local_event_id TEXT;

CREATE INDEX products_mutation_locale_idx ON products (local_event_id)
  WHERE local_event_id IS NOT NULL;
`
