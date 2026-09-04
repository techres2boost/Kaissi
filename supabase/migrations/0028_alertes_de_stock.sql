-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0028 · Alerter quand un produit tombe en rupture
-- ═══════════════════════════════════════════════════════════════════════════
-- L'écran Stock dit déjà « rupture » et « stock faible ». Encore faut-il que
-- quelqu'un le regarde — et personne ne consulte un écran de stock en plein
-- service. L'information arrive donc trop tard : on s'aperçoit qu'il n'y a
-- plus d'Ojja quand un client en commande une.
--
-- L'alerte va donc CHERCHER le gérant, par notification et par e-mail.
--
-- ── Ce que cette migration crée, et pourquoi deux tables ──────────────────
--
-- `push_subscriptions` — l'abonnement d'un NAVIGATEUR, pas d'une personne.
-- Le même gérant a un téléphone et un ordinateur : ce sont deux abonnements,
-- et révoquer l'un ne doit pas taire l'autre. La clé est donc l'`endpoint`,
-- que le navigateur renouvelle tout seul et qui identifie le canal.
--
-- `stock_alerts` — le JOURNAL de ce qui a déjà été annoncé. Sans lui, le
-- balayage périodique réenverrait la même alerte toutes les demi-heures
-- jusqu'à la réception. Une alerte répétée n'est pas une alerte plus forte :
-- c'est une alerte qu'on coupe, et on coupe alors aussi les vraies.
--
-- ── Le secret VAPID n'est pas ici ─────────────────────────────────────────
--
-- Seule la clé PUBLIQUE circule jusqu'au navigateur ; la privée reste une
-- variable d'environnement du service de synchronisation. Une clé privée en
-- base serait lisible par toute personne ayant un accès en lecture, et
-- permettrait d'envoyer des notifications au nom de Kaissi.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists kaissi.push_subscriptions (
  id              uuid        primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  user_id         uuid        not null references kaissi.users(id) on delete cascade,
  -- L'adresse que le navigateur nous donne. C'est ELLE qui identifie le
  -- canal : le même employé sur deux appareils a deux lignes.
  endpoint        text        not null,
  -- Clés de chiffrement de l'abonnement, fournies par le navigateur. Elles
  -- ne servent qu'à chiffrer la charge utile POUR ce canal : elles ne
  -- donnent accès à rien d'autre.
  p256dh          text        not null,
  auth            text        not null,
  -- Ce que ce canal veut recevoir. Le jour où d'autres alertes existent,
  -- elles s'ajoutent ici plutôt que dans une table de plus.
  alertes_stock   boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Le navigateur peut réémettre le même endpoint : on met à jour, on ne
  -- duplique pas — sinon le gérant recevrait la même notification deux fois.
  unique (endpoint)
);

comment on table kaissi.push_subscriptions is
  'Abonnement d''un NAVIGATEUR aux notifications. Un employé sur deux '
  'appareils a deux lignes : révoquer l''une ne doit pas taire l''autre.';

create index if not exists push_subscriptions_restaurant_idx
  on kaissi.push_subscriptions (restaurant_id);

-- ───────────────────────────────────────────────────────────────────────────
create table if not exists kaissi.stock_alerts (
  id              uuid        primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  product_id      uuid        not null references kaissi.products(id) on delete cascade,
  -- 'rupture' (quantité <= 0) ou 'faible' (au seuil ou en dessous).
  niveau          text        not null check (niveau in ('rupture', 'faible')),
  -- La quantité AU MOMENT de l'alerte, pour que le message reste vrai même
  -- relu trois jours plus tard.
  qty             numeric     not null,
  envoyee_a       timestamptz not null default now(),
  -- Levée à la réception : c'est ce qui autorise une NOUVELLE alerte pour le
  -- même produit. Sans cette remise à zéro, un produit alerté une fois ne le
  -- serait plus jamais.
  resolue_a       timestamptz,
  canaux          text        not null default ''
);

comment on table kaissi.stock_alerts is
  'Journal des alertes DÉJÀ envoyées. Sans lui, le balayage périodique '
  'réenverrait la même alerte toutes les demi-heures : une alerte répétée '
  'n''est pas plus forte, c''est une alerte qu''on coupe.';

-- L'index qui sert la question du balayage : « ce produit a-t-il une alerte
-- encore ouverte ? ». Partiel sur les non résolues — les autres ne sont
-- consultées que par curiosité.
create unique index if not exists stock_alerts_ouverte_idx
  on kaissi.stock_alerts (product_id)
  where resolue_a is null;

create index if not exists stock_alerts_restaurant_idx
  on kaissi.stock_alerts (restaurant_id, envoyee_a desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- `stock_alerts` prend le jeu standard : c'est un journal que l'encadrement
-- consulte, au même titre que les mouvements de stock.
select kaissi.protege_transactionnel('stock_alerts');

-- `push_subscriptions` ne le prend PAS, et c'est délibéré.
--
-- Le jeu standard ouvre la lecture à tout membre de l'établissement. Or une
-- ligne contient `endpoint`, `p256dh` et `auth` : de quoi ENVOYER une
-- notification sur le téléphone d'un collègue. Ce n'est pas un secret
-- comparable à un mot de passe, mais ce n'est pas non plus une donnée
-- d'équipe — et il n'existe aucune raison qu'un caissier lise le canal du
-- gérant.
--
-- Chacun ne voit donc QUE ses propres abonnements. Le service de
-- synchronisation, lui, ne passe pas par ces politiques : il lit sous le
-- rôle `kaissi_device` avec le contexte d'établissement, exactement comme
-- pour le reste.
alter table kaissi.push_subscriptions enable row level security;
alter table kaissi.push_subscriptions force row level security;

drop policy if exists push_subscriptions_les_miens on kaissi.push_subscriptions;
create policy push_subscriptions_les_miens on kaissi.push_subscriptions
  for all to authenticated
  using (user_id = kaissi.employe_courant() and kaissi.acces_restaurant(restaurant_id))
  with check (user_id = kaissi.employe_courant() and kaissi.acces_restaurant(restaurant_id));

-- Le service de synchronisation ENVOIE : il lui faut la lecture, et la
-- suppression d'un canal que le navigateur a révoqué (410 Gone). Laisser une
-- ligne morte ferait retenter l'envoi à chaque balayage, indéfiniment.
drop policy if exists push_subscriptions_service on kaissi.push_subscriptions;
create policy push_subscriptions_service on kaissi.push_subscriptions
  for all to kaissi_device
  using (kaissi.acces_restaurant(restaurant_id))
  with check (kaissi.acces_restaurant(restaurant_id));

grant select, insert, update, delete on kaissi.push_subscriptions to authenticated;
grant select, delete on kaissi.push_subscriptions to kaissi_device;
-- La résolution d'une alerte est une écriture du SERVICE, pas d'un humain :
-- le jeu standard n'accorde `update` qu'à l'encadrement.
grant update on kaissi.stock_alerts to kaissi_device;
