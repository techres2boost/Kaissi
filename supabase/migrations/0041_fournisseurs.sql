-- ═══════════════════════════════════════════════════════════════════════════
-- 0041 — Les FOURNISSEURS deviennent des fiches, sans cesser d'être facultatifs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La migration 0026 avait posé `stock_movements.supplier`, un TEXTE libre, et
-- avait écrit noir sur blanc pourquoi ce n'était pas une table :
--
--   « Une table imposerait de créer un fournisseur avant de saisir une
--     réception — donc un formulaire de plus au moment où quelqu'un décharge
--     des cageots. Le jour où les achats deviennent un sujet, cette colonne
--     se remplacera par une clé étrangère, et les valeurs déjà saisies
--     serviront à créer les lignes. »
--
-- Ce jour est venu, avec le module « inventaire avancé ». Mais la raison de
-- 2026 reste vraie, et cette migration ne la contredit pas :
--
-- ── La colonne TEXTE reste, et elle reste le chemin par défaut ─────────────
--
-- `supplier` n'est ni supprimée, ni migrée, ni rendue obligatoire. Elle porte
-- ce qui a été saisi, et continue de le porter. `supplier_id` s'ajoute À CÔTÉ,
-- et se remplit quand le nom tapé correspond à une fiche existante.
--
-- Trois conséquences, toutes voulues :
--
--   • celui qui décharge des cageots tape un nom et valide, comme avant. Rien
--     ne l'oblige à créer une fiche, et rien ne l'empêche de nommer un
--     fournisseur qui n'existe pas encore ;
--   • l'historique déjà saisi ne bouge pas. Le rattacher automatiquement
--     exigerait de décider que « Sfax Primeurs » et « sfax primeur » sont le
--     même fournisseur — une décision qui appartient au gérant, pas à une
--     migration qui s'exécute une nuit ;
--   • et un établissement qui n'a pas le module garde exactement l'écran
--     qu'il avait. Le module AJOUTE, il ne retire rien.
--
-- ── Ce que ces fiches ne font PAS ─────────────────────────────────────────
--
-- Elles ne descendent pas à la caisse. `suppliers` n'entre pas dans
-- `TABLES_MIROIR` et n'est pas journalisée dans `change_log` : une tablette
-- n'enregistre aucune réception, ne consulte aucun fournisseur, et lui
-- envoyer ces lignes ne ferait que grossir sa base pour rien.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists kaissi.suppliers (
  id              uuid        primary key default kaissi.uuid_v7(),
  -- RÈGLE 3 : les deux identifiants de tenance, même redondants.
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,

  name            text        not null check (length(btrim(name)) between 1 and 120),
  /** Personne à joindre — « Monsieur Slim », « le commercial ». */
  contact         text        check (contact is null or length(btrim(contact)) <= 120),
  phone           text        check (phone is null or length(btrim(phone)) <= 40),
  note            text,

  -- ARCHIVÉ, jamais supprimé : ses réceptions restent dans l'historique, et
  -- une fiche effacée les rendrait illisibles. Même convention que les
  -- produits, les taux et les modes de paiement.
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table kaissi.suppliers is
  'Fiches fournisseurs — module « inventaire avancé ». FACULTATIVES : une '
  'réception se saisit toujours avec un nom libre. Ne descendent pas à la '
  'caisse : une tablette n''enregistre aucune réception.';

-- Deux fiches ACTIVES du même nom dans le même établissement sont une faute
-- de saisie, pas une intention. L'index est partiel : archiver puis recréer
-- sous le même nom reste possible, et c'est un geste légitime.
create unique index if not exists suppliers_nom_actif_idx
  on kaissi.suppliers (restaurant_id, lower(btrim(name)))
  where archived_at is null;

create index if not exists suppliers_restaurant_idx
  on kaissi.suppliers (restaurant_id, name);

-- RLS complète : lecture par les membres, écriture par l'encadrement.
select kaissi.protege_referentiel('suppliers');

create trigger suppliers_updated_at
  before update on kaissi.suppliers
  for each row execute function kaissi.touche_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- Le RATTACHEMENT d'une réception à une fiche
-- ───────────────────────────────────────────────────────────────────────────
-- `on delete set null` et non `restrict` : une fiche ne se supprime pas
-- depuis l'interface, elle s'archive. Mais la suppression d'un établissement
-- (migration 0038) efface `suppliers` ET `stock_movements` en cascade — un
-- `restrict` entre les deux ferait échouer cette suppression sur une
-- contrainte que personne ne saurait rattacher à sa cause.
--
-- Et si la fiche disparaissait tout de même, `supplier` porte toujours le nom
-- saisi : l'historique reste lisible, simplement sans lien.
alter table kaissi.stock_movements
  add column if not exists supplier_id uuid
  references kaissi.suppliers(id) on delete set null;

comment on column kaissi.stock_movements.supplier_id is
  'Fiche fournisseur, quand le nom saisi correspondait à une fiche existante. '
  'NULL est le cas normal : la colonne `supplier` porte le nom libre, et c''est '
  'elle qui fait foi pour l''affichage.';

create index if not exists stock_movements_fournisseur_idx
  on kaissi.stock_movements (supplier_id, created_at desc)
  where supplier_id is not null;
