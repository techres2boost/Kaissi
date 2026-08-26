-- ═══════════════════════════════════════════════════════════════════════════
-- Amorce d'un Postgres LOCAL pour les tests d'intégration.
-- ═══════════════════════════════════════════════════════════════════════════
-- Nos migrations sont écrites pour Supabase : elles supposent le schéma
-- `auth`, la fonction `auth.uid()` et les rôles `authenticated`, `anon`,
-- `service_role`, `authenticator`.
--
-- Ce fichier recrée le strict minimum pour que les MÊMES migrations
-- s'appliquent sans modification sur un Postgres nu. Tester contre un schéma
-- retouché ne prouverait rien : c'est le SQL de production qu'on veut valider.
--
-- ⚠ Uniquement pour les tests. Jamais appliqué sur un environnement réel.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create schema if not exists auth;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- Table des comptes, réduite à ce que le schéma Kaissi référence.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

/*
 * `auth.uid()` chez Supabase lit la revendication `sub` du JWT.
 * En local, on lit la même variable de session : les tests peuvent ainsi
 * simuler un utilisateur humain exactement comme le fait PostgREST.
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub'
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth, extensions to anon, authenticated, service_role, authenticator;
grant execute on function auth.uid() to anon, authenticated, service_role, authenticator;
