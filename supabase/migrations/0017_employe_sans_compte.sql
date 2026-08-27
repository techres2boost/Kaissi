-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0017 · Un employé n'a pas besoin d'un compte de connexion
-- ═══════════════════════════════════════════════════════════════════════════
-- CLAUDE.md pose trois identités distinctes : l'UTILISATEUR (e-mail et mot de
-- passe, back-office), l'APPAREIL (jeton révocable, /sync) et l'EMPLOYÉ (code
-- PIN validé hors ligne). Le schéma en confondait deux : kaissi.users.id
-- RÉFÉRENÇAIT auth.users(id), donc tout employé devait posséder un compte
-- d'authentification.
--
-- Conséquence concrète, et rédhibitoire pour un produit qu'on vend : un gérant
-- ne pouvait pas embaucher un serveur depuis le back-office. Créer un compte
-- Supabase exige l'API d'administration, donc la clé service_role, qui
-- contourne RLS et n'a rien à faire dans une application web. Le seul recours
-- était d'écrire du SQL à la main dans le tableau de bord.
--
-- Or un serveur en salle ne se connecte JAMAIS au back-office. Il tape un PIN
-- sur une tablette. Le compte d'authentification n'est utile qu'à ceux qui
-- ouvrent le back-office — le gérant, le comptable.
--
-- On sépare donc les deux : kaissi.users devient la table des EMPLOYÉS, et
-- « auth_user_id » y devient un lien FACULTATIF vers un compte de connexion.
--
-- Migration additive et rétrocompatible : les lignes existantes conservent
-- leur identifiant, et reçoivent auth_user_id = id.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Le lien facultatif vers un compte de connexion ──────────────────────
alter table kaissi.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

comment on column kaissi.users.auth_user_id is
  'Compte Supabase Auth, FACULTATIF. Renseigné pour qui ouvre le back-office ; '
  'nul pour un serveur qui ne fait que taper son PIN sur une tablette.';

-- Les employés déjà en base ONT un compte : leur identifiant EST celui du
-- compte. On le recopie avant de retirer la contrainte, sinon ils perdraient
-- l'accès au back-office à la seconde suivante.
update kaissi.users u
   set auth_user_id = u.id
 where u.auth_user_id is null
   and exists (select 1 from auth.users a where a.id = u.id);

-- ── 2. L'identifiant d'employé cesse d'être celui d'un compte ──────────────
-- Sans cela, insérer un serveur sans compte violerait la clé étrangère.
alter table kaissi.users drop constraint if exists users_id_fkey;

-- Un employé créé depuis le back-office reçoit un UUIDv7 comme toute autre
-- entité du produit (RÈGLE 2).
alter table kaissi.users alter column id set default kaissi.uuid_v7();

comment on table kaissi.users is
  'Les EMPLOYÉS. Chacun peut avoir un code PIN (validé hors ligne sur la '
  'tablette) et, facultativement, un compte de connexion au back-office via '
  'auth_user_id. Les deux identités sont distinctes : un serveur en salle n''a '
  'aucune raison de posséder un mot de passe.';

-- L'e-mail devient facultatif : un serveur n'en a pas forcément, et en
-- inventer un pour satisfaire une contrainte produit des données fausses.
alter table kaissi.users alter column email drop not null;

-- L'index d'unicité portait sur (organization_id, lower(email)) sans exclure
-- les nuls. Postgres ne considère pas deux NULL comme égaux, donc plusieurs
-- employés sans e-mail cohabitent — mais on rend l'intention explicite.
drop index if exists kaissi.users_email_org_idx;
create unique index users_email_org_idx on kaissi.users (organization_id, lower(email))
  where email is not null;

-- ── 3. L'employé correspondant à l'appelant ────────────────────────────────
-- Toutes les politiques comparaient « user_id = auth.uid() ». Ce raccourci
-- n'est plus vrai : l'identifiant d'employé et celui du compte sont désormais
-- deux choses différentes. Une seule fonction porte la traduction.
create or replace function kaissi.employe_courant()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from kaissi.users u where u.auth_user_id = auth.uid();
$$;

comment on function kaissi.employe_courant() is
  'L''employé lié au compte connecté, ou NULL. Remplace le raccourci '
  '« user_id = auth.uid() », qui supposait que les deux identifiants '
  'étaient le même.';

-- ── 4. Les fonctions de tenance suivent ────────────────────────────────────
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
        where m.user_id = kaissi.employe_courant()
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
        where m.user_id = kaissi.employe_courant()
          and m.organization_id = cible
          and m.revoked_at is null
      )
    );
$$;

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
    where m.user_id = kaissi.employe_courant()
      and m.restaurant_id = cible
      and m.revoked_at is null
      and m.role in ('admin', 'gerant')
  );
$$;

create or replace function kaissi.est_administrateur(cible uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from kaissi.memberships m
    where m.user_id = kaissi.employe_courant()
      and m.restaurant_id = cible
      and m.revoked_at is null
      and m.role = 'admin'
  );
$$;

-- ── 5. Les politiques sur les employés ─────────────────────────────────────
drop policy if exists users_lecture on kaissi.users;
drop policy if exists users_ecriture_soi on kaissi.users;

create policy users_lecture on kaissi.users
  for select to authenticated, kaissi_device
  using (auth_user_id = auth.uid() or kaissi.acces_organisation(organization_id));

create policy users_ecriture_soi on kaissi.users
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists memberships_lecture on kaissi.memberships;
create policy memberships_lecture on kaissi.memberships
  for select to authenticated, kaissi_device
  using (user_id = kaissi.employe_courant() or kaissi.acces_restaurant(restaurant_id));

-- ── 6. Un gérant peut EMBAUCHER ────────────────────────────────────────────
-- « users_rattachement » (0014) autorisait déjà l'insertion dans son
-- organisation. Elle suffit désormais à créer un employé complet, PIN compris,
-- puisque plus aucun compte d'authentification n'est requis.
--
-- Reste à interdire qu'un gérant s'attribue un compte de connexion en douce :
-- auth_user_id n'est pas dans les colonnes qu'il peut écrire.
grant insert (id, organization_id, email, full_name, phone, pin_hash, status)
  on kaissi.users to authenticated;

comment on policy users_rattachement on kaissi.users is
  'Un gérant crée les employés de son organisation. Le privilège de colonne '
  'lui interdit de renseigner auth_user_id : donner un accès au back-office '
  'reste une décision d''administrateur.';
