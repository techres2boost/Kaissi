/**
 * Migration locale 009 — le carnet de clients sur la tablette.
 *
 * ── Pourquoi la caisse a besoin du carnet EN LOCAL ────────────────────────
 *
 * Parce que c'est là qu'on rattache un client à une commande : au comptoir,
 * en prenant un numéro de téléphone pour une commande à emporter. Aller
 * chercher la liste sur le serveur au moment du clic la rendrait indisponible
 * exactement quand elle sert — en plein service, réseau capricieux.
 *
 * Le carnet descend par le catalogue (Postgres 0031), avec les prix et les
 * réductions. Aucune nouvelle route, aucun nouveau flux.
 *
 * ── Ce que la tablette ne fait PAS (encore) ───────────────────────────────
 *
 * Créer une fiche hors ligne. Le protocole de synchronisation ne remonte que
 * des ÉVÉNEMENTS DE COMMANDE ; une nouvelle fiche client demanderait une
 * route de plus, donc une décision de conception, pas une colonne. Tant
 * qu'elle n'est pas prise, une fiche se crée au back-office et redescend.
 * Rattacher un client existant, en revanche, marche hors ligne : c'est un
 * événement de commande (`customer.attached`) comme un autre.
 *
 * ADDITIVE : une table, deux colonnes. Une version antérieure du POS ignore
 * ce qu'elle ne connaît pas.
 */

export const SQL_009 = `
CREATE TABLE customers (
  id              TEXT PRIMARY KEY,
  organization_id TEXT,
  restaurant_id   TEXT,
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  note            TEXT,
  archived_at     TEXT
) STRICT;

-- La recherche du comptoir se fait sur le NOM ou sur le numéro : ce sont les
-- deux seules choses qu'on a sous la main quand un client appelle.
CREATE INDEX customers_nom_idx ON customers (name) WHERE archived_at IS NULL;
CREATE INDEX customers_tel_idx ON customers (phone) WHERE archived_at IS NULL;

-- La colonne customer_name existait déjà (migration 002) ; l'identifiant
-- manquait, et
-- c'est lui qui relie la vente à la fiche. Sans lui, « Total des visites »
-- resterait à zéro pour tout le monde.
ALTER TABLE orders ADD COLUMN customer_id TEXT;
`
