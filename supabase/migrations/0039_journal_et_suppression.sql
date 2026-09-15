-- ═══════════════════════════════════════════════════════════════════════════
-- 0039 — Le journal du référentiel ne bloque plus la suppression
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Le mur, et pourquoi il était prévisible ────────────────────────────────
--
-- Supprimer un établissement échouait sur :
--
--     insert or update on table "change_log" violates foreign key
--     constraint "change_log_restaurant_id_fkey"
--
-- C'est EXACTEMENT le mur que la migration 0035 avait déjà rencontré, et
-- qu'elle avait contourné pour son propre déclencheur en le limitant à
-- `after insert or update`. Le voici de l'autre côté.
--
-- Le mécanisme : `delete from kaissi.restaurants where id = X` supprime
-- d'abord la ligne, PUIS déclenche les actions référentielles. Les produits,
-- catégories, postes, taux et modes de paiement partent en cascade — et
-- chacun de ces `delete` réveille `kaissi.journalise_changement()`, qui tente
-- d'écrire dans `change_log` une ligne désignant X. Or X n'existe plus : la
-- clé étrangère refuse, et c'est la SUPPRESSION ENTIÈRE qui échoue.
--
-- ── Ce qu'on ne fait PAS ───────────────────────────────────────────────────
--
-- On ne retire pas la clé étrangère : elle garantit qu'aucune page de
-- catalogue ne désigne un établissement fantôme.
--
-- On ne bascule pas `change_log.restaurant_id` en `on delete cascade` : cela
-- ne changerait rien. Le problème n'est pas que les anciennes lignes
-- subsistent, c'est qu'on en INSÈRE de nouvelles pendant la cascade, alors
-- que le parent est déjà parti. L'ordre des actions référentielles ne sauve
-- personne.
--
-- On n'énumère pas non plus les tables à vider d'abord. Ça marcherait
-- aujourd'hui, et ça casserait le jour où quelqu'un ajoute une table au
-- référentiel sans penser à cette liste — c'est-à-dire au premier ajout.
--
-- ── Ce qu'on fait : le déclencheur se tait quand il n'a plus d'auditeur ────
--
-- Une entrée de `change_log` sert à UNE chose : permettre à une caisse de
-- rattraper le catalogue de son établissement. Journaliser un changement sur
-- un établissement qui vient de disparaître n'a aucun destinataire — aucune
-- caisse ne tirera jamais cette page, puisqu'aucune caisse n'y est rattachée.
--
-- Le déclencheur vérifie donc que l'établissement existe encore. En
-- fonctionnement normal il existe toujours, et le contrôle est une lecture
-- par clé primaire : le coût est nul. Pendant une cascade de suppression, il
-- ne le voit plus — la transaction voit ses propres suppressions — et se tait.
--
-- Robuste par construction : cela vaut pour TOUTES les tables du référentiel,
-- y compris celles qu'on ajoutera.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── LA règle, à un seul endroit ──────────────────────────────────────────
--
-- Cinq fonctions alimentent `change_log`. Recopier le contrôle dans chacune,
-- c'est se donner cinq chances de l'oublier — et la sixième, celle qu'on
-- écrira l'an prochain, ne l'aura pas du tout. Elle est donc ici, nommée.
--
-- ⚑ TOUTE nouvelle fonction qui écrit dans `change_log` doit commencer par
--   cet appel. PostgreSQL ne peut pas l'imposer ; le nom de la fonction, lui,
--   le dit à qui relit.
create or replace function kaissi.etablissement_vivant(p_restaurant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from kaissi.restaurants r where r.id = p_restaurant);
$$;

comment on function kaissi.etablissement_vivant(uuid) is
  'L''établissement existe-t-il encore ? Faux pendant la cascade d''une '
  'suppression — la ligne parente part AVANT les actions référentielles, et la '
  'transaction voit ses propres suppressions. Tout journalisateur de '
  'change_log doit commencer par l''interroger, sous peine de faire échouer '
  'la suppression entière sur une violation de clé étrangère.';

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

  -- ⚑ L'établissement est-il encore là ?
  --
  -- Non pendant la cascade d'une suppression : la ligne parente est retirée
  -- AVANT que les actions référentielles ne s'exécutent, et la transaction
  -- voit ses propres suppressions. Sans ce contrôle, l'insertion ci-dessous
  -- viole `change_log_restaurant_id_fkey` et fait échouer toute la
  -- suppression — sur un message qui ne nomme pas ce déclencheur.
  if not kaissi.etablissement_vivant(ligne.restaurant_id) then
    return ligne;
  end if;

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
  'permet au POS de rattraper le catalogue depuis son curseur, par pages. '
  'Se tait si l''établissement n''existe plus : pendant la cascade d''une '
  'suppression, la page n''aurait aucun destinataire — et la clé étrangère '
  'la refuserait, faisant échouer la suppression entière.';

-- ── Le même garde-fou pour les modificateurs (0037) ───────────────────────
--
-- `journalise_modificateurs_produit()` écrit dans la même table, avec la même
-- clé étrangère : elle bute sur le même mur quand `product_modifiers` part en
-- cascade. Le laisser de côté aurait rendu la suppression possible pour un
-- établissement sans modificateurs, et impossible pour les autres — le pire
-- des cas, parce qu'il marche en démonstration.
create or replace function kaissi.journalise_modificateurs_produit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ligne record;
  groupes jsonb;
begin
  ligne := coalesce(new, old);

  if not kaissi.etablissement_vivant(ligne.restaurant_id) then
    return ligne;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'product_id',        pm.product_id,
               'modifier_group_id', pm.modifier_group_id,
               'restaurant_id',     pm.restaurant_id,
               'position',          pm.position
             )
             order by pm.position, pm.modifier_group_id
           ),
           '[]'::jsonb
         )
    into groupes
    from kaissi.product_modifiers pm
   where pm.product_id = ligne.product_id;

  insert into kaissi.change_log
    (organization_id, restaurant_id, entity_type, entity_id, op, payload)
  values (
    ligne.organization_id,
    ligne.restaurant_id,
    'product_modifiers',
    ligne.product_id,
    'update',
    jsonb_build_object('product_id', ligne.product_id, 'groupes', groupes)
  );
  return ligne;
end;
$$;

-- ── Les trois autres journalisateurs ──────────────────────────────────────
--
-- `memberships` part en cascade quand on supprime un établissement : c'est
-- ELLE qui faisait échouer la suppression d'un restaurant pourtant vierge.
-- `kitchen_ready` est en `on delete restrict` — il bloquerait de toute façon
-- si des lignes existaient — mais le laisser sans garde-fou ferait dépendre
-- le résultat de l'ordre des actions référentielles, ce qui n'est pas une
-- propriété sur laquelle on veut s'appuyer.

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

  if not kaissi.etablissement_vivant(ligne.restaurant_id) then
    return ligne;
  end if;

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
    -- Une appartenance peut désigner un établissement en cours de suppression :
    -- on saute celle-là et on continue les autres, plutôt que de faire échouer
    -- la mise à jour de l'employé dans TOUS ses restaurants.
    if kaissi.etablissement_vivant(appartenance.restaurant_id) then
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
    end if;
  end loop;

  return new;
end;
$$;

create or replace function kaissi.journalise_prete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ligne record;
begin
  ligne := coalesce(new, old);

  if not kaissi.etablissement_vivant(ligne.restaurant_id) then
    return ligne;
  end if;

  insert into kaissi.change_log
    (organization_id, restaurant_id, entity_type, entity_id, op, payload)
  values (
    ligne.organization_id,
    ligne.restaurant_id,
    'kitchen_ready',
    ligne.order_id,
    lower(tg_op),
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return ligne;
end;
$$;
