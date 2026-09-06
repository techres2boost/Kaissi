-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0030 · Un référentiel de réductions, et leur trace dans la vente
-- ═══════════════════════════════════════════════════════════════════════════
-- L'écran « Réductions » dit COMBIEN a été accordé, et par qui. Il ne dit pas
-- POURQUOI : la caisse enregistrait un montant ou un pourcentage, jamais une
-- raison. « 12 % sur la table 4 » ne se juge pas — happy hour, geste
-- commercial, personnel de la maison : ce sont trois décisions différentes.
--
-- ── Ce que cette migration ajoute, et pourquoi deux choses ────────────────
--
-- `discounts` — le RÉFÉRENTIEL. Le gérant y déclare ses réductions
-- habituelles ; la caisse les propose, et le serveur n'a plus qu'à taper une
-- fois. C'est du catalogue : mêmes politiques, même journal `change_log`,
-- donc aucune nouvelle voie de synchronisation.
--
-- `orders.discount_id` / `order_items.discount_id` — la TRACE. Sans elle, le
-- référentiel ne servirait qu'à la saisie : le rapport continuerait de voir
-- des montants anonymes.
--
-- ── Le libellé est FIGÉ dans la vente, et c'est délibéré ──────────────────
--
-- `discount_label` recopie le nom au moment de l'encaissement. Renommer
-- « Happy hour » en « Heure creuse » l'an prochain ne doit pas réécrire ce
-- qu'on a accordé cette année — un rapport qui change quand on renomme un
-- réglage n'est plus un historique. L'identifiant, lui, permet de regrouper.
--
-- ── La valeur est en points de base OU en millimes, jamais les deux ───────
--
-- Une réduction est soit un pourcentage (`value_bp`, RÈGLE 1 : 10 % = 1000),
-- soit un montant fixe (`amount_millimes`). La contrainte l'impose : une
-- ligne qui porterait les deux laisserait la caisse choisir, et deux caisses
-- choisiraient différemment.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists kaissi.discounts (
  -- RÈGLE 2 : identifiant côté client. Une réduction se crée au back-office,
  -- mais elle descend dans un catalogue que la caisse recopie tel quel.
  id              uuid        primary key default kaissi.uuid_v7(),
  organization_id uuid        not null references kaissi.organizations(id) on delete cascade,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 60),
  -- 'pourcentage' ou 'montant' — le type décide laquelle des deux valeurs
  -- ci-dessous fait foi.
  kind            text        not null check (kind in ('pourcentage', 'montant')),
  -- Points de base ENTIERS : 10 % = 1000. Jamais 0.10 (RÈGLE 1).
  value_bp        integer     check (value_bp is null or (value_bp >= 0 and value_bp <= 10000)),
  -- Millimes entiers, comme tout montant du produit.
  amount_millimes bigint      check (amount_millimes is null or amount_millimes >= 0),
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,

  -- Exactement l'une des deux valeurs, jamais les deux, jamais aucune.
  constraint discounts_valeur_coherente check (
    (kind = 'pourcentage' and value_bp is not null and amount_millimes is null) or
    (kind = 'montant' and amount_millimes is not null and value_bp is null)
  )
);

comment on table kaissi.discounts is
  'Réductions habituelles de l''établissement — « Happy hour », '
  '« Personnel ». La caisse les propose ; le rapport les regroupe par MOTIF, '
  'ce qu''un montant anonyme ne permet pas.';
comment on column kaissi.discounts.value_bp is
  'Points de base entiers : 10 % = 1000 (RÈGLE 1). Nul pour un montant fixe.';

create index if not exists discounts_restaurant_idx
  on kaissi.discounts (restaurant_id, position)
  where archived_at is null;

-- Le jeu standard du référentiel : lecture pour les membres ET les appareils
-- (la caisse doit recopier le catalogue), écriture pour l'encadrement seul.
select kaissi.protege_referentiel('discounts');

create trigger discounts_updated_at
  before update on kaissi.discounts
  for each row execute function kaissi.touche_updated_at();

-- Journalisée comme le reste du catalogue : la caisse la reçoit par le même
-- curseur `seq`, sans nouvelle route ni nouveau flux.
create trigger discounts_change_log
  after insert or update or delete on kaissi.discounts
  for each row execute function kaissi.journalise_changement();

-- ── La trace dans la vente ─────────────────────────────────────────────────
alter table kaissi.orders
  add column if not exists discount_id    uuid references kaissi.discounts(id) on delete set null,
  add column if not exists discount_label text;

alter table kaissi.order_items
  add column if not exists discount_id    uuid references kaissi.discounts(id) on delete set null,
  add column if not exists discount_label text;

comment on column kaissi.orders.discount_label is
  'Le nom de la réduction AU MOMENT de la vente. Renommer la réduction plus '
  'tard ne réécrit pas l''historique — un rapport qui change quand on renomme '
  'un réglage n''est plus un historique.';

-- Le chemin du rapport : « ce qui a été accordé, par motif, sur la période ».
create index if not exists orders_reduction_idx
  on kaissi.orders (restaurant_id, discount_id)
  where discount_id is not null;

notify pgrst, 'reload schema';
