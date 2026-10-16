/**
 * 016 — Les remboursements, projetés comme les paiements.
 *
 * Une PROJECTION, comme `payments` : reconstruite depuis le journal à chaque
 * reprojection de la commande, jamais écrite à la main. La source de vérité
 * reste l'événement `refund.recorded`.
 *
 * `shift_id` vient de l'ÉVÉNEMENT, pas du contexte de projection : l'argent
 * sort du tiroir ouvert au moment du remboursement, et une reprojection
 * faite demain, ou depuis une autre caisse, ne doit pas le changer de
 * service. C'est ce qui permet à la clôture de déduire ce qui a été rendu
 * en espèces.
 *
 * Additive : aucune colonne existante n'est touchée.
 */
export const SQL_016 = `
CREATE TABLE refunds (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL,
  organization_id  TEXT NOT NULL,
  restaurant_id    TEXT NOT NULL,
  payment_id       TEXT NOT NULL,
  type             TEXT NOT NULL,
  amount_millimes  INTEGER NOT NULL CHECK (amount_millimes >= 0),
  reason           TEXT NOT NULL,
  items            TEXT NOT NULL DEFAULT '[]',
  shift_id         TEXT,
  created_by       TEXT,
  approved_by      TEXT,
  created_at       TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX refunds_commande_idx ON refunds (order_id);
CREATE INDEX refunds_shift_idx ON refunds (shift_id);
`
