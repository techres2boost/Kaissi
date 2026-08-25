-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0007 · Jeu de démonstration
-- ═══════════════════════════════════════════════════════════════════════════
-- Un établissement fictif « Snack Lac 1 » avec une carte réaliste, pour que
-- le POS ait quelque chose à afficher dès le premier lancement et que le
-- mode avion soit testable sans back-office.
--
-- Identifiants FIXES (forme UUIDv7 valide) : le POS les embarque dans sa
-- graine locale. Insertion idempotente — rejouer ce fichier ne double rien.
--
-- ⚠ Les taux de TVA ci-dessous sont des valeurs de DÉMONSTRATION. Les taux
--   réellement applicables à la restauration en Tunisie doivent être validés
--   par un expert-comptable avant toute mise en production.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_org    uuid := '01930000-0000-7000-8000-000000000001';
  v_resto  uuid := '01930000-0000-7000-8000-000000000002';
  v_device uuid := '01930000-0000-7000-8000-000000000003';
  v_tva19  uuid := '01930000-0000-7000-8000-000000000010';
  v_tva13  uuid := '01930000-0000-7000-8000-000000000011';
  v_tva07  uuid := '01930000-0000-7000-8000-000000000012';
  v_cat_plats  uuid := '01930000-0000-7000-8000-000000000020';
  v_cat_snacks uuid := '01930000-0000-7000-8000-000000000021';
  v_cat_boiss  uuid := '01930000-0000-7000-8000-000000000022';
  v_cat_desse  uuid := '01930000-0000-7000-8000-000000000023';
  v_st_cuisine uuid := '01930000-0000-7000-8000-000000000030';
  v_st_bar     uuid := '01930000-0000-7000-8000-000000000031';
  v_salle      uuid := '01930000-0000-7000-8000-000000000040';
  v_terrasse   uuid := '01930000-0000-7000-8000-000000000041';
  v_grp_cuisson uuid := '01930000-0000-7000-8000-000000000050';
  v_grp_supp    uuid := '01930000-0000-7000-8000-000000000051';
begin
  insert into kaissi.organizations (id, name, slug, country, currency, currency_exponent, plan)
  values (v_org, 'Res2Boost Démo', 'res2boost-demo', 'TN', 'TND', 3, 'essai')
  on conflict (id) do nothing;

  insert into kaissi.restaurants
    (id, organization_id, name, slug, timezone, address, phone,
     service_rate_bp, service_taxable, stamp_duty_millimes)
  values
    (v_resto, v_org, 'Snack Lac 1', 'snack-lac-1', 'Africa/Tunis',
     'Rue du Lac Turkana, Les Berges du Lac, Tunis', '+216 71 000 000',
     0, false, 0)
  on conflict (id) do nothing;

  -- Un appareil de démonstration. Le jeton n'existe pas : la coque POS de la
  -- Phase 0 ne parle à aucun serveur, elle lit uniquement son SQLite local.
  insert into kaissi.devices
    (id, organization_id, restaurant_id, label, type, ticket_prefix, token_hash, app_version)
  values
    (v_device, v_org, v_resto, 'Caisse 1 (démo)', 'pos', 'P1',
     'demo-non-appaire-aucun-jeton-valide', '0.1.0')
  on conflict (id) do nothing;

  -- ── Taux de TVA ─────────────────────────────────────────────────────────
  -- Points de base entiers. Prix carte TTC (is_included = true), usage
  -- courant en restauration : le client voit le prix qu'il paie.
  insert into kaissi.tax_rates (id, organization_id, restaurant_id, name, rate_bp, is_included, is_default)
  values
    (v_tva19, v_org, v_resto, 'TVA 19 %', 1900, true, true),
    (v_tva13, v_org, v_resto, 'TVA 13 %', 1300, true, false),
    (v_tva07, v_org, v_resto, 'TVA 7 %',   700, true, false)
  on conflict (id) do nothing;

  -- ── Stations d'impression ───────────────────────────────────────────────
  insert into kaissi.stations (id, organization_id, restaurant_id, name, printer_host, printer_port, position)
  values
    (v_st_cuisine, v_org, v_resto, 'Cuisine', '192.168.1.50', 9100, 1),
    (v_st_bar,     v_org, v_resto, 'Bar',     '192.168.1.51', 9100, 2)
  on conflict (id) do nothing;

  -- ── Salle ───────────────────────────────────────────────────────────────
  insert into kaissi.areas (id, organization_id, restaurant_id, name, position)
  values
    (v_salle,    v_org, v_resto, 'Salle',    1),
    (v_terrasse, v_org, v_resto, 'Terrasse', 2)
  on conflict (id) do nothing;

  insert into kaissi.tables (id, organization_id, restaurant_id, area_id, label, seats)
  select
    ('01930000-0000-7000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid,
    v_org, v_resto,
    case when n <= 8 then v_salle else v_terrasse end,
    n::text,
    case when n % 3 = 0 then 4 else 2 end
  from generate_series(1, 12) as n
  on conflict (id) do nothing;

  -- ── Catégories ──────────────────────────────────────────────────────────
  insert into kaissi.categories (id, organization_id, restaurant_id, name, position, color)
  values
    (v_cat_plats,  v_org, v_resto, 'Plats',    1, '#C2410C'),
    (v_cat_snacks, v_org, v_resto, 'Snacks',   2, '#B45309'),
    (v_cat_boiss,  v_org, v_resto, 'Boissons', 3, '#0E7490'),
    (v_cat_desse,  v_org, v_resto, 'Desserts', 4, '#9333EA')
  on conflict (id) do nothing;

  -- ── Carte ───────────────────────────────────────────────────────────────
  -- Prix en MILLIMES : 14500 = 14,500 TND.
  insert into kaissi.products
    (id, organization_id, restaurant_id, category_id, station_id, tax_rate_id,
     name, base_price_millimes, position, track_stock)
  values
    ('01930000-0000-7000-8000-000000000200', v_org, v_resto, v_cat_plats, v_st_cuisine, v_tva19, 'Pizza Margherita',      14500,  1, true),
    ('01930000-0000-7000-8000-000000000201', v_org, v_resto, v_cat_plats, v_st_cuisine, v_tva19, 'Pizza Quatre Fromages', 18500,  2, true),
    ('01930000-0000-7000-8000-000000000202', v_org, v_resto, v_cat_plats, v_st_cuisine, v_tva19, 'Escalope panée frites', 16000,  3, true),
    ('01930000-0000-7000-8000-000000000203', v_org, v_resto, v_cat_plats, v_st_cuisine, v_tva19, 'Couscous poulet',       19000,  4, true),
    ('01930000-0000-7000-8000-000000000204', v_org, v_resto, v_cat_plats, v_st_cuisine, v_tva19, 'Ojja merguez',          13500,  5, true),
    ('01930000-0000-7000-8000-000000000210', v_org, v_resto, v_cat_snacks, v_st_cuisine, v_tva19, 'Sandwich thon',         8500,  1, true),
    ('01930000-0000-7000-8000-000000000211', v_org, v_resto, v_cat_snacks, v_st_cuisine, v_tva19, 'Chapati poulet',        9500,  2, true),
    ('01930000-0000-7000-8000-000000000212', v_org, v_resto, v_cat_snacks, v_st_cuisine, v_tva19, 'Libanais viande',      11000,  3, true),
    ('01930000-0000-7000-8000-000000000213', v_org, v_resto, v_cat_snacks, v_st_cuisine, v_tva19, 'Frites',                4500,  4, false),
    ('01930000-0000-7000-8000-000000000220', v_org, v_resto, v_cat_boiss, v_st_bar, v_tva07, 'Eau minérale 50cl',          1500,  1, false),
    ('01930000-0000-7000-8000-000000000221', v_org, v_resto, v_cat_boiss, v_st_bar, v_tva07, 'Coca-Cola 33cl',             4200,  2, false),
    ('01930000-0000-7000-8000-000000000222', v_org, v_resto, v_cat_boiss, v_st_bar, v_tva07, 'Boga Cidre 33cl',            4200,  3, false),
    ('01930000-0000-7000-8000-000000000223', v_org, v_resto, v_cat_boiss, v_st_bar, v_tva13, 'Express',                    2800,  4, false),
    ('01930000-0000-7000-8000-000000000224', v_org, v_resto, v_cat_boiss, v_st_bar, v_tva13, 'Capucin',                    3200,  5, false),
    ('01930000-0000-7000-8000-000000000225', v_org, v_resto, v_cat_boiss, v_st_bar, v_tva13, 'Thé à la menthe',            2500,  6, false),
    ('01930000-0000-7000-8000-000000000230', v_org, v_resto, v_cat_desse, v_st_bar, v_tva13, 'Tiramisu',                   6500,  1, false),
    ('01930000-0000-7000-8000-000000000231', v_org, v_resto, v_cat_desse, v_st_bar, v_tva13, 'Salade de fruits',           5500,  2, false)
  on conflict (id) do nothing;

  -- ── Variantes (tailles) ─────────────────────────────────────────────────
  insert into kaissi.product_variants
    (id, organization_id, restaurant_id, product_id, name, price_delta_millimes, position)
  values
    ('01930000-0000-7000-8000-000000000300', v_org, v_resto, '01930000-0000-7000-8000-000000000200', 'Moyenne',       0, 1),
    ('01930000-0000-7000-8000-000000000301', v_org, v_resto, '01930000-0000-7000-8000-000000000200', 'Grande',     5000, 2),
    -- Delta NÉGATIF : une petite portion coûte moins cher que la référence.
    ('01930000-0000-7000-8000-000000000302', v_org, v_resto, '01930000-0000-7000-8000-000000000213', 'Petite',    -1500, 1),
    ('01930000-0000-7000-8000-000000000303', v_org, v_resto, '01930000-0000-7000-8000-000000000213', 'Normale',       0, 2)
  on conflict (id) do nothing;

  -- ── Groupes de modificateurs ────────────────────────────────────────────
  insert into kaissi.modifier_groups
    (id, organization_id, restaurant_id, name, min_select, max_select, is_required, position)
  values
    (v_grp_cuisson, v_org, v_resto, 'Cuisson',      1, 1, true,  1),
    (v_grp_supp,    v_org, v_resto, 'Suppléments',  0, 5, false, 2)
  on conflict (id) do nothing;

  insert into kaissi.modifiers
    (id, organization_id, restaurant_id, modifier_group_id, name, price_delta_millimes, position)
  values
    ('01930000-0000-7000-8000-000000000400', v_org, v_resto, v_grp_cuisson, 'Saignant',           0, 1),
    ('01930000-0000-7000-8000-000000000401', v_org, v_resto, v_grp_cuisson, 'À point',            0, 2),
    ('01930000-0000-7000-8000-000000000402', v_org, v_resto, v_grp_cuisson, 'Bien cuit',          0, 3),
    ('01930000-0000-7000-8000-000000000410', v_org, v_resto, v_grp_supp,    'Fromage',         1500, 1),
    ('01930000-0000-7000-8000-000000000411', v_org, v_resto, v_grp_supp,    'Œuf',             1000, 2),
    ('01930000-0000-7000-8000-000000000412', v_org, v_resto, v_grp_supp,    'Harissa',          500, 3),
    ('01930000-0000-7000-8000-000000000413', v_org, v_resto, v_grp_supp,    'Sans oignon',        0, 4)
  on conflict (id) do nothing;

  insert into kaissi.product_modifiers (organization_id, restaurant_id, product_id, modifier_group_id, position)
  values
    (v_org, v_resto, '01930000-0000-7000-8000-000000000200', v_grp_supp, 1),
    (v_org, v_resto, '01930000-0000-7000-8000-000000000201', v_grp_supp, 1),
    (v_org, v_resto, '01930000-0000-7000-8000-000000000202', v_grp_cuisson, 1),
    (v_org, v_resto, '01930000-0000-7000-8000-000000000210', v_grp_supp, 1),
    (v_org, v_resto, '01930000-0000-7000-8000-000000000211', v_grp_supp, 1),
    (v_org, v_resto, '01930000-0000-7000-8000-000000000212', v_grp_supp, 1)
  on conflict (product_id, modifier_group_id) do nothing;

  -- ── Modes de paiement ───────────────────────────────────────────────────
  insert into kaissi.payment_methods
    (id, organization_id, restaurant_id, name, type, opens_drawer, position)
  values
    ('01930000-0000-7000-8000-000000000500', v_org, v_resto, 'Espèces',       'cash',  true,  1),
    ('01930000-0000-7000-8000-000000000501', v_org, v_resto, 'Carte bancaire','card',  false, 2),
    ('01930000-0000-7000-8000-000000000502', v_org, v_resto, 'Chèque resto',  'other', false, 3)
  on conflict (id) do nothing;

  insert into kaissi.cash_registers (id, organization_id, restaurant_id, name)
  values ('01930000-0000-7000-8000-000000000600', v_org, v_resto, 'Caisse principale')
  on conflict (id) do nothing;
end
$$;
