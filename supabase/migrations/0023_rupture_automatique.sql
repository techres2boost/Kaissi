-- ═══════════════════════════════════════════════════════════════════════════
-- 0023 — La rupture retire le produit de la carte, automatiquement
--
-- Jusqu'ici, un produit tombé à zéro restait vendable jusqu'à ce qu'un humain
-- le retire à la main. C'était défendable — le stock ne doit jamais bloquer
-- une vente sur une donnée périmée — mais cela reportait sur le gérant un
-- geste qu'il ne fera pas en plein service. Résultat pratique : on continue
-- de vendre une pizza qu'on n'a plus, et le stock part en négatif.
--
-- La décision est déplacée, pas supprimée. C'est le SERVEUR qui bascule
-- `products.is_available`, sur la donnée fraîche du moment (la vue
-- `stock_actuel`), au moment où il projette la vente. Ce n'est donc jamais la
-- tablette qui arbitre sur un souvenir vieux de trois heures : la caisse ne
-- fait qu'appliquer un réglage de catalogue, exactement comme un changement
-- de prix, et par le même chemin — `change_log`, déjà journalisé.
--
-- Trois garde-fous, qui font toute la différence entre « utile » et
-- « ingérable » :
--
--   1. `stock_items.auto_rupture` — le gérant peut couper l'automatisme
--      produit par produit. Un plat dont on ne compte pas les ingrédients ne
--      doit pas disparaître de la carte pour une erreur d'inventaire.
--   2. `products.unavailable_reason` — on distingue « retiré à la main » de
--      « retiré parce que le stock est à zéro ». Sans cela, une réception
--      remettrait en vente un produit que le gérant avait délibérément
--      arrêté.
--   3. Le retour est automatique lui aussi : une réception qui repasse le
--      stock au-dessus de zéro remet le produit en vente — mais SEULEMENT
--      s'il en était sorti pour cause de stock.
--
-- Ce que cette migration ne change PAS : la caisse continue d'encaisser hors
-- ligne, et le stock calculé ne bloque toujours rien par lui-même. Une
-- quantité négative reste possible (une vente encaissée hors ligne arrive
-- après coup) et reste le signal qu'il manque une réception.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Pourquoi un produit est hors carte ───────────────────────────────────
alter table kaissi.products
  add column if not exists unavailable_reason text
    check (unavailable_reason is null or unavailable_reason in ('manuel', 'stock'));

comment on column kaissi.products.unavailable_reason is
  'Pourquoi ce produit est hors carte. « manuel » = décision du gérant, que '
  'l''automatisme ne défera JAMAIS. « stock » = retiré par la rupture '
  'automatique, et remis en vente dès que le stock repasse au-dessus de zéro. '
  'Null quand le produit est en vente.';

-- Les produits déjà retirés l'ont été à la main : c'était le seul geste
-- possible avant cette migration. Les marquer ainsi évite qu'une réception
-- ne les remette en vente à l'insu du gérant.
update kaissi.products
   set unavailable_reason = 'manuel'
 where is_available = false and unavailable_reason is null;

-- ── 2. L'automatisme se coupe produit par produit ───────────────────────────
alter table kaissi.stock_items
  add column if not exists auto_rupture boolean not null default true;

comment on column kaissi.stock_items.auto_rupture is
  'Retirer automatiquement ce produit de la carte quand son stock atteint '
  'zéro. À couper pour un produit dont le comptage n''est qu''indicatif : '
  'une erreur d''inventaire ne doit pas vider la carte en plein service.';

-- ── 3. La bascule ───────────────────────────────────────────────────────────
create or replace function kaissi.appliquer_rupture_auto(
  p_restaurant uuid,
  p_produits   uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  m integer := 0;
begin
  -- Sortie de carte : stock à zéro ou négatif, suivi actif, automatisme actif.
  with cible as (
    select a.product_id
      from kaissi.stock_actuel a
      join kaissi.stock_items i on i.product_id = a.product_id
     where a.restaurant_id = p_restaurant
       and i.auto_rupture
       and a.qty_on_hand <= 0
       and (p_produits is null or a.product_id = any(p_produits))
  )
  update kaissi.products p
     set is_available = false,
         unavailable_reason = 'stock',
         updated_at = now()
    from cible c
   where p.id = c.product_id
     and p.restaurant_id = p_restaurant
     and p.is_available;
  get diagnostics n = row_count;

  -- Retour en carte : le stock est repassé au-dessus de zéro, ET le produit
  -- n'en était sorti QUE pour cette raison. Un arrêt décidé par le gérant
  -- reste un arrêt.
  with cible as (
    select a.product_id
      from kaissi.stock_actuel a
     where a.restaurant_id = p_restaurant
       and a.qty_on_hand > 0
       and (p_produits is null or a.product_id = any(p_produits))
  )
  update kaissi.products p
     set is_available = true,
         unavailable_reason = null,
         updated_at = now()
    from cible c
   where p.id = c.product_id
     and p.restaurant_id = p_restaurant
     and not p.is_available
     and p.unavailable_reason = 'stock';
  get diagnostics m = row_count;

  return n + m;
end;
$$;

comment on function kaissi.appliquer_rupture_auto(uuid, uuid[]) is
  'Aligne products.is_available sur le stock calculé. Appelée par le service '
  'de synchronisation après chaque reprojection, et par le back-office après '
  'un mouvement ou un recomptage. Passer p_produits borne le travail aux '
  'produits touchés ; null balaie tout l''établissement.';

-- `security definer` sans exécution publique : seuls les rôles applicatifs
-- l'appellent, et jamais `anon`.
revoke all on function kaissi.appliquer_rupture_auto(uuid, uuid[]) from public;
grant execute on function kaissi.appliquer_rupture_auto(uuid, uuid[])
  to authenticated, kaissi_device, service_role;

-- ── 4. Alignement immédiat de l'existant ────────────────────────────────────
do $$
declare r record;
begin
  for r in select id from kaissi.restaurants loop
    perform kaissi.appliquer_rupture_auto(r.id, null);
  end loop;
end
$$;

notify pgrst, 'reload schema';
