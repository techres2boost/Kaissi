/**
 * Migration locale 001 — schéma initial.
 *
 * MIROIR du schéma Postgres (`supabase/migrations/`), réduit à ce dont le
 * terminal a besoin pour encaisser hors ligne. Les différences volontaires :
 *
 *   • `INTEGER` au lieu de `BIGINT` : en SQLite, INTEGER est déjà un entier
 *     signé 64 bits. Les montants en millimes y tiennent sans discussion.
 *   • pas de types `uuid` ni `jsonb` : SQLite stocke du TEXT. Les UUIDv7
 *     restent triables lexicographiquement, donc l'ordre est préservé.
 *   • pas de RLS : la base locale ne contient QUE l'établissement de
 *     l'appareil. L'isolation se joue au moment de l'appairage.
 *   • une table `outbox` en plus : elle n'existe pas côté serveur.
 *
 * Le SQL est un littéral TypeScript, PAS un fichier lu au démarrage :
 * il doit être EMPAQUETÉ dans l'APK. Une migration qu'il faut télécharger
 * est une migration qui ne s'applique pas en mode avion.
 */

export const SQL_001 = `
-- ── Référentiel : copie locale du catalogue ────────────────────────────────

CREATE TABLE restaurants (
  id                     TEXT PRIMARY KEY,
  organization_id        TEXT NOT NULL,
  name                   TEXT NOT NULL,
  timezone               TEXT NOT NULL DEFAULT 'Africa/Tunis',
  currency               TEXT NOT NULL DEFAULT 'TND',
  currency_exponent      INTEGER NOT NULL DEFAULT 3,
  service_rate_bp        INTEGER NOT NULL DEFAULT 0,
  service_taxable        INTEGER NOT NULL DEFAULT 0,
  stamp_duty_millimes    INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL
) STRICT;

CREATE TABLE tax_rates (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  name            TEXT NOT NULL,
  -- Points de base ENTIERS : 19 % = 1900. Jamais un REAL.
  rate_bp         INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  is_included     INTEGER NOT NULL DEFAULT 1 CHECK (is_included IN (0, 1)),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  archived_at     TEXT
) STRICT;

CREATE TABLE categories (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  name            TEXT NOT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  color           TEXT,
  archived_at     TEXT
) STRICT;

CREATE TABLE stations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  name            TEXT NOT NULL,
  printer_host    TEXT,
  printer_port    INTEGER NOT NULL DEFAULT 9100,
  position        INTEGER NOT NULL DEFAULT 0,
  archived_at     TEXT
) STRICT;

CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL,
  restaurant_id       TEXT NOT NULL,
  category_id         TEXT,
  station_id          TEXT,
  tax_rate_id         TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  -- MILLIMES, entier. 14,500 TND = 14500.
  base_price_millimes INTEGER NOT NULL CHECK (base_price_millimes >= 0),
  color               TEXT,
  position            INTEGER NOT NULL DEFAULT 0,
  is_available        INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  track_stock         INTEGER NOT NULL DEFAULT 0 CHECK (track_stock IN (0, 1)),
  archived_at         TEXT,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id)
) STRICT;

CREATE INDEX products_categorie_idx ON products (restaurant_id, category_id, position);

CREATE TABLE product_variants (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL,
  restaurant_id        TEXT NOT NULL,
  product_id           TEXT NOT NULL,
  name                 TEXT NOT NULL,
  -- Peut être NÉGATIF (petite portion moins chère) : aucune contrainte >= 0.
  price_delta_millimes INTEGER NOT NULL DEFAULT 0,
  position             INTEGER NOT NULL DEFAULT 0,
  is_available         INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  archived_at          TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id)
) STRICT;

CREATE INDEX product_variants_produit_idx ON product_variants (product_id, position);

CREATE TABLE modifier_groups (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  name            TEXT NOT NULL,
  min_select      INTEGER NOT NULL DEFAULT 0,
  max_select      INTEGER NOT NULL DEFAULT 1,
  is_required     INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  position        INTEGER NOT NULL DEFAULT 0,
  archived_at     TEXT
) STRICT;

CREATE TABLE modifiers (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL,
  restaurant_id        TEXT NOT NULL,
  modifier_group_id    TEXT NOT NULL,
  name                 TEXT NOT NULL,
  price_delta_millimes INTEGER NOT NULL DEFAULT 0,
  position             INTEGER NOT NULL DEFAULT 0,
  is_available         INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  archived_at          TEXT,
  FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(id)
) STRICT;

CREATE TABLE product_modifiers (
  product_id        TEXT NOT NULL,
  modifier_group_id TEXT NOT NULL,
  restaurant_id     TEXT NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, modifier_group_id)
) STRICT;

CREATE TABLE areas (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  name            TEXT NOT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  archived_at     TEXT
) STRICT;

CREATE TABLE tables (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  area_id         TEXT,
  label           TEXT NOT NULL,
  seats           INTEGER NOT NULL DEFAULT 2,
  archived_at     TEXT
) STRICT;

CREATE TABLE payment_methods (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('cash','card','online','other')),
  opens_drawer    INTEGER NOT NULL DEFAULT 0 CHECK (opens_drawer IN (0, 1)),
  position        INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  archived_at     TEXT
) STRICT;

CREATE TABLE employees (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  restaurant_id   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL,
  -- Hachage Argon2id, validé HORS LIGNE. Jamais le PIN en clair.
  pin_hash        TEXT,
  permissions     TEXT NOT NULL DEFAULT '{}',
  archived_at     TEXT
) STRICT;

-- ── Journal d'événements local — MÊME modèle que le serveur ────────────────
-- APPEND ONLY : trois déclencheurs interdisent UPDATE et DELETE, exactement
-- comme le REVOKE côté Postgres.

CREATE TABLE order_events (
  event_id         TEXT PRIMARY KEY,      -- UUIDv7 généré ICI, sur l'appareil
  order_id         TEXT NOT NULL,
  organization_id  TEXT NOT NULL,
  restaurant_id    TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  seq_device       INTEGER NOT NULL,
  -- NULL tant que le serveur ne l'a pas attribué. C'est le seul ordre global.
  server_seq       INTEGER,
  type             TEXT NOT NULL,
  payload          TEXT NOT NULL DEFAULT '{}',
  actor_user_id    TEXT,
  client_ts        TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE UNIQUE INDEX order_events_appareil_seq_idx ON order_events (device_id, seq_device);
CREATE INDEX order_events_commande_idx ON order_events (order_id, server_seq, client_ts);
CREATE INDEX order_events_non_pousses_idx ON order_events (server_seq) WHERE server_seq IS NULL;

CREATE TRIGGER order_events_pas_update
BEFORE UPDATE OF event_id, order_id, type, payload, client_ts, seq_device ON order_events
BEGIN
  SELECT RAISE(ABORT, 'order_events est en insertion seule : une correction est un NOUVEL evenement');
END;

CREATE TRIGGER order_events_pas_delete
BEFORE DELETE ON order_events
BEGIN
  SELECT RAISE(ABORT, 'order_events est en insertion seule : aucune suppression');
END;

-- ── Projections locales — reconstruites par packages/domain ────────────────

CREATE TABLE orders (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  restaurant_id         TEXT NOT NULL,
  table_id              TEXT,
  device_id             TEXT NOT NULL,
  opened_by             TEXT,
  type                  TEXT NOT NULL DEFAULT 'dine_in',
  status                TEXT NOT NULL DEFAULT 'ouverte'
                        CHECK (status IN ('ouverte','envoyee','close','annulee')),
  covers                INTEGER,
  ticket_number         TEXT,
  subtotal_millimes     INTEGER NOT NULL DEFAULT 0,
  discount_millimes     INTEGER NOT NULL DEFAULT 0,
  tax_millimes          INTEGER NOT NULL DEFAULT 0,
  service_millimes      INTEGER NOT NULL DEFAULT 0,
  stamp_duty_millimes   INTEGER NOT NULL DEFAULT 0,
  total_millimes        INTEGER NOT NULL DEFAULT 0,
  paid_millimes         INTEGER NOT NULL DEFAULT 0,
  tax_breakdown         TEXT NOT NULL DEFAULT '[]',
  exceptions            TEXT NOT NULL DEFAULT '[]',
  opened_at             TEXT NOT NULL,
  sent_at               TEXT,
  closed_at             TEXT,
  cancelled_at          TEXT,
  last_event_seq        INTEGER NOT NULL DEFAULT 0,
  event_count           INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL
) STRICT;

CREATE INDEX orders_actives_idx ON orders (status, opened_at)
  WHERE status IN ('ouverte', 'envoyee');
CREATE INDEX orders_table_idx ON orders (table_id) WHERE status IN ('ouverte','envoyee');

CREATE TABLE order_items (
  id                             TEXT PRIMARY KEY,
  order_id                       TEXT NOT NULL,
  organization_id                TEXT NOT NULL,
  restaurant_id                  TEXT NOT NULL,
  product_id                     TEXT,
  variant_id                     TEXT,
  station_id                     TEXT,
  tax_rate_id                    TEXT,
  designation                    TEXT NOT NULL,
  qty                            INTEGER NOT NULL,
  unit_price_millimes            INTEGER NOT NULL,
  modifiers_millimes             INTEGER NOT NULL DEFAULT 0,
  line_gross_millimes            INTEGER NOT NULL,
  line_discount_millimes         INTEGER NOT NULL DEFAULT 0,
  global_discount_share_millimes INTEGER NOT NULL DEFAULT 0,
  line_total_millimes            INTEGER NOT NULL,
  line_tax_millimes              INTEGER NOT NULL DEFAULT 0,
  modifiers                      TEXT NOT NULL DEFAULT '[]',
  note                           TEXT,
  position                       INTEGER NOT NULL DEFAULT 0,
  voided_at                      TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX order_items_commande_idx ON order_items (order_id, position);

CREATE TABLE payments (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL,
  organization_id   TEXT NOT NULL,
  restaurant_id     TEXT NOT NULL,
  method_id         TEXT,
  type              TEXT NOT NULL,
  amount_millimes   INTEGER NOT NULL,
  received_millimes INTEGER,
  change_millimes   INTEGER NOT NULL DEFAULT 0,
  reference         TEXT,
  shift_id          TEXT,
  voided_at         TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX payments_commande_idx ON payments (order_id);

CREATE TABLE shifts (
  id                     TEXT PRIMARY KEY,
  organization_id        TEXT NOT NULL,
  restaurant_id          TEXT NOT NULL,
  device_id              TEXT,
  employee_id            TEXT,
  opened_at              TEXT NOT NULL,
  opening_float_millimes INTEGER NOT NULL DEFAULT 0,
  closed_at              TEXT,
  counted_millimes       INTEGER,
  expected_millimes      INTEGER,
  -- L'écart de caisse PEUT être négatif : c'est tout son intérêt.
  variance_millimes      INTEGER
) STRICT;

CREATE INDEX shifts_ouverts_idx ON shifts (opened_at) WHERE closed_at IS NULL;

-- ── Outbox — n'existe QUE localement ───────────────────────────────────────
-- L'appareil ne vide sa outbox que sur ACCUSÉ DE RÉCEPTION du serveur.
-- Tant qu'un événement est ici, il n'est pas perdu, même si l'app redémarre.

CREATE TABLE outbox (
  event_id        TEXT PRIMARY KEY,
  restaurant_id   TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'order_event',
  payload         TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  -- Un rejet est CONSERVÉ et remonté au gérant, jamais avalé en silence.
  last_error      TEXT,
  reject_code     TEXT,
  status          TEXT NOT NULL DEFAULT 'en_attente'
                  CHECK (status IN ('en_attente','en_cours','rejete')),
  next_retry_at   TEXT,
  created_at      TEXT NOT NULL
) STRICT;

CREATE INDEX outbox_a_pousser_idx ON outbox (status, created_at);

-- ── Curseurs et état de synchronisation ────────────────────────────────────

CREATE TABLE sync_state (
  cle    TEXT PRIMARY KEY,
  valeur TEXT
) STRICT;

-- Compteur d'événements local, monotone, jamais réutilisé.
INSERT INTO sync_state (cle, valeur) VALUES
  ('seq_device',        '0'),
  ('last_catalog_seq',  '0'),
  ('last_event_seq',    '0'),
  ('protocol_version',  '1'),
  ('device_id',         ''),
  ('restaurant_id',     ''),
  ('organization_id',   ''),
  ('ticket_prefix',     ''),
  ('ticket_counter',    '0'),
  ('last_sync_at',      '');

-- ── File d'impression — persistante, avec retentatives ─────────────────────
-- Un KOT non imprimé = un plat non préparé. La file survit au redémarrage.

CREATE TABLE print_queue (
  id              TEXT PRIMARY KEY,
  restaurant_id   TEXT NOT NULL,
  order_id        TEXT,
  station_id      TEXT,
  kind            TEXT NOT NULL CHECK (kind IN ('kot','ticket','rapport','tiroir')),
  -- Charge ESC/POS déjà rendue, en base64 : le rendu ne dépend pas du réseau.
  payload_b64     TEXT NOT NULL,
  target_host     TEXT,
  target_port     INTEGER NOT NULL DEFAULT 9100,
  status          TEXT NOT NULL DEFAULT 'en_attente'
                  CHECK (status IN ('en_attente','en_cours','imprime','echec')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  printed_at      TEXT
) STRICT;

CREATE INDEX print_queue_a_faire_idx ON print_queue (status, created_at);
`
