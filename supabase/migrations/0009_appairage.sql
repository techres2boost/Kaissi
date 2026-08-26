-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0009 · Appairage des appareils (Phase 2)
-- ═══════════════════════════════════════════════════════════════════════════
-- Un appareil ne s'authentifie ni avec un compte, ni avec un PIN : il porte
-- un jeton long, opaque, révocable à distance et lié à UN établissement.
--
-- Le jeton en clair n'existe qu'une fois, au moment de l'appairage. La base
-- n'en garde que l'empreinte SHA-256 : un vol de la table `devices` ne donne
-- accès à rien.
-- ═══════════════════════════════════════════════════════════════════════════

-- Journal des appairages : qui a appairé quel terminal, et quand.
-- Un appareil qui apparaît sans trace d'appairage est une anomalie.
create table kaissi.device_pairings (
  id              uuid        primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  device_id       uuid        not null references kaissi.devices(id) on delete cascade,
  paired_by       uuid        references kaissi.users(id) on delete set null,
  paired_at       timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid        references kaissi.users(id) on delete set null,
  revoke_reason   text,
  -- Empreinte du jeton émis, pour retrouver quel appairage a produit quoi.
  token_hash      text        not null
);

create index device_pairings_appareil_idx on kaissi.device_pairings (device_id, paired_at desc);
create index device_pairings_restaurant_idx on kaissi.device_pairings (restaurant_id, paired_at desc);

comment on table kaissi.device_pairings is
  'Journal des appairages. Le jeton en clair n''y figure JAMAIS, seulement '
  'son empreinte : il n''est montré qu''une fois, au gérant, à l''appairage.';

select kaissi.protege_transactionnel('device_pairings');

-- ───────────────────────────────────────────────────────────────────────────
-- Révocation d'un appareil
-- ───────────────────────────────────────────────────────────────────────────
-- Révoquer n'efface RIEN : l'appareil garde ses ventes locales, elles
-- repartiront après un nouvel appairage. Couper l'accès et perdre la caisse
-- de la journée seraient deux punitions pour un seul incident.
create or replace function kaissi.revoquer_appareil(
  p_device_id uuid,
  p_motif text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update kaissi.devices
  set revoked_at = now()
  where id = p_device_id and revoked_at is null;

  if not found then
    raise exception 'Appareil % introuvable ou déjà révoqué.', p_device_id
      using errcode = 'no_data_found';
  end if;

  update kaissi.device_pairings
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = p_motif
  where device_id = p_device_id and revoked_at is null;
end;
$$;

comment on function kaissi.revoquer_appareil(uuid, text) is
  'Révoque un appareil sans toucher à ses ventes. Ses données locales sont '
  'conservées et repartiront après un nouvel appairage.';

-- ───────────────────────────────────────────────────────────────────────────
-- Vue de supervision — ce que le gérant regarde
-- ───────────────────────────────────────────────────────────────────────────
create or replace view kaissi.etat_appareils
with (security_invoker = true)
as
select
  d.id,
  d.restaurant_id,
  d.organization_id,
  d.label,
  d.type,
  d.ticket_prefix,
  d.app_version,
  d.protocol_version,
  d.last_seen_at,
  d.revoked_at,
  c.last_event_seq,
  c.last_catalog_seq,
  c.last_push_at,
  c.last_pull_at,
  -- Retard de l'appareil sur la tête de file : c'est LE chiffre qui dit
  -- si un terminal décroche.
  (select coalesce(max(server_seq), 0) from kaissi.order_events e
    where e.restaurant_id = d.restaurant_id) - coalesce(c.last_event_seq, 0)
    as retard_evenements,
  (select count(*) from kaissi.sync_mutations m
    where m.device_id = d.id and m.status = 'rejete') as operations_refusees
from kaissi.devices d
left join kaissi.sync_cursors c on c.device_id = d.id;

comment on view kaissi.etat_appareils is
  'Supervision du parc : dernier contact, retard sur la tête de file, '
  'opérations refusées. `security_invoker` : la vue respecte le RLS de '
  'l''appelant, elle ne contourne rien.';

grant select on kaissi.etat_appareils to authenticated;
