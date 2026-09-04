-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0029 · « Prêt » redescend jusqu'au serveur en salle
-- ═══════════════════════════════════════════════════════════════════════════
-- La cuisine marque un plateau prêt depuis son écran (migration 0018). Ce
-- marqueur restait AU BACK-OFFICE : le serveur en salle, lui, tient une
-- tablette qui n'en savait rien. Il repassait donc devant la cuisine « au
-- cas où », ce que l'écran devait précisément supprimer.
--
-- ── Par quel chemin il redescend, et pourquoi celui-là ────────────────────
--
-- Pas par un troisième canal de synchronisation. `change_log` est déjà LE
-- miroir serveur → appareil : il porte un `seq` bigserial (RÈGLE 4, jamais
-- un horodatage), la caisse le rejoue depuis son curseur, et une version
-- ancienne du POS ignore poliment une entité qu'elle ne connaît pas — le
-- support N−2 est acquis sans rien écrire.
--
-- C'est exactement le raisonnement de la 0023 pour `products.is_available` :
-- aucune nouvelle voie, la caisse ne fait qu'appliquer.
--
-- ── Une annulation n'efface plus la ligne ─────────────────────────────────
--
-- Retirer un « prêt » posé par erreur SUPPRIMAIT la ligne. Vu du serveur en
-- salle, une suppression est invisible : rien ne descend, et son badge
-- « Prêt » resterait allumé pour toujours sur un plat qui ne l'est pas.
--
-- Le retrait devient donc un `cleared_at`. La ligne reste, le journal porte
-- la mise à jour, et le badge s'éteint sur la tablette. C'est aussi la règle
-- 6 appliquée à un marqueur : une annulation AJOUTE une information, elle
-- n'en retire jamais.
-- ═══════════════════════════════════════════════════════════════════════════

alter table kaissi.kitchen_ready
  add column if not exists cleared_at timestamptz,
  add column if not exists cleared_by uuid references kaissi.users(id) on delete set null;

comment on column kaissi.kitchen_ready.cleared_at is
  'Retrait d''un « prêt » posé par erreur. La ligne RESTE : une suppression '
  'ne descendrait pas jusqu''à la tablette, dont le badge resterait allumé.';

-- L'écran de cuisine ne lit plus que ce qui est encore prêt : l'index le suit.
create index if not exists kitchen_ready_actifs_idx
  on kaissi.kitchen_ready (restaurant_id, ready_at desc)
  where cleared_at is null;

-- ── Le retrait est une MISE À JOUR, faite par la cuisine elle-même ─────────
--
-- Le jeu standard réserve l'UPDATE à l'encadrement (`_correction`). Ici, le
-- geste appartient à celui qui prépare : attendre un gérant pour défaire un
-- clic ferait sortir un plat en retard, et l'écran perdrait sa crédibilité
-- dès le premier service. Ce marqueur n'est pas de la comptabilité — la
-- vente, elle, vit dans `order_events`, en insertion seule.
drop policy if exists kitchen_ready_retrait_maj on kaissi.kitchen_ready;
create policy kitchen_ready_retrait_maj on kaissi.kitchen_ready
  for update to authenticated
  using (kaissi.acces_restaurant(restaurant_id))
  with check (kaissi.acces_restaurant(restaurant_id));

-- ── La journalisation ─────────────────────────────────────────────────────
--
-- Fonction dédiée, et non `journalise_changement()` : celle-ci lit
-- `ligne.id`, colonne que `kitchen_ready` n'a pas — sa clé est `order_id`,
-- parce que c'est la COMMANDE qui est prête. L'entité journalisée porte donc
-- l'identifiant de la commande, ce qui est aussi ce dont la tablette a
-- besoin pour allumer le bon badge.
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

comment on function kaissi.journalise_prete() is
  'Fait descendre « commande prête » jusqu''aux caisses par change_log — le '
  'canal qui existe déjà, avec son curseur bigserial (RÈGLE 4).';

drop trigger if exists kitchen_ready_change_log on kaissi.kitchen_ready;
create trigger kitchen_ready_change_log
  after insert or update or delete on kaissi.kitchen_ready
  for each row execute function kaissi.journalise_prete();

-- ── Ce qui est prêt AUJOURD'HUI descend tout de suite ─────────────────────
--
-- Sans cette reprise, la fonction ne s'allumerait qu'au prochain plat marqué
-- prêt : un service déjà en cours resterait aveugle jusqu'au soir. On ne
-- reprend que la journée écoulée — un « prêt » d'il y a trois semaines
-- n'apprend plus rien à personne, et gonflerait le journal pour rien.
insert into kaissi.change_log
  (organization_id, restaurant_id, entity_type, entity_id, op, payload)
select k.organization_id, k.restaurant_id, 'kitchen_ready', k.order_id, 'insert', to_jsonb(k)
  from kaissi.kitchen_ready k
 where k.cleared_at is null
   and k.ready_at > now() - interval '1 day';
