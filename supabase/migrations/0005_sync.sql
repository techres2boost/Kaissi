-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0005 · Synchronisation : curseur global et idempotence
-- ═══════════════════════════════════════════════════════════════════════════
-- RÈGLE 4 : le curseur de synchronisation est un BIGSERIAL SERVEUR.
--           JAMAIS un timestamp. Les horloges des tablettes dérivent, sont
--           réglées à la main et changent de fuseau — on perdrait des
--           événements sans jamais savoir lesquels.
-- RÈGLE 5 : index UNIQUE sur sync_mutations.event_id. Sans lui, tout
--           l'édifice anti-double-encaissement tombe.
-- ═══════════════════════════════════════════════════════════════════════════

create table kaissi.change_log (
  seq             bigint      primary key generated always as identity,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  entity_type     text        not null,
  entity_id       uuid        not null,
  op              text        not null check (op in ('insert', 'update', 'delete')),
  payload         jsonb,
  created_at      timestamptz not null default now()
);

comment on table kaissi.change_log is
  'LE curseur de synchronisation du référentiel. Un appareil resté trois '
  'semaines hors ligne redemande « tout depuis seq = N » et rattrape par pages.';

create index change_log_pull_idx on kaissi.change_log (restaurant_id, seq);
create index change_log_entite_idx on kaissi.change_log (entity_type, entity_id);

-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.sync_mutations (
  -- RÈGLE 5 : clé primaire = index UNIQUE. Le même événement renvoyé cinq
  -- fois (réseau instable, retentative) n'est comptabilisé qu'une seule fois.
  event_id        uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  device_id       uuid        not null references kaissi.devices(id) on delete cascade,
  batch_id        uuid,
  status          text        not null default 'accepte'
                  check (status in ('accepte', 'rejete', 'doublon')),
  -- Un rejet est NOTIFIÉ dans l'interface, jamais avalé en silence :
  -- le gérant doit voir « 2 opérations nécessitent votre attention ».
  reject_code     text,
  reject_message  text,
  protocol_version integer    not null default 1,
  received_at     timestamptz not null default now()
);

comment on table kaissi.sync_mutations is
  'Registre d''idempotence. La clé primaire event_id EST la garantie '
  '« jamais de double encaissement ».';

create index sync_mutations_appareil_idx on kaissi.sync_mutations (device_id, received_at desc);
create index sync_mutations_rejets_idx on kaissi.sync_mutations (restaurant_id, received_at desc)
  where status = 'rejete';

-- ───────────────────────────────────────────────────────────────────────────
-- Curseurs par appareil — reprise après coupure
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.sync_cursors (
  device_id       uuid        primary key references kaissi.devices(id) on delete cascade,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  -- Dernier change_log.seq confirmé comme reçu par l'appareil.
  last_catalog_seq bigint     not null default 0,
  -- Dernier order_events.server_seq confirmé comme reçu par l'appareil.
  last_event_seq   bigint     not null default 0,
  last_push_at    timestamptz,
  last_pull_at    timestamptz,
  updated_at      timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- Alimentation automatique du change_log pour le référentiel
-- ───────────────────────────────────────────────────────────────────────────
create or replace function kaissi.journalise_changement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ligne record;
begin
  ligne := coalesce(new, old);
  insert into kaissi.change_log (organization_id, restaurant_id, entity_type, entity_id, op, payload)
  values (
    ligne.organization_id,
    ligne.restaurant_id,
    tg_table_name,
    ligne.id,
    lower(tg_op),
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return ligne;
end;
$$;

comment on function kaissi.journalise_changement() is
  'Alimente change_log à chaque modification du référentiel. C''est ce qui '
  'permet au POS de rattraper le catalogue depuis son curseur, par pages.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'tax_rates', 'categories', 'stations', 'products', 'product_variants',
    'modifier_groups', 'modifiers', 'price_overrides', 'areas', 'tables',
    'payment_methods', 'cash_registers'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on kaissi.%I '
      'for each row execute function kaissi.journalise_changement()',
      t || '_change_log', t);
  end loop;
end
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────────────
alter table kaissi.change_log     enable row level security;
alter table kaissi.sync_mutations enable row level security;
alter table kaissi.sync_cursors   enable row level security;
alter table kaissi.change_log     force row level security;
alter table kaissi.sync_mutations force row level security;
alter table kaissi.sync_cursors   force row level security;

create policy change_log_lecture on kaissi.change_log
  for select to authenticated, kaissi_device
  using (kaissi.acces_restaurant(restaurant_id));

create policy sync_mutations_lecture on kaissi.sync_mutations
  for select to authenticated, kaissi_device
  using (kaissi.acces_restaurant(restaurant_id));

create policy sync_mutations_insertion on kaissi.sync_mutations
  for insert to kaissi_device
  with check (
    device_id = kaissi.appareil_courant()
    and kaissi.acces_restaurant(restaurant_id)
  );

create policy sync_cursors_appareil on kaissi.sync_cursors
  for all to kaissi_device
  using (device_id = kaissi.appareil_courant())
  with check (device_id = kaissi.appareil_courant());

create policy sync_cursors_lecture on kaissi.sync_cursors
  for select to authenticated
  using (kaissi.acces_restaurant(restaurant_id));

-- Le change_log est en insertion seule : c'est un journal, pas un état.
revoke update, delete, truncate on kaissi.change_log from public;
revoke update, delete, truncate on kaissi.change_log from authenticated, anon, kaissi_device;

grant select on kaissi.change_log to authenticated, kaissi_device;
grant select, insert on kaissi.sync_mutations to authenticated, kaissi_device;
grant select, insert, update on kaissi.sync_cursors to authenticated, kaissi_device;
grant usage on all sequences in schema kaissi to authenticated, kaissi_device;
