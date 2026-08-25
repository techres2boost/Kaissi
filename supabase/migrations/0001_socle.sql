-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0001 · Socle : schéma, extensions, UUIDv7, contexte de sécurité
-- ═══════════════════════════════════════════════════════════════════════════
-- Tout Kaissi vit dans le schéma `kaissi`. Le schéma `public` reste vide :
-- rien n'est exposé par PostgREST sans décision explicite.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists kaissi;

create extension if not exists pgcrypto with schema extensions;

comment on schema kaissi is
  'Kaissi — POS & gestion de restaurant offline-first (Res2Boost). Multi-tenant, RLS obligatoire.';

-- ───────────────────────────────────────────────────────────────────────────
-- Rôles applicatifs
-- ───────────────────────────────────────────────────────────────────────────
-- Trois identités distinctes, jamais confondues (cf. dossier d'architecture) :
--   • l'UTILISATEUR  → Supabase Auth, rôle `authenticated`, accès back-office ;
--   • l'APPAREIL     → jeton long révocable, rôle `kaissi_device`, accès /sync ;
--   • l'EMPLOYÉ      → code PIN validé HORS LIGNE, ne parle jamais au serveur.
-- Un terminal n'est PAS un utilisateur : un serveur en salle change cinq fois
-- par service, la tablette reste authentifiée en continu.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kaissi_device') then
    create role kaissi_device nologin noinherit;
  end if;
end
$$;

-- L'API de synchronisation emprunte ce rôle par `set local role kaissi_device`.
grant kaissi_device to authenticator;
grant kaissi_device to postgres;
grant usage on schema kaissi to kaissi_device, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- UUIDv7 côté serveur
-- ───────────────────────────────────────────────────────────────────────────
-- Les entités créables hors ligne reçoivent leur UUIDv7 de l'APPAREIL ; cette
-- fonction ne sert qu'aux entités créées côté serveur (invitations, jetons).
-- PostgreSQL 17 n'a pas encore `uuidv7()` natif — implémentation RFC 9562.
create or replace function kaissi.uuid_v7()
returns uuid
language plpgsql
volatile
parallel safe
as $$
declare
  ms        bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  aleatoire bytea  := extensions.gen_random_bytes(10);
  octets    bytea;
begin
  -- 48 bits d'horodatage, gros-boutiste.
  octets := set_byte(set_byte(set_byte(set_byte(set_byte(set_byte(
              '\x000000000000'::bytea,
              0, ((ms >> 40) & 255)::int),
              1, ((ms >> 32) & 255)::int),
              2, ((ms >> 24) & 255)::int),
              3, ((ms >> 16) & 255)::int),
              4, ((ms >>  8) & 255)::int),
              5, ( ms        & 255)::int);
  octets := octets || aleatoire;
  -- Version 7 sur les 4 bits hauts de l'octet 6.
  octets := set_byte(octets, 6, (get_byte(octets, 6) & 15) | 112);
  -- Variante RFC 4122 sur les 2 bits hauts de l'octet 8.
  octets := set_byte(octets, 8, (get_byte(octets, 8) & 63) | 128);
  return encode(octets, 'hex')::uuid;
end;
$$;

comment on function kaissi.uuid_v7() is
  'UUIDv7 (RFC 9562) : triable par le temps, évite la fragmentation d''index. '
  'Les entités créables HORS LIGNE reçoivent leur identifiant de l''appareil, pas d''ici.';

-- ───────────────────────────────────────────────────────────────────────────
-- Contexte de sécurité
-- ───────────────────────────────────────────────────────────────────────────
-- Deux sources possibles, dans cet ordre :
--   1. les revendications du JWT (`request.jwt.claims`) — chemin PostgREST ;
--   2. les variables de session `kaissi.*` — chemin de l'API de sync, posées
--      par `set_config('kaissi.device_id', ..., true)` en début de transaction.

create or replace function kaissi.revendication(cle text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('kaissi.' || cle, true), ''),
    nullif(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> cle,
      ''
    )
  );
$$;

create or replace function kaissi.appareil_courant()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(kaissi.revendication('device_id'), '')::uuid;
$$;

create or replace function kaissi.restaurant_contextuel()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(kaissi.revendication('restaurant_id'), '')::uuid;
$$;

comment on function kaissi.appareil_courant() is
  'Identifiant de l''appareil courant, ou NULL si l''appelant est un humain.';

-- ───────────────────────────────────────────────────────────────────────────
-- Horodatage de modification
-- ───────────────────────────────────────────────────────────────────────────
create or replace function kaissi.touche_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Interdiction d'UPDATE / DELETE — immuabilité réelle
-- ───────────────────────────────────────────────────────────────────────────
-- Le REVOKE seul ne protège pas du propriétaire de la table ni de `postgres`.
-- Ce déclencheur, lui, s'applique à TOUT LE MONDE : c'est le seul moyen
-- d'avoir un journal réellement en insertion seule.
create or replace function kaissi.interdit_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'Table % en INSERTION SEULE : ni UPDATE ni DELETE ne sont autorisés (opération : %).',
    tg_table_name, tg_op
    using errcode = 'insufficient_privilege',
          hint = 'Une correction s''exprime par un NOUVEL événement, jamais par une modification.';
end;
$$;

comment on function kaissi.interdit_modification() is
  'Rend une table append-only. Posé sur order_events et audit_events.';
