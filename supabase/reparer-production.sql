-- ═══════════════════════════════════════════════════════════════════════════
-- RÉPARER LA PRODUCTION — à coller d'un bloc dans Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- À UTILISER QUAND : les caisses gardent leurs ventes (« ↑↓ N » qui ne
-- descend pas), l'écran Synchronisation dit « Erreur interne du serveur » ou
-- « la base de données du serveur n'est pas à jour », et rien n'arrive ni en
-- cuisine, ni au bar, ni au back-office.
--
-- CE QUE CE FICHIER FAIT :
--   1. applique la migration 0045 (le remboursement depuis la caisse), dont
--      le service a besoin à CHAQUE vente reçue ;
--   2. liste ensuite les migrations qui manqueraient ENCORE.
--
-- CE QU'IL NE TOUCHE PAS : aucune vente, aucun ticket, aucun compte. Il
-- n'ajoute que des colonnes et des index, et se rejoue sans dommage — le
-- relancer deux fois ne change rien.
--
-- APRÈS L'AVOIR LANCÉ : regarde le résultat en bas.
--   • « aucune — la base est à jour » → c'est bon. Sur la caisse,
--     ☰ → Synchronisation → « Ne pas attendre — envoyer maintenant ».
--     Les opérations en attente tombent à 0 et les ventes apparaissent,
--     sans rien ressaisir.
--   • une ou plusieurs lignes → applique ces migrations-là, dans l'ordre,
--     depuis supabase/migrations/, puis relance ce fichier.

alter table kaissi.refunds
  add column if not exists order_id  uuid references kaissi.orders(id) on delete cascade,
  add column if not exists type      text,
  add column if not exists items     jsonb not null default '[]'::jsonb,
  add column if not exists shift_id  uuid,
  add column if not exists device_id uuid;

create index if not exists refunds_commande_idx on kaissi.refunds (order_id);
create index if not exists refunds_restaurant_date_idx on kaissi.refunds (restaurant_id, created_at);

comment on column kaissi.refunds.order_id is
  'Commande remboursée. Projection de refund.recorded : reconstruite à chaque reprojection.';
comment on column kaissi.refunds.shift_id is
  'Service de caisse d''où l''argent est sorti — porté par l''événement, pas par la commande.';

alter table kaissi.order_events drop constraint if exists order_events_type_check;
alter table kaissi.order_events add constraint order_events_type_check check (type in (
  'order.opened', 'line.added', 'line.quantity_changed',
  'line.voided', 'line.note_set', 'discount.applied',
  'discount.removed', 'service.set', 'customer.attached',
  'table.moved', 'order.sent', 'payment.recorded',
  'payment.voided', 'order.closed', 'order.cancelled',
  'refund.recorded')) not valid;
alter table kaissi.order_events validate constraint order_events_type_check;

-- ═══════════════════════════════════════════════════════════════════════════
-- Reste-t-il une migration à appliquer ? — une seule ligne de réponse
-- ═══════════════════════════════════════════════════════════════════════════
-- Mêmes sondes que le service au démarrage (apps/sync/src/schema-requis.ts),
-- qui fait foi : une migration ajoutée là doit l'être ici aussi.

select case
         when count(*) = 0
           then 'aucune — la base est à jour. Sur la caisse : Synchronisation → envoyer maintenant.'
         else 'À APPLIQUER, dans l''ordre, depuis supabase/migrations/ : '
              || string_agg(migration, ', ' order by migration)
       end as "migrations manquantes"
  from (values
  ('0030', exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'orders' and column_name = 'discount_id')),
  ('0031', (to_regclass('kaissi.customers') is not null)),
  ('0032', exists (select 1 from pg_policies where schemaname = 'kaissi' and tablename = 'users' and policyname = 'users_lecture')),
  ('0033', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'kaissi' and p.proname = 'rapport_ventes')),
  ('0034', exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'sync_mutations' and column_name = 'kind')),
  ('0035', exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'restaurants' and column_name = 'receipt_footer')),
  ('0036', exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'restaurants' and column_name = 'service_tax_rate_id')),
  ('0037', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'kaissi' and p.proname = 'journalise_modificateurs_produit')),
  ('0038', exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'restaurants' and column_name = 'closed_at')),
  ('0039', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'kaissi' and p.proname = 'etablissement_vivant')),
  ('0040', (to_regclass('kaissi.subscriptions') is not null)),
  ('0041', ((to_regclass('kaissi.suppliers') is not null) and exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'stock_movements' and column_name = 'supplier_id'))),
  ('0042', exists (select 1 from pg_policies where schemaname = 'kaissi' and tablename = 'subscriptions' and policyname = 'subscriptions_lecture')),
  ('0043', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'kaissi' and p.proname = 'numerote_evenement_sous_verrou')),
  ('0044', exists (select 1 from pg_policies where schemaname = 'kaissi' and tablename = 'categories' and policyname = 'categories_creation_caisse')),
  ('0045', (exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'refunds' and column_name = 'order_id') and exists ( select 1 from pg_constraint where conname = 'order_events_type_check' and pg_get_constraintdef(oid) like '%refund.recorded%')))
) as t(migration, presente)
 where not presente;
