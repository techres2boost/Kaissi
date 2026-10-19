-- ═══════════════════════════════════════════════════════════════════════════
-- 0047 — La cuisine et le bar notifiés à l'ARRIVÉE d'une commande
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Demandé en démonstration : « le cuisinier ou le bar doit être alerté une
-- fois que la commande vient pour lui, par notification ». L'écran de
-- préparation sonne déjà quand il est ouvert ; un téléphone de cuisine posé
-- écran éteint, lui, ne sonnait pas.
--
-- Tout le canal existe depuis 0028 (alertes de stock) : abonnement d'un
-- NAVIGATEUR, clés VAPID dans le service de synchronisation, service worker
-- côté back-office. Il ne manque que de dire ce qu'un abonnement veut
-- recevoir — exactement ce que prévoyait le commentaire d'`alertes_stock` :
-- « le jour où d'autres alertes existent, elles s'ajoutent ici ».
--
-- Faux par défaut : aucun navigateur déjà abonné aux ruptures ne se met à
-- sonner pour chaque commande sans l'avoir demandé.
--
-- Le POSTE est relu à l'envoi, dans `memberships.station_id` (0025) : le
-- barman ne reçoit que ce qui part au bar. Jamais par le NOM du poste.

alter table kaissi.push_subscriptions
  add column if not exists alertes_preparation boolean not null default false;

comment on column kaissi.push_subscriptions.alertes_preparation is
  'Ce navigateur veut être notifié à chaque envoi en cuisine qui concerne son '
  'poste (0047). Faux par défaut : on ne se met pas à sonner sans l''avoir demandé.';
