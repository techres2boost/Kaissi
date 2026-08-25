-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0003 · Taxes et catalogue
-- ═══════════════════════════════════════════════════════════════════════════
-- RÈGLE 1 : tout montant est un BIGINT de millimes, colonne suffixée
-- `_millimes`. Les taux sont des ENTIERS en points de base (19 % = 1900).
-- Aucun flottant pour de l'argent, nulle part. Les coûts unitaires — et eux
-- seuls — sont en NUMERIC(18,6) : un gramme de mozzarella coûte moins d'un
-- millime, l'arrondi ne se fait qu'au total.
-- ═══════════════════════════════════════════════════════════════════════════

create table kaissi.tax_rates (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 60),
  rate_bp         integer     not null check (rate_bp between 0 and 10000),
  is_included     boolean     not null default true,
  is_default      boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

comment on column kaissi.tax_rates.rate_bp is
  'Taux en POINTS DE BASE entiers : 19 % = 1900, 13 % = 1300, 7 % = 700. '
  'Un taux stocké en flottant réintroduit le problème par la porte de derrière.';
comment on column kaissi.tax_rates.is_included is
  'true : le prix carte est TTC, la taxe en est extraite. false : prix HT.';

create index tax_rates_restaurant_idx on kaissi.tax_rates (restaurant_id) where archived_at is null;
create unique index tax_rates_defaut_idx on kaissi.tax_rates (restaurant_id)
  where is_default and archived_at is null;

-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.categories (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 100),
  position        integer     not null default 0,
  color           text        check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index categories_restaurant_idx on kaissi.categories (restaurant_id, position)
  where archived_at is null;

-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.stations (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 60),
  -- Imprimante réseau : TCP 9100, le chemin le plus fiable (cf. architecture).
  printer_host    text,
  printer_port    integer     not null default 9100 check (printer_port between 1 and 65535),
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index stations_restaurant_idx on kaissi.stations (restaurant_id) where archived_at is null;

-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.products (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  category_id     uuid        references kaissi.categories(id) on delete set null,
  station_id      uuid        references kaissi.stations(id) on delete set null,
  tax_rate_id     uuid        not null references kaissi.tax_rates(id) on delete restrict,
  name            text        not null check (length(btrim(name)) between 1 and 200),
  description     text,
  sku             text,
  base_price_millimes bigint  not null check (base_price_millimes >= 0),
  cost_per_unit   numeric(18,6) check (cost_per_unit >= 0),
  image_url       text,
  color           text        check (color ~ '^#[0-9a-fA-F]{6}$'),
  position        integer     not null default 0,
  is_available    boolean     not null default true,
  track_stock     boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

comment on column kaissi.products.base_price_millimes is
  'Prix de base en MILLIMES. 24,500 TND = 24500. Jamais 24.5.';
comment on column kaissi.products.cost_per_unit is
  'Coût unitaire — seule exception au BIGINT : NUMERIC(18,6). Le coût d''un '
  'gramme de mozzarella est inférieur au millime ; l''arrondi ne se fait qu''au total.';

create index products_restaurant_idx on kaissi.products (restaurant_id, position)
  where archived_at is null;
create index products_categorie_idx on kaissi.products (restaurant_id, category_id)
  where archived_at is null and is_available;
create unique index products_sku_idx on kaissi.products (restaurant_id, sku)
  where sku is not null and archived_at is null;

-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.product_variants (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  product_id      uuid        not null references kaissi.products(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 100),
  -- Un delta PEUT être négatif (petite taille moins chère) : pas de CHECK >= 0.
  price_delta_millimes bigint not null default 0,
  sku             text,
  position        integer     not null default 0,
  is_available    boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index product_variants_produit_idx on kaissi.product_variants (product_id)
  where archived_at is null;

-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.modifier_groups (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 100),
  min_select      integer     not null default 0 check (min_select >= 0),
  max_select      integer     not null default 1 check (max_select >= 0),
  is_required     boolean     not null default false,
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  check (max_select = 0 or max_select >= min_select)
);

create table kaissi.modifiers (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  modifier_group_id uuid      not null references kaissi.modifier_groups(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 100),
  price_delta_millimes bigint not null default 0,
  position        integer     not null default 0,
  is_available    boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index modifiers_groupe_idx on kaissi.modifiers (modifier_group_id) where archived_at is null;

create table kaissi.product_modifiers (
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  product_id      uuid        not null references kaissi.products(id) on delete cascade,
  modifier_group_id uuid      not null references kaissi.modifier_groups(id) on delete cascade,
  position        integer     not null default 0,
  primary key (product_id, modifier_group_id)
);

-- ───────────────────────────────────────────────────────────────────────────
-- Prix par établissement — indispensable aux chaînes dès la Phase 5.
create table kaissi.price_overrides (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  product_id      uuid        not null references kaissi.products(id) on delete cascade,
  variant_id      uuid        references kaissi.product_variants(id) on delete cascade,
  price_millimes  bigint      not null check (price_millimes >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create unique index price_overrides_cible_idx
  on kaissi.price_overrides (restaurant_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where archived_at is null;

-- ───────────────────────────────────────────────────────────────────────────
-- Salle
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.areas (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 60),
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table kaissi.tables (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  area_id         uuid        references kaissi.areas(id) on delete set null,
  label           text        not null check (length(btrim(label)) between 1 and 20),
  seats           integer     not null default 2 check (seats > 0),
  position_x      integer     not null default 0,
  position_y      integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (restaurant_id, label)
);

create index tables_restaurant_idx on kaissi.tables (restaurant_id) where archived_at is null;

-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.payment_methods (
  id              uuid primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 60),
  type            text        not null check (type in ('cash', 'card', 'online', 'other')),
  opens_drawer    boolean     not null default false,
  position        integer     not null default 0,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index payment_methods_restaurant_idx on kaissi.payment_methods (restaurant_id)
  where archived_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Générateurs de politiques RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- Écrire vingt fois les mêmes quatre politiques à la main, c'est vingt
-- occasions d'en oublier une. Ces deux fonctions posent le jeu complet et
-- garantissent qu'AUCUNE table ne peut exister sans RLS.

create or replace function kaissi.protege_referentiel(nom_table text)
returns void
language plpgsql
as $$
begin
  execute format('alter table kaissi.%I enable row level security', nom_table);
  execute format('alter table kaissi.%I force row level security', nom_table);

  -- Lecture : tout membre ou appareil de l'établissement. Le POS a besoin de
  -- lire le catalogue pour le recopier dans son SQLite local.
  execute format(
    'create policy %I on kaissi.%I for select to authenticated, kaissi_device '
    'using (kaissi.acces_restaurant(restaurant_id))',
    nom_table || '_lecture', nom_table);

  -- Écriture : encadrement humain uniquement. Un APPAREIL ne modifie JAMAIS
  -- le référentiel — il le reçoit par le pull de synchronisation.
  execute format(
    'create policy %I on kaissi.%I for all to authenticated '
    'using (kaissi.est_gestionnaire(restaurant_id)) '
    'with check (kaissi.est_gestionnaire(restaurant_id))',
    nom_table || '_gestion', nom_table);

  execute format('grant select on kaissi.%I to authenticated, kaissi_device', nom_table);
  execute format('grant insert, update, delete on kaissi.%I to authenticated', nom_table);
end;
$$;

create or replace function kaissi.protege_transactionnel(nom_table text)
returns void
language plpgsql
as $$
begin
  execute format('alter table kaissi.%I enable row level security', nom_table);
  execute format('alter table kaissi.%I force row level security', nom_table);

  execute format(
    'create policy %I on kaissi.%I for select to authenticated, kaissi_device '
    'using (kaissi.acces_restaurant(restaurant_id))',
    nom_table || '_lecture', nom_table);

  -- Un appareil INSÈRE dans son propre établissement, et nulle part ailleurs.
  execute format(
    'create policy %I on kaissi.%I for insert to authenticated, kaissi_device '
    'with check (kaissi.acces_restaurant(restaurant_id))',
    nom_table || '_insertion', nom_table);

  -- La correction d'une projection est une opération d'encadrement.
  execute format(
    'create policy %I on kaissi.%I for update to authenticated '
    'using (kaissi.est_gestionnaire(restaurant_id)) '
    'with check (kaissi.est_gestionnaire(restaurant_id))',
    nom_table || '_correction', nom_table);

  execute format('grant select, insert on kaissi.%I to authenticated, kaissi_device', nom_table);
  execute format('grant update on kaissi.%I to authenticated', nom_table);
end;
$$;

comment on function kaissi.protege_referentiel(text) is
  'Active RLS + politiques standard sur une table de référentiel. '
  'Lecture : membres et appareils. Écriture : encadrement humain seulement.';

-- ───────────────────────────────────────────────────────────────────────────
-- Application aux tables de ce fichier
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'tax_rates', 'categories', 'stations', 'products', 'product_variants',
    'modifier_groups', 'modifiers', 'price_overrides', 'areas', 'tables',
    'payment_methods'
  ] loop
    perform kaissi.protege_referentiel(t);
    execute format(
      'create trigger %I before update on kaissi.%I '
      'for each row execute function kaissi.touche_updated_at()',
      t || '_updated_at', t);
  end loop;
end
$$;

-- `product_modifiers` est une table de liaison sans `updated_at`.
select kaissi.protege_referentiel('product_modifiers');
