/**
 * Migration locale 008 — le référentiel de réductions, et sa trace.
 *
 * ── Pourquoi la caisse a besoin du référentiel EN LOCAL ───────────────────
 *
 * Parce qu'elle doit pouvoir proposer « Happy hour » à 19 h un soir de
 * coupure réseau. Une liste chargée depuis le serveur au moment du clic
 * serait exactement le genre de dépendance que ce produit refuse : elle ne
 * tomberait qu'en service, au pire moment.
 *
 * Elle descend par le catalogue (Postgres 0030), donc par le curseur qui
 * porte déjà les prix. Aucune nouvelle route, aucun nouveau flux.
 *
 * ── Pourquoi le libellé est recopié dans la vente ─────────────────────────
 *
 * `discount_label` fige le nom au moment de l'encaissement. Renommer une
 * réduction plus tard ne doit pas réécrire ce qui a été accordé : un rapport
 * qui change quand on renomme un réglage n'est plus un historique.
 *
 * ADDITIVE : deux colonnes, une table. Rien n'est retiré, et une version
 * antérieure du POS ignore la table qu'elle ne connaît pas.
 */

export const SQL_008 = `
CREATE TABLE discounts (
  id              TEXT PRIMARY KEY,
  organization_id TEXT,
  restaurant_id   TEXT,
  name            TEXT NOT NULL,
  -- 'pourcentage' ou 'montant'.
  kind            TEXT NOT NULL,
  -- Points de base ENTIERS : 10 % = 1000. Jamais 0.10.
  value_bp        INTEGER,
  amount_millimes INTEGER,
  position        INTEGER NOT NULL DEFAULT 0,
  archived_at     TEXT
) STRICT;

CREATE INDEX discounts_actives_idx ON discounts (position) WHERE archived_at IS NULL;

ALTER TABLE orders ADD COLUMN discount_id TEXT;
ALTER TABLE orders ADD COLUMN discount_label TEXT;
ALTER TABLE order_items ADD COLUMN discount_id TEXT;
ALTER TABLE order_items ADD COLUMN discount_label TEXT;
`
