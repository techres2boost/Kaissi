-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0011 · Les employés atteignent enfin les tablettes
-- ═══════════════════════════════════════════════════════════════════════════
-- Le POS a une table locale « employees » — c'est elle qui valide les codes
-- PIN HORS LIGNE. Côté serveur, un employé est la jointure de deux tables :
-- kaissi.users (identité, pin_hash) et kaissi.memberships (rôle et
-- permissions, PAR établissement).
--
-- Aucune des deux n'alimentait change_log. Conséquence : un gérant pouvait
-- créer un employé ou réinitialiser un PIN dans le back-office sans que
-- cela n'atteigne JAMAIS une tablette. L'employé se serait présenté devant
-- une caisse qui ne le connaît pas, un vendredi soir, sans que rien
-- n'indique pourquoi.
--
-- Cette migration comble ce trou. Elle est purement additive : aucune table,
-- colonne ni politique existante n'est modifiée.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- La charge utile, à la forme EXACTE de la table locale du POS
-- ───────────────────────────────────────────────────────────────────────────
-- Les clés reprennent les colonnes de packages/db-local (employees) : le POS
-- recopie colonne à colonne, il ne transforme rien. Une clé en trop est
-- ignorée par l'appareil, une clé manquante laisse la colonne inchangée.
create or replace function kaissi.employe_charge_utile(
  cible_user uuid,
  cible_membership uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- L'identifiant de l'employé est celui de l'UTILISATEUR, pas celui de
    -- l'appartenance : c'est lui que portent orders.opened_by et
    -- payments.created_by. Deux identifiants différents rendraient le
    -- rapprochement impossible.
    'id',              u.id,
    'organization_id', m.organization_id,
    'restaurant_id',   m.restaurant_id,
    'full_name',       u.full_name,
    'role',            m.role,
    -- Hachage Argon2id, jamais le PIN. C'est précisément ce que l'appareil
    -- doit recevoir pour valider une prise de poste sans réseau.
    'pin_hash',        u.pin_hash,
    'permissions',     m.permissions,
    -- Un employé suspendu, ou dont l'appartenance est révoquée, cesse de
    -- pouvoir prendre son poste — mais sa ligne RESTE sur l'appareil : les
    -- commandes déjà passées à son nom doivent rester lisibles.
    'is_active',       case
                         when u.status = 'actif' and m.revoked_at is null then 1
                         else 0
                       end,
    'archived_at',     u.archived_at
  )
  from kaissi.memberships m
  join kaissi.users u on u.id = m.user_id
  where m.id = cible_membership
    and m.user_id = cible_user;
$$;

comment on function kaissi.employe_charge_utile(uuid, uuid) is
  'Projette users ⋈ memberships à la forme de la table locale employees du POS.';

-- ───────────────────────────────────────────────────────────────────────────
-- Déclencheur sur memberships — le cas simple : une appartenance, un
-- établissement, une ligne de journal
-- ───────────────────────────────────────────────────────────────────────────
create or replace function kaissi.journalise_employe_appartenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ligne record;
  charge jsonb;
begin
  ligne := coalesce(new, old);

  -- Sur DELETE, la jointure ne rend plus rien : on émet une suppression, que
  -- le POS traduit par un DELETE sur sa propre table.
  if tg_op = 'DELETE' then
    insert into kaissi.change_log
      (organization_id, restaurant_id, entity_type, entity_id, op, payload)
    values (ligne.organization_id, ligne.restaurant_id, 'employees', ligne.user_id, 'delete', null);
    return ligne;
  end if;

  charge := kaissi.employe_charge_utile(new.user_id, new.id);

  insert into kaissi.change_log
    (organization_id, restaurant_id, entity_type, entity_id, op, payload)
  values (
    new.organization_id,
    new.restaurant_id,
    'employees',
    new.user_id,
    lower(tg_op),
    charge
  );
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Déclencheur sur users — le cas qui compte vraiment
-- ───────────────────────────────────────────────────────────────────────────
-- Un utilisateur peut être rattaché à PLUSIEURS établissements. Changer son
-- nom, son statut ou son PIN doit produire une ligne de journal par
-- établissement concerné : sinon la réinitialisation d'un PIN n'atteindrait
-- qu'une seule caisse, et l'employé serait refusé dans l'autre.
create or replace function kaissi.journalise_employe_utilisateur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  appartenance record;
begin
  -- Seuls ces champs voyagent vers l'appareil. Une mise à jour du numéro de
  -- téléphone ne mérite pas de réveiller le catalogue de toutes les tablettes.
  if new.full_name is not distinct from old.full_name
     and new.pin_hash is not distinct from old.pin_hash
     and new.status is not distinct from old.status
     and new.archived_at is not distinct from old.archived_at
  then
    return new;
  end if;

  for appartenance in
    select m.id, m.organization_id, m.restaurant_id
    from kaissi.memberships m
    where m.user_id = new.id
  loop
    insert into kaissi.change_log
      (organization_id, restaurant_id, entity_type, entity_id, op, payload)
    values (
      appartenance.organization_id,
      appartenance.restaurant_id,
      'employees',
      new.id,
      'update',
      kaissi.employe_charge_utile(new.id, appartenance.id)
    );
  end loop;

  return new;
end;
$$;

create trigger memberships_change_log
  after insert or update or delete on kaissi.memberships
  for each row execute function kaissi.journalise_employe_appartenance();

create trigger users_change_log
  after update on kaissi.users
  for each row execute function kaissi.journalise_employe_utilisateur();

comment on function kaissi.journalise_employe_appartenance() is
  'Émet une entrée change_log « employees » à chaque changement d''appartenance.';
comment on function kaissi.journalise_employe_utilisateur() is
  'Émet une entrée change_log « employees » PAR ÉTABLISSEMENT quand l''identité, '
  'le PIN ou le statut change. Sans la boucle, un PIN réinitialisé n''atteindrait '
  'qu''un seul établissement.';
