-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0018 · Écran de cuisine
-- ═══════════════════════════════════════════════════════════════════════════
-- Le MVP n'imprime pas. Le bon de cuisine papier est donc remplacé par un
-- ÉCRAN : la cuisine ouvre `/<restaurant>/cuisine` au back-office et voit les
-- commandes envoyées, les plus anciennes d'abord.
--
-- Ce qui alimente cet écran existe déjà et n'est pas touché ici :
--   • l'événement `order.sent`, écrit par le POS et poussé au serveur ;
--   • la projection `orders` (statut « envoyee ») et `order_items`.
--
-- Il ne manquait qu'une chose : mémoriser qu'un plat est PRÊT. Cet état-là
-- n'appartient pas au journal de la commande — il ne change ni ce qui est dû,
-- ni ce qui est vendu, et il est posé par un poste qui n'encaisse pas. Une
-- table à part, additive, évite d'étendre le protocole de synchronisation et
-- la contrainte de types d'`order_events` pour un marqueur d'organisation
-- interne.
--
-- Quand l'impression reviendra, cette table restera : un écran de cuisine et
-- un bon papier ne s'excluent pas, le second étant une commodité de service.
-- ═══════════════════════════════════════════════════════════════════════════

create table kaissi.kitchen_ready (
  -- La commande, et non la ligne : en MVP la cuisine annonce un plateau
  -- prêt, pas un plat. Passer à la ligne plus tard n'exigera qu'une colonne
  -- de plus et une nouvelle clé primaire — pas de réécriture de l'existant.
  order_id        uuid        primary key references kaissi.orders(id) on delete cascade,
  -- RÈGLE 3 : les deux identifiants de tenance, même redondants. C'est ce qui
  -- rend la politique RLS vérifiable sans jointure.
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  ready_at        timestamptz not null default now(),
  -- QUI a annoncé le plat prêt. Facultatif : un compte supprimé ne doit pas
  -- effacer le fait que la commande a été servie.
  ready_by        uuid        references kaissi.users(id) on delete set null
);

comment on table kaissi.kitchen_ready is
  'Marqueur « commande prête » posé depuis l''écran de cuisine du '
  'back-office. N''appartient PAS au journal de la commande : il ne change '
  'ni ce qui est dû, ni ce qui est vendu.';

-- LE chemin de l'écran de cuisine : « ce qui est prêt dans ce restaurant ».
create index kitchen_ready_resto_idx on kaissi.kitchen_ready (restaurant_id, ready_at desc);

-- RLS, jeu complet et standard : lecture et insertion pour les membres du
-- restaurant (tous rôles, y compris « cuisine »), correction réservée à
-- l'encadrement.
select kaissi.protege_transactionnel('kitchen_ready');

-- Suppression : le seul ajout au jeu standard.
--
-- Un « prêt » posé par erreur sur la mauvaise commande doit pouvoir être
-- retiré par la cuisine elle-même. Attendre un gérant pour défaire un clic
-- ferait sortir un plat en retard — et l'écran perdrait sa crédibilité dès
-- le premier service. Rien n'est perdu : ce marqueur n'est pas de la
-- comptabilité, et l'historique de la vente vit dans `order_events`, qui
-- reste en insertion seule.
create policy kitchen_ready_retrait on kaissi.kitchen_ready
  for delete to authenticated
  using (kaissi.acces_restaurant(restaurant_id));

grant delete on kaissi.kitchen_ready to authenticated;
