/**
 * 018 — Pointeuse (Postgres 0048).
 *
 * Un pointage : l'arrivée, puis la sortie, d'un employé, saisies au PIN sur
 * CETTE caisse. Il remonte comme un service de caisse : `pushed_at` nul =
 * à envoyer. Pointer la sortie le remet à nul, et le même pointage repart,
 * enrichi.
 *
 * Additive : une table de plus, rien que l'ancienne version écrive.
 */
export const SQL_018 = `
CREATE TABLE time_entries (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  restaurant_id    TEXT NOT NULL,
  employee_id      TEXT,
  device_id        TEXT NOT NULL,
  clock_in_at      TEXT NOT NULL,
  clock_out_at     TEXT,
  pushed_at        TEXT
) STRICT;
CREATE INDEX time_entries_employe_idx ON time_entries (employee_id, clock_in_at);
CREATE INDEX time_entries_a_pousser_idx ON time_entries (clock_in_at) WHERE pushed_at IS NULL;
`
