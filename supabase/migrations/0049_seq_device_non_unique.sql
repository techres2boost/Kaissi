-- ═══════════════════════════════════════════════════════════════════════════
-- 0049 — `(device_id, seq_device)` n'est plus UNIQUE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PANNE OBSERVÉE EN PRODUCTION, le 23 octobre. Une caisse en démonstration
-- n'arrivait plus à remonter aucune vente : « Erreur. Le serveur répond,
-- mais n'a pas pu enregistrer ces opérations », 8 opérations en attente, 4
-- tentatives échouées, et dans les journaux Postgres, à chaque essai :
--
--     duplicate key value violates unique constraint
--     "order_events_device_id_seq_device_key"
--
-- ── L'enchaînement, et pourquoi il était INÉVITABLE ───────────────────────
--
--   1. `seq_device` est un compteur LOCAL, rangé dans `sync_state` de la
--      base SQLite de la tablette. Il part de 0 (migration locale 001).
--   2. Vider la base locale le remet donc à zéro. C'est le cas de
--      « Effacer et mettre en service », et de tout changement
--      d'établissement (`bascule-etablissement.ts`).
--   3. Mais le terminal garde son `installation_id`, et la migration 0021
--      rend alors le MÊME `device_id` — c'est voulu, et c'est ce qui évite
--      de créer un terminal de plus à chaque remise en service.
--
-- Résultat : un appareil déjà connu réémet `seq_device = 1, 2, 3…` avec des
-- `event_id` NEUFS. L'idempotence (`on conflict (event_id) do nothing`) ne
-- voit rien — ce ne sont pas des doublons — et c'est CETTE contrainte-ci qui
-- lève. L'insertion se fait dans une transaction : tout le lot tombe, y
-- compris les ventes saines, et la caisse réessaie pour toujours.
--
-- Autrement dit : une caisse réinitialisée ne pouvait plus JAMAIS remonter
-- une vente. Silencieusement, et définitivement.
--
-- ── Pourquoi on RETIRE l'unicité, au lieu de la contourner ────────────────
--
-- L'identité d'un événement est son `event_id` (RÈGLE 5) : c'est lui qui
-- porte l'idempotence, c'est lui la clé primaire, et il ne change jamais.
-- `seq_device` n'est qu'un ORDRE intra-appareil, utilisé comme dernier
-- critère de tri (`evenements.ts`, après `clientTs` et `deviceId`). Un
-- compteur répété après une réinitialisation rend cet ordre ambigu entre
-- deux VIES du même terminal — il ne rend rien faux : les événements d'une
-- commande sont ordonnés par `server_seq`, le seul ordre global (RÈGLE 4).
--
-- Désambiguïser le numéro à l'insertion (comme on le fait pour une collision
-- de `ticket_number`) a été écarté : le même événement redescendrait alors
-- par `/sync/pull` avec un `seq_device` DIFFÉRENT de celui que la tablette a
-- émis, et l'index unique LOCAL le ferait tomber dans le `INSERT OR IGNORE`
-- de la caisse — un événement venu du serveur, jeté en silence. La migration
-- locale 019 retire l'index local pour la même raison.
--
-- Garder la cause sous contrôle, c'est l'affaire de l'APPAIRAGE : le serveur
-- rend désormais le plus haut `seq_device` qu'il connaît pour ce terminal, et
-- la caisse reprend son compteur au-dessus. Même principe que le préfixe de
-- tickets — le serveur fait autorité, le POS adopte.
--
-- L'index, lui, RESTE : il sert aux lectures par appareil.

alter table kaissi.order_events
  drop constraint if exists order_events_device_id_seq_device_key;

create index if not exists order_events_appareil_seq_idx
  on kaissi.order_events (device_id, seq_device);

comment on column kaissi.order_events.seq_device is
  'Ordre intra-appareil, informatif. PAS unique depuis 0049 : un terminal '
  'réinitialisé garde son device_id (0021) et repart à 1, et l''unicité '
  'bloquait alors TOUTES ses ventes, pour toujours. L''identité d''un '
  'événement est event_id (RÈGLE 5) ; l''ordre global est server_seq (RÈGLE 4).';

notify pgrst, 'reload schema';
