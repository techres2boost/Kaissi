-- ═══════════════════════════════════════════════════════════════════════════
-- Quelles migrations manquent à CETTE base ? — à coller dans le SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Aucune ligne : la base a tout ce que le service attend.
-- Une ligne par migration absente : coller supabase/migrations/<numéro>_*.sql,
-- dans l'ordre, puis Run. Lecture seule : cette requête ne modifie rien.
--
-- Mêmes sondes que le service au démarrage (apps/sync/src/schema-requis.ts),
-- qui fait foi : une migration ajoutée là doit l'être ici aussi.

select migration as "migration manquante" from (values
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
  ('0045', (exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'refunds' and column_name = 'order_id') and exists ( select 1 from pg_constraint where conname = 'order_events_type_check' and pg_get_constraintdef(oid) like '%refund.recorded%'))),
  ('0046', (exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'orders' and column_name = 'last_sent_seq') and exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'order_items' and column_name = 'sent_seq') and exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'kitchen_ready' and column_name = 'sent_seq'))),
  ('0047', exists (select 1 from information_schema.columns where table_schema = 'kaissi' and table_name = 'push_subscriptions' and column_name = 'alertes_preparation')),
  ('0048', exists (select 1 from pg_policies where schemaname = 'kaissi' and tablename = 'time_entries' and policyname = 'time_entries_correction_appareil'))
) as t(migration, presente) where not presente;
