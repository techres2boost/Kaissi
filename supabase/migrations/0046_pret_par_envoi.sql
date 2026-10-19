-- ═══════════════════════════════════════════════════════════════════════════
-- 0046 — « Prêt » couvre des ENVOIS, pas une commande pour toujours
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PANNE OBSERVÉE en démonstration. Table 1 : la cuisine prépare, marque
-- « prêt », la salle le voit. Le serveur ajoute deux plats à la même table et
-- les envoie en cuisine. La cuisine les reçoit… déjà cochés « prêt ». Ils ne
-- seront jamais préparés.
--
-- La cause : `kitchen_ready` (0018) est une ligne PAR COMMANDE. Une fois
-- posée, rien ne disait qu'un envoi postérieur la rendait caduque.
--
-- ── Le remède : un rang, pas une heure ───────────────────────────────────
--
-- Chaque envoi en cuisine est un événement `order.sent`, avec son
-- `server_seq` (RÈGLE 4 : l'ordre global attribué par le serveur, jamais une
-- horloge de tablette). On retient donc :
--
--   orders.last_sent_seq       le rang du DERNIER envoi de la commande ;
--   order_items.sent_seq       le rang de l'envoi qui a porté CETTE ligne ;
--   kitchen_ready.sent_seq     le rang jusqu'auquel la cuisine a dit « prêt ».
--
-- Une commande est prête si et seulement si
--     kitchen_ready.sent_seq >= orders.last_sent_seq
-- et une ligne est NOUVELLE pour la cuisine si
--     order_items.sent_seq > kitchen_ready.sent_seq.
--
-- Le « prêt » posé par la cuisine porte le rang qu'ELLE A VU à l'écran : un
-- envoi arrivé entre l'affichage et le clic n'est pas couvert, et la commande
-- reste à préparer. C'est la seule réponse juste à « prêt — mais quoi ? ».
--
-- `orders` et `order_items` sont des PROJECTIONS : leurs colonnes sont
-- recalculées depuis le journal à chaque reprojection. `kitchen_ready` n'en
-- est pas une : elle n'est jamais touchée par la reprojection (0018).
--
-- ── Ce que cette migration ne fait PAS ────────────────────────────────────
--
-- Aucune colonne existante n'est modifiée. Une caisse antérieure, qui ne
-- connaît pas `sent_seq`, l'ignore et garde l'ancien comportement.

alter table kaissi.orders
  add column if not exists last_sent_seq bigint;

alter table kaissi.order_items
  add column if not exists sent_seq bigint;

alter table kaissi.kitchen_ready
  add column if not exists sent_seq bigint;

comment on column kaissi.orders.last_sent_seq is
  'server_seq du dernier order.sent de la commande. Projection : recalculée '
  'à chaque reprojection. Comparée à kitchen_ready.sent_seq (0046).';
comment on column kaissi.order_items.sent_seq is
  'server_seq de l''envoi en cuisine qui a porté cette ligne ; nul tant '
  'qu''elle n''est pas partie. Sert à distinguer les plats NOUVEAUX (0046).';
comment on column kaissi.kitchen_ready.sent_seq is
  'Rang du dernier envoi que la cuisine avait À L''ÉCRAN quand elle a dit '
  '« prêt ». Un envoi postérieur rend la commande de nouveau à préparer.';

-- ── Reprise de l'existant ───────────────────────────────────────────────────
--
-- Le dernier envoi de chaque commande, depuis le journal qui fait foi.
update kaissi.orders o
   set last_sent_seq = s.dernier
  from (select order_id, max(server_seq) as dernier
          from kaissi.order_events
         where type = 'order.sent'
         group by order_id) s
 where s.order_id = o.id
   and o.last_sent_seq is distinct from s.dernier;

-- Un « prêt » déjà posé couvre les envois REÇUS AVANT lui : deux heures du
-- serveur comparées entre elles, jamais une horloge de tablette. Un envoi
-- arrivé après le « prêt » — exactement le cas de la panne — n'est pas
-- couvert, et la commande réapparaît en cuisine.
update kaissi.kitchen_ready k
   set sent_seq = coalesce(
         (select max(e.server_seq)
            from kaissi.order_events e
           where e.order_id = k.order_id
             and e.type = 'order.sent'
             and e.server_received_at <= k.ready_at),
         0)
 where k.sent_seq is null;
