/**
 * Migration locale 002 — ce dont la caisse a besoin en Phase 1.
 *
 * ADDITIVE, comme l'exige le support N−2 du protocole de synchronisation :
 * on ajoute des colonnes et des tables, on n'en supprime aucune et on ne
 * change le type de rien. Une tablette restée en version 1 pendant trois
 * semaines continue d'écrire dans les colonnes qu'elle connaît.
 */

export const SQL_002 = `
-- ── Employés : le PIN validé HORS LIGNE ────────────────────────────────────
-- La table existait en 001 ; on lui ajoute ce que la Phase 1 utilise.
ALTER TABLE employees ADD COLUMN code TEXT;
ALTER TABLE employees ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- ── Shifts : mouvements d'espèces ──────────────────────────────────────────
CREATE TABLE cash_movements (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  shift_id        TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('in','out','drop','payout')),
  amount_millimes INTEGER NOT NULL CHECK (amount_millimes > 0),
  reason          TEXT NOT NULL,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
) STRICT;

CREATE INDEX cash_movements_shift_idx ON cash_movements (shift_id, created_at);

-- Le shift auquel une commande est rattachée : c'est ce qui permet de dire
-- « ces 47 tickets ont été encaissés par Ahmed entre 8 h et 16 h ».
ALTER TABLE orders ADD COLUMN shift_id TEXT;
ALTER TABLE orders ADD COLUMN closed_by TEXT;
ALTER TABLE orders ADD COLUMN cancel_reason TEXT;
ALTER TABLE orders ADD COLUMN customer_name TEXT;

CREATE INDEX orders_shift_idx ON orders (shift_id);
CREATE INDEX orders_encaissees_idx ON orders (closed_at) WHERE status = 'close';

ALTER TABLE shifts ADD COLUMN cash_register_id TEXT;
ALTER TABLE shifts ADD COLUMN closing_note TEXT;
ALTER TABLE shifts ADD COLUMN opened_by TEXT;

-- ── Suivi des envois en cuisine ────────────────────────────────────────────
-- Sans cette table, une deuxième tournée réimprimerait la première : la
-- cuisine referait les plats déjà servis.
CREATE TABLE kitchen_sends (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  station_id    TEXT,
  sent_at       TEXT NOT NULL,
  print_job_id  TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX kitchen_sends_ligne_idx ON kitchen_sends (order_item_id);
CREATE INDEX kitchen_sends_commande_idx ON kitchen_sends (order_id);

-- ── Employé en poste sur le terminal ───────────────────────────────────────
INSERT OR IGNORE INTO sync_state (cle, valeur) VALUES
  ('employe_courant', ''),
  ('shift_courant', ''),
  ('derniere_impression_erreur', '');
`
