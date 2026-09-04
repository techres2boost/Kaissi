-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0025 · Le bar est un poste, et le poste suit la CATÉGORIE
-- ═══════════════════════════════════════════════════════════════════════════
-- Deux changements qui vont ensemble : sans le second, le premier n'aurait
-- rien à afficher.
--
-- ── 1. Le rôle « bar » ────────────────────────────────────────────────────
--
-- La cuisine et le bar ne préparent pas les mêmes lignes de la même commande,
-- et ne veulent pas voir celles de l'autre. Un barman qui doit chercher ses
-- trois cafés au milieu de quinze plats les sert en retard.
--
-- Le rôle rejoint donc `cuisine` du côté PRÉPARATION : ni l'un ni l'autre ne
-- voit un montant. C'est une règle de métier, pas de confort — celui qui
-- prépare n'encaisse pas, et la caisse est ce qu'on protège.
--
-- ── 2. Le poste de préparation appartient à la catégorie ──────────────────
--
-- Il était porté par le PRODUIT. En pratique, un gérant qui crée « Mojito »
-- doit alors se souvenir de le rattacher au bar — et il l'oubliera, parce que
-- l'information est déjà dans la catégorie : les boissons vont au bar, les
-- plats à la cuisine. Un oubli est invisible jusqu'au service, où la ligne
-- n'apparaît sur AUCUN écran.
--
-- Porter le poste sur la catégorie supprime la question : elle est répondue
-- une fois pour « Boissons », et tous les produits qu'on y ajoutera ensuite
-- en héritent, y compris ceux créés dans six mois.
--
-- `products.station_id` n'est PAS supprimée — la règle des migrations
-- additives l'interdit tant que le protocole de sync supporte N−2, et un
-- terminal resté sur l'ancienne version écrit encore cette colonne. Elle
-- devient un REPLI : la résolution est « catégorie d'abord, produit ensuite ».
-- L'ordre compte, et il est le même partout (POS et serveur).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Le rôle « bar » ────────────────────────────────────────────────────────
alter table kaissi.memberships drop constraint if exists memberships_role_check;
alter table kaissi.memberships
  add constraint memberships_role_check
  check (role in ('admin', 'gerant', 'caissier', 'serveur', 'cuisine', 'bar'));

comment on column kaissi.memberships.role is
  'admin et gerant GÈRENT ; caissier et serveur ENCAISSENT ; cuisine et bar '
  'PRÉPARENT et ne voient aucun montant.';

-- ── Le poste de préparation, porté par la catégorie ───────────────────────
alter table kaissi.categories
  add column if not exists station_id uuid references kaissi.stations(id) on delete set null;

comment on column kaissi.categories.station_id is
  'Poste de préparation (cuisine, bar…) de TOUS les produits de cette '
  'catégorie. Source de vérité depuis la 0025 ; products.station_id ne sert '
  'plus que de repli pour les données antérieures.';

create index if not exists categories_station_idx
  on kaissi.categories (restaurant_id, station_id)
  where station_id is not null and archived_at is null;

-- ── Reprise des données existantes ────────────────────────────────────────
--
-- Le poste MAJORITAIRE parmi les produits de la catégorie. On ne devine pas
-- au hasard : si une catégorie mêle deux postes, c'est celui qui revient le
-- plus souvent qui gagne, et le gérant corrigera au back-office. Une
-- catégorie dont aucun produit n'a de poste reste nulle — mieux vaut « pas
-- réglé », qui se voit, qu'un réglage inventé, qui ne se voit pas.
update kaissi.categories c
   set station_id = majoritaire.station_id
  from (
    select distinct on (p.category_id)
           p.category_id, p.station_id, count(*) as n
      from kaissi.products p
     where p.station_id is not null
       and p.category_id is not null
       and p.archived_at is null
     group by p.category_id, p.station_id
     order by p.category_id, n desc, p.station_id
  ) as majoritaire
 where majoritaire.category_id = c.id
   and c.station_id is null;

-- ── Quel poste tient cet employé ? ────────────────────────────────────────
--
-- Un rôle `cuisine` ou `bar` ne suffit pas à désigner un ÉCRAN : un
-- établissement peut avoir deux cuisines (chaude et froide), et deux bars.
-- Deviner le poste en comparant le rôle au NOM de la station marcherait
-- jusqu'au jour où quelqu'un renomme « Bar » en « Comptoir » — et l'écran se
-- viderait sans que rien n'explique pourquoi.
--
-- L'appartenance porte donc le poste. Nulle, on retombe sur la station dont
-- le nom correspond au rôle : c'est le cas d'un petit établissement, qui n'a
-- rien à régler.
alter table kaissi.memberships
  add column if not exists station_id uuid references kaissi.stations(id) on delete set null;

comment on column kaissi.memberships.station_id is
  'Poste de préparation tenu par cet employé, pour les rôles cuisine et bar. '
  'Nul : on retombe sur la station dont le nom correspond au rôle.';
