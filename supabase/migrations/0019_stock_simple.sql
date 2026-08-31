-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0019 · Stock SIMPLE, dérivé d'un comptage de référence
-- ═══════════════════════════════════════════════════════════════════════════
-- Le coût d'achat (`products.cost_per_unit`) existe depuis la 0003. Il ne
-- manquait que les quantités.
--
-- ── Pourquoi un stock DÉRIVÉ, et non un compteur qu'on décrémente ─────────
--
-- La tentation est un `qty_on_hand` maintenu par un déclencheur sur
-- `order_items`. Elle ne résiste pas à la réalité de ce dépôt : la
-- reprojection serveur fait `DELETE` puis `INSERT` de TOUTES les lignes
-- d'une commande à chaque nouvel événement la concernant. Un compteur muté
-- par déclencheur devrait alors défaire exactement ce qu'il avait fait, y
-- compris quand la commande est passée « annulée » ENTRE les deux — ce que
-- le déclencheur ne peut pas savoir. Le compteur dériverait en silence, et
-- un stock faux est pire qu'un stock absent.
--
-- On calcule donc le stock à la lecture :
--
--     stock = quantité COMPTÉE  (à une date de référence)
--           + mouvements manuels postérieurs
--           − quantités vendues depuis cette date
--
-- C'est exact par construction, insensible aux reprojections, aux annulations
-- et aux lignes annulées. Et c'est BORNÉ : un inventaire repose la référence,
-- donc la somme ne balaie jamais tout l'historique.
--
-- ── Ce que ce stock ne fait PAS ──────────────────────────────────────────
--
-- Il ne bloque JAMAIS une vente. La règle du dépôt est explicite : refuser de
-- vendre une pizza sur une donnée périmée est le pire des deux mondes. Une
-- quantité peut donc devenir négative — et c'est une information utile, celle
-- d'une réception qu'on a oublié de saisir.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Le comptage de référence, par produit
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.stock_items (
  product_id      uuid        primary key references kaissi.products(id) on delete cascade,
  -- RÈGLE 3 : les deux identifiants de tenance, même redondants.
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  -- NUMERIC, jamais un entier : 0,25 kg de farine existe (RÈGLE 1).
  qty_reference   numeric     not null default 0,
  -- Date du comptage. Les ventes ANTÉRIEURES sont déjà dans la référence :
  -- c'est ce qui borne la somme et rend un inventaire réellement remettant
  -- les compteurs à zéro.
  counted_at      timestamptz not null default now(),
  -- Seuil d'alerte. NULL = aucune alerte pour ce produit.
  min_qty         numeric     check (min_qty is null or min_qty >= 0),
  updated_at      timestamptz not null default now()
);

comment on table kaissi.stock_items is
  'Comptage de référence du stock, par produit. Le stock RÉEL se lit dans la '
  'vue kaissi.stock_actuel : référence + mouvements manuels − ventes depuis '
  'counted_at. Ne bloque jamais une vente.';
comment on column kaissi.stock_items.counted_at is
  'Date du dernier comptage. Les ventes antérieures sont réputées incluses '
  'dans qty_reference — c''est ce qui borne le calcul du stock actuel.';

create index stock_items_resto_idx on kaissi.stock_items (restaurant_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Les mouvements MANUELS — réceptions, pertes, corrections
-- ───────────────────────────────────────────────────────────────────────────
-- Les ventes ne figurent PAS ici : elles vivent déjà dans `order_items`, qui
-- est la source de vérité. Les dupliquer créerait deux comptes de la même
-- chose, donc un jour deux réponses différentes à la même question.
create table kaissi.stock_movements (
  id              uuid        primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  product_id      uuid        not null references kaissi.products(id) on delete cascade,
  -- Signé : +12 pour une réception, −3 pour une casse.
  qty_delta       numeric     not null check (qty_delta <> 0),
  reason          text        not null check (reason in ('reception', 'perte', 'correction')),
  note            text,
  created_by      uuid        references kaissi.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table kaissi.stock_movements is
  'Mouvements de stock MANUELS uniquement (réception, perte, correction). '
  'Les ventes ne sont pas dupliquées ici : order_items fait foi.';

create index stock_movements_produit_idx
  on kaissi.stock_movements (product_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- Le stock réel
-- ───────────────────────────────────────────────────────────────────────────
-- `security_invoker` : la vue s'exécute avec les droits de l'APPELANT, donc
-- les politiques RLS des tables sous-jacentes s'appliquent. Sans cela, une
-- vue appartenant au propriétaire du schéma contournerait RLS et rendrait le
-- stock de tous les restaurants.
create view kaissi.stock_actuel
with (security_invoker = true)
as
select
  s.product_id,
  s.organization_id,
  s.restaurant_id,
  s.qty_reference,
  s.counted_at,
  s.min_qty,
  coalesce(m.total, 0)  as qty_mouvements,
  coalesce(v.total, 0)  as qty_vendue,
  s.qty_reference + coalesce(m.total, 0) - coalesce(v.total, 0) as qty_on_hand
from kaissi.stock_items s
left join lateral (
  select sum(mv.qty_delta) as total
  from kaissi.stock_movements mv
  where mv.product_id = s.product_id
    and mv.created_at >= s.counted_at
) m on true
left join lateral (
  select sum(oi.qty) as total
  from kaissi.order_items oi
  join kaissi.orders o on o.id = oi.order_id
  where oi.product_id = s.product_id
    -- Une ligne annulée n'a jamais quitté le stock.
    and oi.voided_at is null
    -- Une commande annulée non plus.
    and o.status <> 'annulee'
    -- `opened_at` vient de l'ÉVÉNEMENT : il est stable d'une reprojection à
    -- l'autre, contrairement à order_items.created_at qui, lui, est réécrit.
    and o.opened_at >= s.counted_at
) v on true;

comment on view kaissi.stock_actuel is
  'Stock réel par produit : comptage de référence + mouvements manuels − '
  'ventes non annulées depuis le comptage. Calculé à la lecture, donc '
  'insensible aux reprojections.';

-- Aucun index à créer ici : `order_items_produit_idx (restaurant_id,
-- product_id)` existe depuis la 0004 et sert déjà ce chemin de lecture.

-- ───────────────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────────────
-- Jeu standard : lecture pour les membres et les appareils, insertion bornée
-- à l'établissement, correction réservée à l'encadrement.
select kaissi.protege_transactionnel('stock_items');
select kaissi.protege_transactionnel('stock_movements');

-- Le stock se corrige depuis le back-office par un gérant : la politique
-- « correction » du jeu standard (est_gestionnaire) couvre déjà l'UPDATE de
-- stock_items. Il manque la suppression d'un suivi de stock — désactiver le
-- suivi d'un produit — qui est aussi une opération d'encadrement.
create policy stock_items_retrait on kaissi.stock_items
  for delete to authenticated
  using (kaissi.est_gestionnaire(restaurant_id));
grant delete on kaissi.stock_items to authenticated;

create trigger stock_items_updated_at
  before update on kaissi.stock_items
  for each row execute function kaissi.touche_updated_at();

-- La vue hérite des politiques de ses tables (security_invoker), mais le
-- privilège de SELECT doit être accordé explicitement.
grant select on kaissi.stock_actuel to authenticated, kaissi_device;
