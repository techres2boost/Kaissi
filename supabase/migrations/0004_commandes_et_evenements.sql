-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0004 · Commandes : journal d'événements + projections
-- ═══════════════════════════════════════════════════════════════════════════
-- `order_events` est la SOURCE DE VÉRITÉ, en insertion seule.
-- `orders` et `order_items` en sont des PROJECTIONS, reconstruites par
-- `packages/domain` — le même code que celui du POS.
--
-- RÈGLE 6 : immuabilité. REVOKE UPDATE/DELETE *et* déclencheur de blocage :
-- le REVOKE seul ne protège pas du propriétaire de la table.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Le journal — APPEND ONLY
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.order_events (
  -- UUIDv7 généré par l'APPAREIL : c'est la clé d'idempotence.
  event_id        uuid        primary key,
  order_id        uuid        not null,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  device_id       uuid        not null references kaissi.devices(id) on delete restrict,
  -- Compteur local monotone : ordre intra-appareil, jamais réutilisé.
  seq_device      bigint      not null check (seq_device > 0),
  -- Attribué à l'ARRIVÉE : le seul ordre global fiable. Jamais un timestamp.
  server_seq      bigint      not null generated always as identity,
  type            text        not null check (type in (
                    'order.opened', 'line.added', 'line.quantity_changed',
                    'line.voided', 'line.note_set', 'discount.applied',
                    'discount.removed', 'service.set', 'customer.attached',
                    'table.moved', 'order.sent', 'payment.recorded',
                    'payment.voided', 'order.closed', 'order.cancelled')),
  payload         jsonb       not null default '{}'::jsonb,
  actor_user_id   uuid        references kaissi.users(id) on delete set null,
  -- Horloge de l'APPAREIL : informative. Les tablettes dérivent.
  client_ts       timestamptz not null,
  -- Horloge du SERVEUR : un écart anormal avec client_ts est en soi un signal.
  server_received_at timestamptz not null default now(),
  protocol_version integer    not null default 1,
  unique (device_id, seq_device)
);

comment on table kaissi.order_events is
  'SOURCE DE VÉRITÉ des commandes, en INSERTION SEULE. Une annulation est un '
  'événement de plus, jamais un DELETE. Les événements additifs commutent : '
  'deux tablettes hors ligne sur la même table ne produisent aucun conflit.';
comment on column kaissi.order_events.server_seq is
  'Curseur de synchronisation. RÈGLE 4 : un bigserial serveur, JAMAIS un '
  'timestamp — les horloges des tablettes dérivent et sont réglées à la main.';
comment on column kaissi.order_events.event_id is
  'UUIDv7 généré par l''APPAREIL. RÈGLE 5 : la clé primaire fait office '
  'd''index unique d''idempotence — le même événement renvoyé cinq fois '
  'n''est inséré qu''une seule fois. C''est ce qui interdit le double encaissement.';

-- LE chemin du pull : le plus sollicité de tout le système.
create index order_events_pull_idx on kaissi.order_events (restaurant_id, server_seq);
create index order_events_commande_idx on kaissi.order_events (order_id, server_seq);
create index order_events_appareil_idx on kaissi.order_events (device_id, server_seq);
-- Prépare le partitionnement mensuel (Phase 8) sans migration douloureuse.
create index order_events_reception_idx on kaissi.order_events (restaurant_id, server_received_at);

-- ───────────────────────────────────────────────────────────────────────────
-- Projection : commandes
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.orders (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  table_id        uuid        references kaissi.tables(id) on delete set null,
  device_id       uuid        not null references kaissi.devices(id) on delete restrict,
  opened_by       uuid        references kaissi.users(id) on delete set null,
  closed_by       uuid        references kaissi.users(id) on delete set null,
  customer_id     uuid,
  type            text        not null default 'dine_in'
                  check (type in ('dine_in', 'takeaway', 'delivery')),
  status          text        not null default 'ouverte'
                  check (status in ('ouverte', 'envoyee', 'close', 'annulee')),
  covers          integer     check (covers is null or covers > 0),
  -- Préfixé par appareil (P2-000431) : aucune collision hors ligne possible.
  ticket_number   text,
  -- Numérotation fiscale séquentielle : attribuée CÔTÉ SERVEUR uniquement.
  fiscal_number   bigint,

  -- Totaux — tous en MILLIMES, tous recalculés par packages/domain.
  subtotal_millimes       bigint not null default 0 check (subtotal_millimes >= 0),
  discount_millimes       bigint not null default 0 check (discount_millimes >= 0),
  tax_millimes            bigint not null default 0 check (tax_millimes >= 0),
  service_millimes        bigint not null default 0 check (service_millimes >= 0),
  stamp_duty_millimes     bigint not null default 0 check (stamp_duty_millimes >= 0),
  total_millimes          bigint not null default 0 check (total_millimes >= 0),
  paid_millimes           bigint not null default 0 check (paid_millimes >= 0),
  -- Ventilation de TVA par taux, telle qu'imprimée en pied de ticket.
  tax_breakdown   jsonb       not null default '[]'::jsonb,

  opened_at       timestamptz not null,
  sent_at         timestamptz,
  closed_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  -- Dernier server_seq replié dans cette projection : détecte un retard.
  last_event_seq  bigint      not null default 0,
  event_count     integer     not null default 0,
  -- Anomalies détectées à la réduction (double clôture, événement tardif…).
  exceptions      jsonb       not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, ticket_number),
  unique (restaurant_id, fiscal_number)
);

comment on table kaissi.orders is
  'PROJECTION reconstruite depuis order_events par packages/domain. '
  'Ne jamais écrire ici sans passer par un événement.';
comment on column kaissi.orders.fiscal_number is
  'Numérotation fiscale séquentielle, attribuée CÔTÉ SERVEUR à la '
  'réconciliation. ⚠ Règles à valider par un expert-comptable tunisien.';

-- Écrans d'historique et rapports.
create index orders_historique_idx on kaissi.orders (restaurant_id, opened_at desc);
-- Index PARTIEL : l'écran principal du POS ne montre que les commandes vivantes.
create index orders_actives_idx on kaissi.orders (restaurant_id, status)
  where status in ('ouverte', 'envoyee');
create index orders_table_idx on kaissi.orders (restaurant_id, table_id)
  where status in ('ouverte', 'envoyee');
create index orders_exceptions_idx on kaissi.orders (restaurant_id)
  where jsonb_array_length(exceptions) > 0;

-- ───────────────────────────────────────────────────────────────────────────
-- Projection : lignes
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.order_items (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  order_id        uuid        not null references kaissi.orders(id) on delete cascade,
  product_id      uuid        references kaissi.products(id) on delete set null,
  variant_id      uuid        references kaissi.product_variants(id) on delete set null,
  station_id      uuid        references kaissi.stations(id) on delete set null,
  tax_rate_id     uuid        references kaissi.tax_rates(id) on delete set null,
  -- Libellé FIGÉ au moment de la vente : renommer un produit ne réécrit pas
  -- l'histoire des tickets déjà émis.
  designation     text        not null,
  qty             integer     not null check (qty >= 0),
  unit_price_millimes      bigint not null check (unit_price_millimes >= 0),
  modifiers_millimes       bigint not null default 0,
  line_gross_millimes      bigint not null check (line_gross_millimes >= 0),
  line_discount_millimes   bigint not null default 0 check (line_discount_millimes >= 0),
  global_discount_share_millimes bigint not null default 0 check (global_discount_share_millimes >= 0),
  line_total_millimes      bigint not null check (line_total_millimes >= 0),
  line_tax_millimes        bigint not null default 0 check (line_tax_millimes >= 0),
  modifiers       jsonb       not null default '[]'::jsonb,
  note            text,
  position        integer     not null default 0,
  voided_at       timestamptz,
  voided_by       uuid        references kaissi.users(id) on delete set null,
  void_reason     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index order_items_commande_idx on kaissi.order_items (order_id, position);
create index order_items_produit_idx on kaissi.order_items (restaurant_id, product_id);
create index order_items_station_idx on kaissi.order_items (restaurant_id, station_id)
  where voided_at is null;

-- ───────────────────────────────────────────────────────────────────────────
-- Paiements
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.payments (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  order_id        uuid        not null references kaissi.orders(id) on delete cascade,
  method_id       uuid        references kaissi.payment_methods(id) on delete set null,
  type            text        not null check (type in ('cash', 'card', 'online', 'other')),
  amount_millimes   bigint    not null check (amount_millimes > 0),
  received_millimes bigint    check (received_millimes is null or received_millimes >= 0),
  change_millimes   bigint    not null default 0 check (change_millimes >= 0),
  reference       text,
  created_by      uuid        references kaissi.users(id) on delete set null,
  device_id       uuid        references kaissi.devices(id) on delete set null,
  shift_id        uuid,
  voided_at       timestamptz,
  voided_by       uuid        references kaissi.users(id) on delete set null,
  void_reason     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index payments_commande_idx on kaissi.payments (order_id);
create index payments_journee_idx on kaissi.payments (restaurant_id, created_at desc)
  where voided_at is null;

create table kaissi.refunds (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  payment_id      uuid        not null references kaissi.payments(id) on delete restrict,
  -- Un remboursement est un montant POSITIF de sens inverse : la contrainte
  -- >= 0 reste valable, c'est le sens métier qui change.
  amount_millimes bigint      not null check (amount_millimes > 0),
  reason          text        not null,
  approved_by     uuid        references kaissi.users(id) on delete set null,
  created_by      uuid        references kaissi.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index refunds_paiement_idx on kaissi.refunds (payment_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Caisse et shifts
-- ───────────────────────────────────────────────────────────────────────────
create table kaissi.cash_registers (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 60),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table kaissi.shifts (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  cash_register_id uuid       references kaissi.cash_registers(id) on delete set null,
  user_id         uuid        references kaissi.users(id) on delete set null,
  device_id       uuid        references kaissi.devices(id) on delete set null,
  opened_at       timestamptz not null,
  opening_float_millimes bigint not null default 0 check (opening_float_millimes >= 0),
  closed_at       timestamptz,
  counted_millimes  bigint    check (counted_millimes is null or counted_millimes >= 0),
  expected_millimes bigint    check (expected_millimes is null or expected_millimes >= 0),
  -- L'ÉCART DE CAISSE : peut être négatif, c'est tout son intérêt.
  variance_millimes bigint,
  closing_note    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column kaissi.shifts.variance_millimes is
  'Écart de caisse = compté − attendu. PEUT être négatif : aucune contrainte '
  '>= 0 ici. Un écart récurrent par employé est un signal anti-fraude.';

create index shifts_restaurant_idx on kaissi.shifts (restaurant_id, opened_at desc);
create index shifts_ouverts_idx on kaissi.shifts (restaurant_id) where closed_at is null;

create table kaissi.cash_movements (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  shift_id        uuid        not null references kaissi.shifts(id) on delete restrict,
  type            text        not null check (type in ('in', 'out', 'drop', 'payout')),
  amount_millimes bigint      not null check (amount_millimes > 0),
  reason          text        not null,
  created_by      uuid        references kaissi.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index cash_movements_shift_idx on kaissi.cash_movements (shift_id);

alter table kaissi.payments
  add constraint payments_shift_fk foreign key (shift_id)
  references kaissi.shifts(id) on delete set null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Immuabilité de order_events — RÈGLE 6
-- ═══════════════════════════════════════════════════════════════════════════
revoke update, delete, truncate on kaissi.order_events from public;
revoke update, delete, truncate on kaissi.order_events from authenticated, anon, kaissi_device, service_role;

create trigger order_events_immuable
  before update or delete on kaissi.order_events
  for each row execute function kaissi.interdit_modification();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'order_items', 'payments', 'refunds',
    'cash_registers', 'shifts', 'cash_movements'
  ] loop
    perform kaissi.protege_transactionnel(t);
  end loop;

  foreach t in array array[
    'orders', 'order_items', 'payments', 'cash_registers', 'shifts'
  ] loop
    execute format(
      'create trigger %I before update on kaissi.%I '
      'for each row execute function kaissi.touche_updated_at()',
      t || '_updated_at', t);
  end loop;
end
$$;

-- order_events : lecture + insertion seulement, jamais update ni delete.
alter table kaissi.order_events enable row level security;
alter table kaissi.order_events force row level security;

create policy order_events_lecture on kaissi.order_events
  for select to authenticated, kaissi_device
  using (kaissi.acces_restaurant(restaurant_id));

-- Un appareil ne peut insérer QUE des événements qu'il signe lui-même,
-- et uniquement dans son propre établissement.
create policy order_events_insertion_appareil on kaissi.order_events
  for insert to kaissi_device
  with check (
    device_id = kaissi.appareil_courant()
    and kaissi.acces_restaurant(restaurant_id)
  );

create policy order_events_insertion_humain on kaissi.order_events
  for insert to authenticated
  with check (kaissi.acces_restaurant(restaurant_id));

grant select, insert on kaissi.order_events to authenticated, kaissi_device;
