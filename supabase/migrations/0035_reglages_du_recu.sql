-- ═══════════════════════════════════════════════════════════════════════════
-- 0035 — Les réglages du REÇU descendent enfin jusqu'à la caisse
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Ce qui manquait, et qui ne se voyait pas ───────────────────────────────
--
-- `kaissi.restaurants` porte depuis la 0002 l'adresse, le téléphone et
-- l'identifiant fiscal — c'est-à-dire l'en-tête du ticket client. Mais cette
-- table n'a JAMAIS eu de déclencheur `change_log` : elle ne fait pas partie du
-- référentiel qui descend. Le back-office pouvait donc écrire une adresse que
-- la caisse n'aurait jamais vue, et le ticket restait muet.
--
-- Personne ne l'avait signalé parce que le back-office n'offrait aucun écran
-- pour les saisir : un réglage qu'on ne peut pas modifier ne peut pas paraître
-- cassé.
--
-- ── Pourquoi un déclencheur DÉDIÉ, et pas celui du référentiel ─────────────
--
-- `kaissi.journalise_changement()` lit `ligne.restaurant_id`. `restaurants`
-- n'a pas cette colonne — son PROPRE identifiant est le restaurant. Réutiliser
-- la fonction générique échouerait à chaque écriture, sur toutes les
-- migrations qui touchent un établissement, avec un message qui ne nommerait
-- pas cette ligne-ci.
--
-- ── Ce que la caisse fait de ces valeurs, et ce qu'elle n'en fait pas ──────
--
-- Elle les IMPRIME, rien d'autre. `service_rate_bp`, `service_taxable` et
-- `stamp_duty_millimes` existent aussi dans cette table depuis la 0002, mais
-- aucun calcul ne les lit — ni côté caisse, ni côté serveur. Les faire
-- descendre ne les appliquerait pas ; les rendre modifiables sans les
-- appliquer donnerait un réglage qui ne fait rien. On ne touche pas à ces
-- trois-là ici.
--
-- ⚠ L'identifiant fiscal et les mentions obligatoires d'un reçu tunisien
--   restent à valider par un expert-comptable. Cette migration ouvre un
--   champ ; elle n'affirme ni son format, ni son obligation.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Le pied de page du ticket ─────────────────────────────────────────────
--
-- Texte LIBRE et multi-lignes, pas une liste de colonnes. « Merci de votre
-- visite ! », un horaire, une mention Wi-Fi : on ne sait pas d'avance ce
-- qu'un restaurateur veut y mettre, et un schéma qui le devine se corrige à
-- chaque client.
alter table kaissi.restaurants
  add column if not exists receipt_footer text;

comment on column kaissi.restaurants.receipt_footer is
  'Pied de page du ticket client, texte libre multi-lignes. Rendu tel quel '
  'par packages/domain/src/ticket.ts — une ligne par retour à la ligne.';

-- ── Le déclencheur, dédié ─────────────────────────────────────────────────
create or replace function kaissi.journalise_restaurant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pas de `coalesce(new, old)` : ce déclencheur ne voit jamais de DELETE,
  -- pour la raison écrite plus bas sur la clé étrangère de `change_log`.
  insert into kaissi.change_log
    (organization_id, restaurant_id, entity_type, entity_id, op, payload)
  values (
    new.organization_id,
    -- Le restaurant, c'est LUI. D'où le déclencheur dédié : la fonction
    -- générique cherche une colonne `restaurant_id` qui n'existe pas ici.
    new.id,
    'restaurants',
    new.id,
    lower(tg_op),
    to_jsonb(new)
  );
  return new;
end;
$$;

comment on function kaissi.journalise_restaurant() is
  'Fait descendre les réglages d''un établissement — en-tête et pied du reçu '
  '— par le même canal que le catalogue. Dédié parce que restaurants n''a pas '
  'de colonne restaurant_id : son propre id EST le restaurant.';

drop trigger if exists restaurants_change_log on kaissi.restaurants;

-- ⚠ INSERT et UPDATE seulement — surtout pas DELETE.
--
-- `change_log.restaurant_id` porte une clé étrangère vers `restaurants`.
-- Journaliser une suppression écrirait une ligne qui désigne l'établissement
-- qu'on est en train de supprimer : la contrainte la refuse, et c'est la
-- SUPPRESSION ENTIÈRE qui échoue. Découvert en faisant tourner la suite de
-- synchronisation — trois tests qui suppriment leur établissement de travail
-- se sont mis à échouer d'un coup, sur un message qui ne nomme pas ce
-- déclencheur.
--
-- Rien n'est perdu au passage : la descente du catalogue sert à faire
-- connaître un établissement à ses caisses, pas à leur apprendre qu'il
-- n'existe plus. Une caisse dont l'établissement disparaît a un problème
-- autrement plus grave qu'un nom périmé — son jeton ne vaut plus rien.
create trigger restaurants_change_log
  after insert or update on kaissi.restaurants
  for each row execute function kaissi.journalise_restaurant();

-- ── Une entrée pour l'existant ────────────────────────────────────────────
--
-- Sans cela, les établissements DÉJÀ créés n'auraient rien dans `change_log`
-- et leurs caisses n'apprendraient leur adresse qu'au premier changement —
-- c'est-à-dire peut-être jamais. Un `update` sans effet suffit à réveiller le
-- déclencheur, et l'idempotence du miroir rend la ligne inoffensive.
update kaissi.restaurants set updated_at = now();
