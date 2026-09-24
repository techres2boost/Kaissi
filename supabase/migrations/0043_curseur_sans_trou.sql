-- ═══════════════════════════════════════════════════════════════════════════
-- 0043 — Le curseur de synchronisation ne saute plus d'événement
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Le trou ───────────────────────────────────────────────────────────────
--
-- Une tablette tire `seq > curseur`, puis avance son curseur sur le plus grand
-- numéro reçu. C'est un compteur serveur, et non un horodatage, justement pour
-- ne rien sauter (system-design.md §12).
--
-- Mais PostgreSQL attribue le numéro d'une colonne d'identité au moment de
-- l'INSERTION, pas de la validation :
--
--   1. la transaction A insère et reçoit 100, sans valider tout de suite ;
--   2. la transaction B insère, reçoit 101, et valide ;
--   3. une tablette tire : elle voit 101 — A n'est pas encore visible — et
--      avance son curseur à 101 ;
--   4. A valide. La tablette tire `seq > 101`, et ne reçoit JAMAIS le 100.
--
-- Rien ne le rattrape. Le serveur a tout, donc les totaux du back-office sont
-- justes ; mais une tablette peut manquer pour toujours un article ajouté par
-- une autre sur une table partagée (`order_events`), ou un changement de prix
-- (`change_log`). Reproduit sur un vrai PostgreSQL, et éprouvé par
-- `apps/sync/test/curseur-sans-trou.test.ts`, qui échoue sans cette migration.
--
-- C'est le problème que DDIA décrit au ch. 9, « Total Order Broadcast » : un
-- journal de réplication doit être délivré dans l'ordre ET sans trous.
--
-- ── Le correctif : prendre le verrou, PUIS tirer le numéro ────────────────
--
-- Un déclencheur `before insert` sur chacun des deux journaux :
--
--   1. prend un verrou consultatif propre à l'ÉTABLISSEMENT, gardé jusqu'à la
--      fin de la transaction ;
--   2. tire alors seulement le numéro, en remplaçant celui que la valeur par
--      défaut avait déjà réservé.
--
-- Pour un établissement donné, deux transactions ne peuvent donc plus détenir
-- de numéro en même temps : la seconde attend que la première ait validé
-- avant de tirer le sien. L'ordre des numéros devient l'ordre des validations,
-- et un lecteur ne peut plus voir 101 tant que 100 est en vol.
--
-- ── Pourquoi retirer le numéro, et pas seulement verrouiller ──────────────
--
-- Parce que la valeur par défaut est calculée AVANT les déclencheurs
-- `before insert`. Un déclencheur qui ne ferait que verrouiller arriverait
-- trop tard : A tirerait 100, B tirerait 101, B obtiendrait le verrou le
-- premier — et le trou serait intact. On retire donc le numéro une fois le
-- verrou obtenu. Le numéro réservé par la valeur par défaut est perdu : les
-- numéros peuvent désormais SAUTER (100, 102, 104…). Ce n'est pas un trou de
-- livraison — aucun événement ne manque —, c'est une séquence qui n'est pas
-- contiguë, ce qu'elle n'a jamais été garantie d'être.
--
-- ── Pourquoi dans la base, et pas dans le code du service ─────────────────
--
-- `order_events` n'a qu'un écrivain aujourd'hui (`insererEvenements()`), mais
-- `change_log` en a SIX — les fonctions de journalisation, déclenchées depuis
-- le back-office, la caisse et le service. Mettre le verrou dans chacune, c'est
-- six copies à tenir d'accord, et la septième qu'on oubliera. Un déclencheur
-- sur la table elle-même couvre tous les écrivains, y compris ceux qui
-- n'existent pas encore.
--
-- ── Ce que le verrou coûte ────────────────────────────────────────────────
--
-- Deux envois d'un même établissement s'attendent l'un l'autre, le temps
-- d'une transaction d'insertion — quelques millisecondes. Deux établissements
-- différents ne s'attendent JAMAIS : la clé du verrou porte l'établissement.
-- Le test le mesure.
--
-- Et la caisse n'attend RIEN : elle encaisse dans sa base locale, et son envoi
-- part en arrière-plan. Ce verrou ralentit au pire la remontée d'un lot de
-- quelques millisecondes ; il ne touche aucun geste de vente.
--
-- Les deux journaux ont chacun leur clé : une transaction qui écrirait dans
-- les deux ne peut pas se bloquer elle-même, et aucune n'écrit aujourd'hui
-- dans les deux.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function kaissi.numerote_evenement_sous_verrou()
returns trigger
language plpgsql
-- `security definer` : l'envoi d'une caisse s'exécute sous `kaissi_device`,
-- qui n'a aucun droit direct sur la séquence — et n'a pas à en avoir.
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('kaissi:order_events:' || new.restaurant_id::text, 0)
  );
  new.server_seq := nextval(pg_get_serial_sequence('kaissi.order_events', 'server_seq'));
  return new;
end;
$$;

comment on function kaissi.numerote_evenement_sous_verrou() is
  'Tire order_events.server_seq SOUS un verrou par établissement, gardé jusqu''à '
  'la validation : l''ordre des numéros devient l''ordre des validations, et un '
  'curseur ne peut plus sauter un événement validé en retard (0043).';

create or replace function kaissi.numerote_changement_sous_verrou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('kaissi:change_log:' || new.restaurant_id::text, 0)
  );
  new.seq := nextval(pg_get_serial_sequence('kaissi.change_log', 'seq'));
  return new;
end;
$$;

comment on function kaissi.numerote_changement_sous_verrou() is
  'Tire change_log.seq SOUS un verrou par établissement, gardé jusqu''à la '
  'validation : un changement de catalogue validé en retard ne peut plus être '
  'sauté par une caisse (0043).';

-- Un déclencheur n'a pas besoin du droit d'exécution de celui qui insère.
revoke execute on function kaissi.numerote_evenement_sous_verrou() from public;
revoke execute on function kaissi.numerote_changement_sous_verrou() from public;

drop trigger if exists order_events_numerote_sous_verrou on kaissi.order_events;
create trigger order_events_numerote_sous_verrou
  before insert on kaissi.order_events
  for each row execute function kaissi.numerote_evenement_sous_verrou();

drop trigger if exists change_log_numerote_sous_verrou on kaissi.change_log;
create trigger change_log_numerote_sous_verrou
  before insert on kaissi.change_log
  for each row execute function kaissi.numerote_changement_sous_verrou();
