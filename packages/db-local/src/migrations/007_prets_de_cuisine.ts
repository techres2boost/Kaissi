/**
 * Migration locale 007 — « prêt » arrive jusqu'à la tablette du serveur.
 *
 * La cuisine marque un plateau prêt sur son écran ; jusqu'ici, le marqueur
 * restait au back-office. Le serveur en salle repassait donc devant la
 * cuisine « au cas où » — exactement ce que l'écran devait supprimer.
 *
 * Le marqueur descend par `change_log` (migration Postgres 0029), le canal
 * qui porte déjà le catalogue : même curseur `seq` bigserial, mêmes pages,
 * et une version ancienne du POS ignore poliment l'entité inconnue.
 *
 * ── Pourquoi une table plutôt qu'une colonne sur `orders` ─────────────────
 *
 * `orders` est une PROJECTION : elle est réécrite en entier (DELETE puis
 * INSERT) à chaque nouvel événement de la commande. Une colonne « prête »
 * y serait effacée au premier ajout d'article — et cet effacement se ferait
 * en silence, au pire moment. Une table à part n'est jamais touchée par la
 * reprojection.
 *
 * ADDITIVE : ni `orders` ni aucune table existante n'est modifiée.
 */

export const SQL_007 = `
CREATE TABLE kitchen_ready (
  -- La COMMANDE, pas la ligne : en MVP la cuisine annonce un plateau prêt.
  order_id        TEXT PRIMARY KEY,
  organization_id TEXT,
  restaurant_id   TEXT,
  ready_at        TEXT,
  -- Retrait d'un « prêt » posé par erreur. La ligne reste : c'est ce qui
  -- permet au retrait de descendre, là où une suppression laisserait le
  -- badge allumé pour toujours.
  cleared_at      TEXT
);

CREATE INDEX kitchen_ready_actifs_idx ON kitchen_ready (order_id) WHERE cleared_at IS NULL;
`
