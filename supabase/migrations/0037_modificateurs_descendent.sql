-- ═══════════════════════════════════════════════════════════════════════════
-- 0037 — Les MODIFICATEURS atteignent enfin la caisse
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Le trou, et pourquoi il ne se voyait pas ───────────────────────────────
--
-- `modifier_groups` et `modifiers` descendent depuis la 0005. `product_modifiers`,
-- la table qui dit QUEL groupe s'applique à QUEL produit, n'a jamais eu de
-- déclencheur : elle est absente de la liste de la 0005.
--
-- Or la caisse lit ses modificateurs ainsi (`depots/catalogue.ts`) :
--
--     FROM modifiers m
--     JOIN modifier_groups g ON g.id = m.modifier_group_id
--     JOIN product_modifiers pm ON pm.modifier_group_id = g.id
--    WHERE pm.product_id = ?
--
-- Sans la table de liaison, cette jointure ne rend RIEN. Sur un terminal
-- appairé, aucun produit n'a jamais proposé le moindre supplément — et
-- personne ne l'a signalé, parce que le jeu de DÉMONSTRATION pose ces lignes
-- localement (`packages/db-local/src/graine.ts`). La caisse de démonstration
-- montrait donc « Fromage +1,500 », et la caisse d'un vrai client, rien.
--
-- C'est la même panne que les postes de préparation avant la 0025 : un
-- mécanisme complet, testé, et une seule arête manquante qui le rend inerte.
--
-- ── Pourquoi un déclencheur DÉDIÉ, et pas celui du référentiel ─────────────
--
-- `kaissi.journalise_changement()` écrit `ligne.id` dans `change_log.entity_id`.
-- `product_modifiers` n'a PAS de colonne `id` : c'est une table de liaison, son
-- identité est le COUPLE (product_id, modifier_group_id). L'ajouter à la boucle
-- de la 0005 ferait échouer toute écriture sur « record ligne has no field id ».
--
-- On aurait pu lui ajouter une colonne `id`. On ne le fait pas, et la raison
-- vaut d'être écrite : `change_log` transporterait alors des lignes de liaison
-- une par une, et une tablette qui en manquerait une afficherait un produit
-- avec la moitié de ses suppléments — sans que rien ne permette de s'en rendre
-- compte, ni côté caisse ni côté serveur.
--
-- ── Ce qu'on journalise à la place : L'ENSEMBLE, par produit ───────────────
--
-- Une entrée = « voici TOUS les groupes du produit X, maintenant ». La clé est
-- `product_id`, qui est bien un uuid ; la charge utile porte la liste complète.
--
-- Trois propriétés qu'on ne veut pas perdre :
--
--   • IDEMPOTENT — rejouer la même entrée redonne le même état ;
--   • AUTO-RÉPARATEUR — quoi qu'une tablette ait accumulé avant, appliquer
--     l'ensemble la remet d'aplomb. C'est ce qui rattrape les terminaux déjà
--     en service, qui n'ont jamais reçu ces lignes ;
--   • le RETRAIT se transmet. Avec des lignes individuelles, détacher un
--     groupe aurait produit un `delete` que la caisse aurait dû savoir
--     interpréter ; ici, le groupe disparaît simplement de l'ensemble.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- `coalesce(new, old)` : au DELETE, seule l'ancienne ligne existe, et c'est
  -- elle qui porte le produit dont l'ensemble vient de changer.
  ligne := coalesce(new, old);

  -- L'état APRÈS la modification — le déclencheur est `after`, la table le
  -- reflète déjà. Un ensemble vide est une valeur légitime : c'est ce qui
  -- retire le dernier groupe d'un produit.
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
    -- La clé est le PRODUIT : c'est lui dont l'ensemble est décrit.
    ligne.product_id,
    -- Toujours `update` : une entrée décrit un ÉTAT, jamais une opération.
    -- `insert` ou `delete` laisseraient croire à la caisse qu'elle doit
    -- ajouter ou retirer une ligne, alors qu'elle doit remplacer l'ensemble.
    'update',
    jsonb_build_object('product_id', ligne.product_id, 'groupes', groupes)
  );
  return ligne;
end;
$$;

comment on function kaissi.journalise_modificateurs_produit() is
  'Fait descendre les groupes de modificateurs d''un produit, par ENSEMBLE et '
  'non ligne à ligne : product_modifiers est une table de liaison sans id, et '
  'un ensemble se rejoue sans risque de moitié manquante.';

drop trigger if exists product_modifiers_change_log on kaissi.product_modifiers;

create trigger product_modifiers_change_log
  after insert or update or delete on kaissi.product_modifiers
  for each row execute function kaissi.journalise_modificateurs_produit();

-- ── Rattraper les terminaux DÉJÀ en service ───────────────────────────────
--
-- Sans cette ligne, les rattachements existants n'auraient aucune entrée de
-- journal : les caisses en clientèle continueraient de n'afficher aucun
-- supplément, indéfiniment — la panne étant précisément qu'aucune écriture
-- n'a jamais eu lieu sur cette table.
--
-- Un `update` sans effet suffit à réveiller le déclencheur. L'ensemble étant
-- idempotent, les entrées redondantes (une par ligne du même produit) sont
-- inoffensives : la dernière appliquée décrit le même état que la première.
update kaissi.product_modifiers set position = position;
