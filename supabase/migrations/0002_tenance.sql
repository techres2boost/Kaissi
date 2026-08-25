-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0002 · Tenance : organisations, restaurants, utilisateurs, appareils
-- ═══════════════════════════════════════════════════════════════════════════
-- RÈGLE 3 : `organization_id` ET `restaurant_id` sur presque chaque table,
-- même quand c'est redondant. C'est la future clé de sharding : l'ajouter
-- après coup sur 40 tables et 500 M de lignes est un chantier de plusieurs
-- mois ; l'ajouter maintenant coûte vingt minutes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Organisations
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.organizations (
  id              uuid primary key default kaissi.uuid_v7(),
  name            text        not null check (length(btrim(name)) between 1 and 200),
  slug            text        not null unique
                  check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  country         char(2)     not null default 'TN',
  -- Devise et exposant : le TND a 3 décimales. JAMAIS codé en dur ailleurs.
  currency        char(3)     not null default 'TND',
  currency_exponent smallint  not null default 3 check (currency_exponent between 0 and 4),
  plan            text        not null default 'essai'
                  check (plan in ('essai', 'standard', 'pro', 'chaine')),
  status          text        not null default 'actif'
                  check (status in ('actif', 'suspendu', 'resilie')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column kaissi.organizations.currency_exponent is
  'Nombre de décimales de la devise. TND = 3 : 24,500 TND = 24500 millimes.';

-- ───────────────────────────────────────────────────────────────────────────
-- Établissements
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.restaurants (
  id              uuid primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  name            text        not null check (length(btrim(name)) between 1 and 200),
  slug            text        not null
                  check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  timezone        text        not null default 'Africa/Tunis',
  address         text,
  phone           text,
  -- Numérotation fiscale : attribuée CÔTÉ SERVEUR à la réconciliation.
  -- ⚠ Le format et l'obligation légale doivent être validés par un
  --   expert-comptable tunisien avant toute mise en production.
  fiscal_id       text,
  -- Configuration monétaire propre à l'établissement.
  service_rate_bp integer     not null default 0 check (service_rate_bp between 0 and 10000),
  service_taxable boolean     not null default false,
  stamp_duty_millimes bigint  not null default 0 check (stamp_duty_millimes >= 0),
  status          text        not null default 'actif'
                  check (status in ('actif', 'ferme', 'suspendu')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug)
);

create index restaurants_org_idx on kaissi.restaurants (organization_id);

comment on column kaissi.restaurants.service_rate_bp is
  'Frais de service en points de base : 10 % = 1000. JAMAIS un flottant.';

-- ───────────────────────────────────────────────────────────────────────────
-- Utilisateurs (humains) — miroir applicatif d'auth.users
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  email           text        not null,
  full_name       text        not null default '',
  phone           text,
  -- Hachage Argon2id du code PIN, synchronisé vers l'appareil pour une
  -- validation HORS LIGNE. Ce n'est jamais le mot de passe du compte.
  pin_hash        text,
  status          text        not null default 'actif'
                  check (status in ('actif', 'suspendu', 'parti')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index users_org_idx on kaissi.users (organization_id);
create unique index users_email_org_idx on kaissi.users (organization_id, lower(email));

-- ───────────────────────────────────────────────────────────────────────────
-- Appartenances — un utilisateur peut avoir des rôles ≠ par établissement
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.memberships (
  id              uuid primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  user_id         uuid        not null references kaissi.users(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  role            text        not null
                  check (role in ('admin', 'gerant', 'caissier', 'serveur', 'cuisine')),
  -- Surcharges fines par-dessus le rôle : {"remise_max_bp": 1000, ...}
  permissions     jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (user_id, restaurant_id)
);

create index memberships_user_idx on kaissi.memberships (user_id) where revoked_at is null;
create index memberships_restaurant_idx on kaissi.memberships (restaurant_id) where revoked_at is null;

-- ───────────────────────────────────────────────────────────────────────────
-- Appareils — l'identité qui parle au /sync
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.devices (
  id              uuid primary key,   -- UUIDv7 attribué à l'APPAIRAGE
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  label           text        not null check (length(btrim(label)) between 1 and 100),
  type            text        not null default 'pos'
                  check (type in ('pos', 'kds', 'printer', 'backoffice')),
  -- Préfixe de numérotation des tickets : « P2 » → P2-000431.
  -- Évite toute collision de numéro entre deux appareils hors ligne.
  ticket_prefix   text        not null check (ticket_prefix ~ '^[A-Z0-9]{1,4}$'),
  -- Jamais le jeton en clair : uniquement son empreinte.
  token_hash      text        not null,
  app_version     text,
  protocol_version integer    not null default 1,
  last_seen_at    timestamptz,
  last_sync_seq   bigint      not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (restaurant_id, ticket_prefix)
);

create index devices_restaurant_idx on kaissi.devices (restaurant_id) where revoked_at is null;
create unique index devices_token_idx on kaissi.devices (token_hash);

comment on table kaissi.devices is
  'Un appareil n''est PAS un utilisateur. Son jeton est long, révocable à '
  'distance, et authentifie les appels de synchronisation — pas l''employé.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Fonctions d'accès — le socle de TOUTES les politiques RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER + search_path vide : indispensable pour que la politique
-- de `memberships` puisse interroger `memberships` sans récursion infinie.

create or replace function kaissi.acces_restaurant(cible uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    cible is not null
    and (
      -- Chemin APPAREIL : le jeton est lié à un et un seul établissement.
      exists (
        select 1
        from kaissi.devices d
        where d.id = kaissi.appareil_courant()
          and d.restaurant_id = cible
          and d.revoked_at is null
      )
      -- Chemin HUMAIN : appartenance active à cet établissement.
      or exists (
        select 1
        from kaissi.memberships m
        where m.user_id = auth.uid()
          and m.restaurant_id = cible
          and m.revoked_at is null
      )
    );
$$;

create or replace function kaissi.acces_organisation(cible uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    cible is not null
    and (
      exists (
        select 1
        from kaissi.devices d
        where d.id = kaissi.appareil_courant()
          and d.organization_id = cible
          and d.revoked_at is null
      )
      or exists (
        select 1
        from kaissi.memberships m
        where m.user_id = auth.uid()
          and m.organization_id = cible
          and m.revoked_at is null
      )
    );
$$;

-- L'écriture du référentiel (catalogue, tarifs, employés) est réservée aux
-- humains d'encadrement : un appareil ne modifie JAMAIS le référentiel.
create or replace function kaissi.est_gestionnaire(cible uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from kaissi.memberships m
    where m.user_id = auth.uid()
      and m.restaurant_id = cible
      and m.revoked_at is null
      and m.role in ('admin', 'gerant')
  );
$$;

comment on function kaissi.acces_restaurant(uuid) is
  'Vrai si l''appelant (appareil OU humain) a accès à cet établissement. '
  'Le filtrage applicatif ne remplace jamais RLS : c''est la dernière ligne '
  'de défense contre une fuite entre deux restaurants concurrents.';

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — activée dès la création, jamais « plus tard »
-- ═══════════════════════════════════════════════════════════════════════════
alter table kaissi.organizations enable row level security;
alter table kaissi.restaurants   enable row level security;
alter table kaissi.users         enable row level security;
alter table kaissi.memberships   enable row level security;
alter table kaissi.devices       enable row level security;

alter table kaissi.organizations force row level security;
alter table kaissi.restaurants   force row level security;
alter table kaissi.users         force row level security;
alter table kaissi.memberships   force row level security;
alter table kaissi.devices       force row level security;

create policy org_lecture on kaissi.organizations
  for select to authenticated, kaissi_device
  using (kaissi.acces_organisation(id));

create policy resto_lecture on kaissi.restaurants
  for select to authenticated, kaissi_device
  using (kaissi.acces_restaurant(id));

create policy resto_ecriture on kaissi.restaurants
  for update to authenticated
  using (kaissi.est_gestionnaire(id))
  with check (kaissi.est_gestionnaire(id));

create policy users_lecture on kaissi.users
  for select to authenticated, kaissi_device
  using (id = auth.uid() or kaissi.acces_organisation(organization_id));

create policy users_ecriture_soi on kaissi.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy memberships_lecture on kaissi.memberships
  for select to authenticated, kaissi_device
  using (user_id = auth.uid() or kaissi.acces_restaurant(restaurant_id));

create policy memberships_gestion on kaissi.memberships
  for all to authenticated
  using (kaissi.est_gestionnaire(restaurant_id))
  with check (kaissi.est_gestionnaire(restaurant_id));

create policy devices_lecture on kaissi.devices
  for select to authenticated, kaissi_device
  using (kaissi.acces_restaurant(restaurant_id));

create policy devices_gestion on kaissi.devices
  for all to authenticated
  using (kaissi.est_gestionnaire(restaurant_id))
  with check (kaissi.est_gestionnaire(restaurant_id));

-- Un appareil met à jour SON propre battement de cœur, rien d'autre.
create policy devices_battement on kaissi.devices
  for update to kaissi_device
  using (id = kaissi.appareil_courant())
  with check (id = kaissi.appareil_courant());

-- ───────────────────────────────────────────────────────────────────────────
create trigger organizations_updated_at before update on kaissi.organizations
  for each row execute function kaissi.touche_updated_at();
create trigger restaurants_updated_at before update on kaissi.restaurants
  for each row execute function kaissi.touche_updated_at();
create trigger users_updated_at before update on kaissi.users
  for each row execute function kaissi.touche_updated_at();
create trigger memberships_updated_at before update on kaissi.memberships
  for each row execute function kaissi.touche_updated_at();
create trigger devices_updated_at before update on kaissi.devices
  for each row execute function kaissi.touche_updated_at();

grant select on kaissi.organizations, kaissi.restaurants, kaissi.users,
                kaissi.memberships, kaissi.devices
  to authenticated, kaissi_device;
grant insert, update, delete on kaissi.restaurants, kaissi.users,
                                 kaissi.memberships, kaissi.devices
  to authenticated;
grant update on kaissi.devices to kaissi_device;
