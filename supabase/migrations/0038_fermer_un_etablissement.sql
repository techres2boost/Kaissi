-- ═══════════════════════════════════════════════════════════════════════════
-- 0038 — FERMER un établissement, et savoir depuis quand
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Ce qui existait, et ne servait à rien ──────────────────────────────────
--
-- `restaurants.status` porte depuis la 0002 les valeurs `actif`, `ferme` et
-- `suspendu`. Aucun code ne l'a JAMAIS lu — ni le back-office, ni le service
-- de synchronisation. Le basculer n'aurait donc rien changé : un établissement
-- « fermé » aurait continué d'accepter des appairages, et un administrateur
-- aurait cru avoir fermé quelque chose.
--
-- C'est le même défaut que les options de restauration avant la 0036 : une
-- colonne prête, et personne au bout.
--
-- ── Ce que FERMER veut dire, et ce que ça ne veut PAS dire ─────────────────
--
-- Fermer est un état ADMINISTRATIF, pas un interrupteur. Concrètement :
--
--   • aucun NOUVEL appairage — l'établissement disparaît de la liste proposée
--     au gérant, et le désigner explicitement est refusé, avec sa vraie raison ;
--   • le back-office le range à part, et le dit ;
--   • les données restent. Toutes.
--
-- Et surtout, ce que ça ne fait PAS : **les terminaux déjà appairés
-- continuent d'envoyer.** C'est délibéré et ce n'est pas une demi-mesure.
--
-- Une tablette garde ses ventes tant qu'elles ne sont pas accusées de
-- réception. Refuser ses envois parce que l'établissement vient d'être fermé,
-- ce serait perdre les encaissements de la dernière soirée — exactement ceux
-- de la journée où l'on ferme. Un rejet ne se réessaie jamais tout seul :
-- ces ventes ne remonteraient JAMAIS.
--
-- Fermer coupe donc l'entrée, pas la sortie. Pour arrêter un terminal, on
-- révoque son jeton — c'est un geste distinct, et qui se voit.
-- ═══════════════════════════════════════════════════════════════════════════

alter table kaissi.restaurants
  add column if not exists closed_at timestamptz;

comment on column kaissi.restaurants.closed_at is
  'Quand l''établissement a été fermé. Nul tant qu''il est actif. Informatif : '
  'c''est `status` qui fait foi — mais « fermé » sans date oblige à fouiller '
  'le journal d''audit pour répondre à « depuis quand ? ».';

comment on column kaissi.restaurants.status is
  'actif | ferme | suspendu. `ferme` coupe les NOUVEAUX appairages et range '
  'l''établissement à part au back-office ; les terminaux déjà appairés '
  'continuent d''envoyer, sans quoi les ventes de la dernière soirée seraient '
  'perdues — un rejet ne se réessaie jamais tout seul.';

-- ── Pourquoi il n'y a RIEN ici sur la suppression ──────────────────────────
--
-- Parce que la base la refuse déjà, et bien mieux qu'une règle applicative ne
-- le ferait. Les tables transactionnelles référencent l'établissement en
-- `on delete restrict` depuis la migration 0004 : `orders`, `order_events`,
-- `order_items`, `payments`, `refunds`, `shifts`, `cash_movements`,
-- `kitchen_ready`, et `audit_events` depuis la 0006.
--
-- Autrement dit : **un établissement qui a vendu ne se supprime pas.** La
-- contrainte tient cette promesse même si quelqu'un écrit un jour un script
-- qui l'oublie — et c'est la bonne place pour elle, parce que détruire des
-- écritures comptables ne doit pas dépendre de la vigilance d'un `where`.
--
-- Ce qui MANQUAIT n'était donc pas la règle, mais le fait de la DIRE avant le
-- clic : sans écran, un administrateur recevait une violation de contrainte
-- brute — « update or delete on table "restaurants" violates foreign key
-- constraint » — qui ne nomme ni ce qui bloque, ni quoi faire à la place.
-- C'est `apps/backoffice/src/app/administration/actions.ts` qui s'en charge,
-- en comptant d'abord et en proposant la fermeture.
