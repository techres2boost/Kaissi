-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0006 · Journal d'audit immuable, chaîné par hash
-- ═══════════════════════════════════════════════════════════════════════════
-- Le patron achète aussi le logiciel pour savoir ce qui se passe quand il
-- n'est pas là. Chaque ligne porte le hash de la précédente : supprimer ou
-- modifier une ligne en base casse la chaîne et devient DÉTECTABLE, y compris
-- par quelqu'un qui aurait un accès SQL direct.
--
-- La sérialisation canonique ci-dessous est le MIROIR EXACT de
-- `packages/domain/src/audit.ts` : toute divergence ferait échouer la
-- vérification à tort. Les deux implémentations sont testées ensemble.
-- ═══════════════════════════════════════════════════════════════════════════

create table kaissi.audit_events (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        references kaissi.restaurants(id) on delete restrict,
  actor_user_id   uuid        references kaissi.users(id) on delete set null,
  device_id       uuid        references kaissi.devices(id) on delete set null,
  action          text        not null check (length(btrim(action)) between 1 and 120),
  entity_type     text        not null,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  -- Justification obligatoire pour les opérations à autorisation renforcée.
  reason          text,
  authorized_by   uuid        references kaissi.users(id) on delete set null,
  -- Une opération REFUSÉE génère elle aussi un événement d'audit.
  outcome         text        not null default 'accepte'
                  check (outcome in ('accepte', 'refuse')),
  created_at      timestamptz not null default now(),
  -- Forme canonique de l'horodatage : c'est ELLE qui entre dans le hash.
  -- Posée par le déclencheur de chaînage, jamais saisie par l'appelant.
  -- (Pas une colonne générée : `to_char(timestamp, text)` est STABLE et non
  --  IMMUTABLE, PostgreSQL la refuserait dans une expression GENERATED.)
  created_at_canon text        not null default '',
  -- Une chaîne par établissement ; les événements d'organisation ont la leur.
  chain_key       text        not null,
  chain_seq       bigint      not null generated always as identity,
  prev_hash       char(64)    not null,
  hash            char(64)    not null
);

comment on table kaissi.audit_events is
  'Journal IMMUABLE chaîné par hash. Une annulation n''efface jamais rien : '
  'elle ajoute un événement. L''état visible change ; l''historique, lui, '
  'ne perd jamais d''information.';
comment on column kaissi.audit_events.created_at_canon is
  'Horodatage canonique UTC entrant dans le hash. Miroir exact de la forme '
  'sérialisée par packages/domain/src/audit.ts.';

create index audit_events_chaine_idx on kaissi.audit_events (chain_key, chain_seq);
create index audit_events_restaurant_idx on kaissi.audit_events (restaurant_id, created_at desc);
create index audit_events_acteur_idx on kaissi.audit_events (restaurant_id, actor_user_id, created_at desc);
create index audit_events_action_idx on kaissi.audit_events (restaurant_id, action, created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- Sérialisation canonique — MIROIR de serialiserAudit() en TypeScript
-- ───────────────────────────────────────────────────────────────────────────
-- Champs dans un ordre FIXE, séparés par « | », NULL rendu par chaîne vide.
-- Surtout pas de JSON : l'ordre des clés n'y est garanti par aucune norme.
create or replace function kaissi.serialise_audit(
  p_prev_hash text,
  p_id uuid,
  p_organization_id uuid,
  p_restaurant_id uuid,
  p_actor_user_id uuid,
  p_device_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_created_at_canon text
)
returns text
language sql
immutable
as $$
  select concat_ws('|',
    p_prev_hash,
    p_id::text,
    p_organization_id::text,
    coalesce(p_restaurant_id::text, ''),
    coalesce(p_actor_user_id::text, ''),
    coalesce(p_device_id::text, ''),
    p_action,
    p_entity_type,
    coalesce(p_entity_id::text, ''),
    p_created_at_canon
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Chaînage à l'insertion
-- ───────────────────────────────────────────────────────────────────────────
create or replace function kaissi.chaine_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  precedent char(64);
  canon     text;
begin
  new.chain_key := coalesce(
    new.restaurant_id::text,
    'org:' || new.organization_id::text
  );

  -- Verrou par chaîne : deux insertions concurrentes sur le même
  -- établissement se sérialisent, sinon deux lignes partageraient prev_hash.
  perform pg_advisory_xact_lock(hashtextextended(new.chain_key, 0));

  select a.hash into precedent
  from kaissi.audit_events a
  where a.chain_key = new.chain_key
  order by a.chain_seq desc
  limit 1;

  new.prev_hash := coalesce(precedent, repeat('0', 64));

  new.created_at := coalesce(new.created_at, now());
  canon := to_char(timezone('UTC', new.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  new.created_at_canon := canon;

  new.hash := encode(
    extensions.digest(
      kaissi.serialise_audit(
        new.prev_hash, new.id, new.organization_id, new.restaurant_id,
        new.actor_user_id, new.device_id, new.action, new.entity_type,
        new.entity_id, canon
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create trigger audit_events_chainage
  before insert on kaissi.audit_events
  for each row execute function kaissi.chaine_audit();

-- ───────────────────────────────────────────────────────────────────────────
-- Vérification de l'intégrité — l'argument commercial en démonstration
-- ───────────────────────────────────────────────────────────────────────────
create or replace function kaissi.verifie_chaine_audit(p_chain_key text)
returns table (
  chain_seq bigint,
  id uuid,
  valide boolean,
  probleme text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attendu char(64) := repeat('0', 64);
  ligne   record;
  calcule char(64);
begin
  for ligne in
    select * from kaissi.audit_events a
    where a.chain_key = p_chain_key
    order by a.chain_seq
  loop
    if ligne.prev_hash <> attendu then
      chain_seq := ligne.chain_seq; id := ligne.id; valide := false;
      probleme := format('Chaîne rompue : hash précédent attendu %s, trouvé %s.',
                         attendu, ligne.prev_hash);
      return next;
      return;
    end if;

    calcule := encode(
      extensions.digest(
        kaissi.serialise_audit(
          ligne.prev_hash, ligne.id, ligne.organization_id, ligne.restaurant_id,
          ligne.actor_user_id, ligne.device_id, ligne.action, ligne.entity_type,
          ligne.entity_id, ligne.created_at_canon
        ),
        'sha256'
      ),
      'hex'
    );

    if calcule <> ligne.hash then
      chain_seq := ligne.chain_seq; id := ligne.id; valide := false;
      probleme := format('Ligne altérée : hash recalculé %s ≠ hash stocké %s.',
                         calcule, ligne.hash);
      return next;
      return;
    end if;

    attendu := ligne.hash;
  end loop;

  chain_seq := null; id := null; valide := true;
  probleme := 'Journal intègre.';
  return next;
end;
$$;

comment on function kaissi.verifie_chaine_audit(text) is
  'Rejoue la chaîne de hash d''un établissement. Retourne la PREMIÈRE rupture '
  'détectée, ou « Journal intègre ».';

-- ═══════════════════════════════════════════════════════════════════════════
-- Immuabilité — RÈGLE 6
-- ═══════════════════════════════════════════════════════════════════════════
revoke update, delete, truncate on kaissi.audit_events from public;
revoke update, delete, truncate on kaissi.audit_events from authenticated, anon, kaissi_device, service_role;

create trigger audit_events_immuable
  before update or delete on kaissi.audit_events
  for each row execute function kaissi.interdit_modification();

alter table kaissi.audit_events enable row level security;
alter table kaissi.audit_events force row level security;

create policy audit_lecture on kaissi.audit_events
  for select to authenticated
  using (
    restaurant_id is null
      and kaissi.acces_organisation(organization_id)
    or kaissi.acces_restaurant(restaurant_id)
  );

create policy audit_insertion on kaissi.audit_events
  for insert to authenticated, kaissi_device
  with check (
    restaurant_id is null
      and kaissi.acces_organisation(organization_id)
    or kaissi.acces_restaurant(restaurant_id)
  );

grant select, insert on kaissi.audit_events to authenticated, kaissi_device;
