-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0014 · Un gérant peut administrer les employés de SON établissement
-- ═══════════════════════════════════════════════════════════════════════════
-- Jusqu'ici, la seule politique d'écriture sur kaissi.users était
-- « users_ecriture_soi » : chacun ne modifie que sa propre ligne. Conséquence
-- concrète : un gérant ne pouvait PAS réinitialiser le code PIN d'un serveur.
-- Le seul recours était une requête SQL manuelle dans le tableau de bord
-- Supabase — c'est-à-dire un accès direct à la base confié à un restaurateur.
--
-- Cette migration ouvre exactement ce qu'il faut, et rien de plus.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Le périmètre : les employés d'un établissement que j'encadre
-- ───────────────────────────────────────────────────────────────────────────
create or replace function kaissi.gere_utilisateur(cible uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Un gérant n'administre jamais un ADMINISTRATEUR, même si tous deux
    -- travaillent dans le même établissement. Sans cette exclusion, réinitialiser
    -- le PIN de son propre patron serait à portée de clic.
    not exists (
      select 1 from kaissi.memberships a
      where a.user_id = cible and a.role = 'admin' and a.revoked_at is null
    )
    and exists (
      select 1
      from kaissi.memberships m
      where m.user_id = cible
        and m.revoked_at is null
        and kaissi.est_gestionnaire(m.restaurant_id)
    );
$$;

comment on function kaissi.gere_utilisateur(uuid) is
  'Vrai si l''appelant encadre un établissement où cet employé travaille, et '
  'que cet employé n''est pas administrateur.';

-- ───────────────────────────────────────────────────────────────────────────
-- Écriture restreinte AUX COLONNES qui concernent la caisse
-- ───────────────────────────────────────────────────────────────────────────
-- Le privilège de table portait sur toutes les colonnes. On le remplace par un
-- privilège de COLONNE : même avec la bonne politique, un gérant ne peut pas
-- déplacer un employé vers une autre organisation, ni changer son e-mail —
-- ce qui le désynchroniserait de auth.users sans que rien ne le signale.
revoke update on kaissi.users from authenticated;
grant update (full_name, phone, pin_hash, status, archived_at)
  on kaissi.users to authenticated;

create policy users_gestion_equipe on kaissi.users
  for update to authenticated
  using (kaissi.gere_utilisateur(id))
  with check (kaissi.gere_utilisateur(id));

-- L'INSERT reste nécessaire pour rattacher un compte d'authentification qui
-- vient d'être créé. Il est borné à l'organisation de l'appelant : la ligne
-- kaissi.users est le miroir applicatif de auth.users, jamais son autorité.
create policy users_rattachement on kaissi.users
  for insert to authenticated
  with check (kaissi.acces_organisation(organization_id));

comment on policy users_gestion_equipe on kaissi.users is
  'Un gérant réinitialise le PIN, renomme ou suspend les employés de son '
  'établissement. Les colonnes sensibles sont hors de portée par privilège '
  'de colonne, pas seulement par politique.';

-- ───────────────────────────────────────────────────────────────────────────
-- Fermer une escalade de privilège préexistante
-- ───────────────────────────────────────────────────────────────────────────
-- « memberships_gestion » autorisait tout gérant à écrire n'importe quelle
-- appartenance de son établissement — y compris à s'attribuer le rôle
-- « admin ». Un gérant pouvait donc devenir administrateur de l'organisation
-- en une requête. Seul un administrateur crée un administrateur.
create or replace function kaissi.est_administrateur(cible uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from kaissi.memberships m
    where m.user_id = auth.uid()
      and m.restaurant_id = cible
      and m.revoked_at is null
      and m.role = 'admin'
  );
$$;

create or replace function kaissi.appartenance_autorisee(cible uuid, role_vise text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select kaissi.est_gestionnaire(cible)
     and (role_vise <> 'admin' or kaissi.est_administrateur(cible));
$$;

comment on function kaissi.appartenance_autorisee(uuid, text) is
  'Un gérant gère les rôles de son établissement, mais SEUL un administrateur '
  'peut créer ou modifier une appartenance « admin ».';

drop policy memberships_gestion on kaissi.memberships;

create policy memberships_gestion on kaissi.memberships
  for all to authenticated
  using (kaissi.appartenance_autorisee(restaurant_id, role))
  with check (kaissi.appartenance_autorisee(restaurant_id, role));
