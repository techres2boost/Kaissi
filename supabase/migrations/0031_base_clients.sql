-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0031 · La base clients, et ce qu'elle sait de leurs visites
-- ═══════════════════════════════════════════════════════════════════════════
-- `orders.customer_id` existait depuis la 0004, sans table en face : on avait
-- prévu la place, jamais le contenu. Cette migration la remplit.
--
-- ── Ce que cette table est, et ce qu'elle n'est PAS ───────────────────────
--
-- C'est un CARNET D'ADRESSES, pas un programme de fidélité. Un nom, un
-- téléphone, éventuellement un e-mail : de quoi rappeler quelqu'un pour une
-- commande à emporter, ou reconnaître un habitué. Les points de fidélité, les
-- cartes, les paliers viendront peut-être — ils demandent des règles de
-- gestion qu'un restaurateur doit choisir, pas une colonne de plus.
--
-- ── Les visites se CALCULENT, elles ne se comptent pas ────────────────────
--
-- « Total des visites » et « Total dépensé » sont une vue sur `orders`, jamais
-- des compteurs qu'un déclencheur incrémenterait. C'est la même décision que
-- pour le stock (0019), et pour la même raison : la reprojection serveur
-- réécrit toutes les lignes d'une commande à chaque nouvel événement. Un
-- compteur devrait défaire exactement ce qu'il a fait, y compris quand la
-- commande passe « annulée » entre-temps. Il dériverait en silence, et
-- personne ne saurait dire depuis quand.
--
-- ── Pourquoi c'est du RÉFÉRENTIEL, donc synchronisé ───────────────────────
--
-- Parce qu'on rattache un client à une commande sur la CAISSE, et que la
-- caisse doit pouvoir le faire à 20 h sans réseau. La table descend donc par
-- `change_log`, comme le catalogue : aucune nouvelle voie de synchronisation.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists kaissi.customers (
  -- RÈGLE 2 : UUIDv7. Un client se crée aussi bien au back-office que sur une
  -- tablette hors ligne — c'est même le cas le plus fréquent, au moment de
  -- prendre une commande à emporter.
  id              uuid        primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 120),
  -- Le téléphone est le vrai identifiant d'un client de restaurant : deux
  -- « Salem » ne se distinguent que par lui.
  phone           text        check (phone is null or length(btrim(phone)) between 4 and 30),
  email           text        check (email is null or position('@' in email) > 1),
  -- « Allergique aux fruits de mer », « table 12 de préférence ». Ce que le
  -- gérant note pour le service, pas un champ de segmentation.
  note            text        check (note is null or length(note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

comment on table kaissi.customers is
  'Carnet d''adresses des clients de l''établissement. Les visites et le total '
  'dépensé ne sont PAS stockés ici : ils se calculent sur orders (vue '
  'kaissi.clients_visites).';

/*
 * Un même numéro ne désigne qu'une personne, par établissement.
 *
 * L'index est PARTIEL : il ne tient ni les fiches sans téléphone — un client
 * de passage dont on n'a que le prénom reste légitime — ni les fiches
 * archivées, sinon on ne pourrait jamais réinscrire quelqu'un qu'on a retiré.
 * La contrainte est par restaurant et non par organisation : le même client
 * peut fréquenter deux établissements du groupe, et chacun tient son carnet.
 */
create unique index if not exists customers_telephone_idx
  on kaissi.customers (restaurant_id, phone)
  where phone is not null and archived_at is null;

create index if not exists customers_restaurant_idx
  on kaissi.customers (restaurant_id, name)
  where archived_at is null;

select kaissi.protege_referentiel('customers');

drop trigger if exists customers_updated_at on kaissi.customers;
create trigger customers_updated_at
  before update on kaissi.customers
  for each row execute function kaissi.touche_updated_at();

-- Journalisée comme le reste du catalogue : la caisse la reçoit par le même
-- curseur `seq`, sans nouvelle route ni nouveau flux.
drop trigger if exists customers_change_log on kaissi.customers;
create trigger customers_change_log
  after insert or update or delete on kaissi.customers
  for each row execute function kaissi.journalise_changement();

-- ── La trace dans la vente ─────────────────────────────────────────────────
-- `customer_id` existait déjà (0004) mais sans clé étrangère : rien
-- n'empêchait d'y écrire n'importe quoi. `on delete set null` plutôt que
-- `restrict` — supprimer une fiche client ne doit jamais empêcher de relire
-- une vente. Elle perd son nom, pas son montant.
alter table kaissi.orders
  drop constraint if exists orders_customer_id_fkey;
alter table kaissi.orders
  add constraint orders_customer_id_fkey
  foreign key (customer_id) references kaissi.customers(id) on delete set null;

-- Le nom AU MOMENT de la vente, comme `discount_label` (0030) : renommer une
-- fiche ne doit pas réécrire un reçu déjà remis au client.
alter table kaissi.orders
  add column if not exists customer_name text;

comment on column kaissi.orders.customer_name is
  'Le nom du client au moment de la vente. Recopié, jamais joint : corriger '
  'une fiche l''an prochain ne doit pas réécrire un reçu de cette année.';

create index if not exists orders_client_idx
  on kaissi.orders (restaurant_id, customer_id, closed_at)
  where customer_id is not null;

-- ── Les visites, CALCULÉES ─────────────────────────────────────────────────
-- Première visite, dernière visite, nombre de visites, total dépensé — les
-- quatre colonnes de l'écran, et rien de plus. Seules les commandes CLOSES
-- comptent : une commande ouverte n'est pas une visite, elle est en cours ;
-- une commande annulée n'en est plus une.
create or replace view kaissi.clients_visites as
  select
    c.id                                        as customer_id,
    c.organization_id,
    c.restaurant_id,
    min(o.closed_at)                            as premiere_visite,
    max(o.closed_at)                            as derniere_visite,
    count(o.id)                                 as visites,
    coalesce(sum(o.total_millimes), 0)::bigint  as depense_millimes
  from kaissi.customers c
  left join kaissi.orders o
    on o.customer_id = c.id
   and o.restaurant_id = c.restaurant_id
   and o.status = 'close'
  group by c.id, c.organization_id, c.restaurant_id;

comment on view kaissi.clients_visites is
  'Visites et total dépensé, CALCULÉS sur orders — jamais des compteurs. Un '
  'compteur devrait défaire ce qu''il a fait à chaque reprojection, y compris '
  'quand une commande passe « annulée », et dériverait en silence.';

/*
 * La vue hérite de la RLS de `customers` et de `orders`.
 *
 * `security_invoker` est ce qui le garantit : sans lui, une vue s'exécute
 * avec les droits de son PROPRIÉTAIRE, et rendrait les clients de tous les
 * établissements à qui saurait son nom. Une seule ligne, et c'est toute la
 * séparation entre clients qui tombe.
 */
alter view kaissi.clients_visites set (security_invoker = on);

grant select on kaissi.clients_visites to authenticated, kaissi_device;

notify pgrst, 'reload schema';
