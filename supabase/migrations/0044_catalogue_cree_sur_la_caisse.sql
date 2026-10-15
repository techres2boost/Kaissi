-- ═══════════════════════════════════════════════════════════════════════════
-- 0044 — Créer une CATÉGORIE, une RÉDUCTION, un GROUPE de modificateurs
--        depuis la caisse — et rien de plus
-- ═══════════════════════════════════════════════════════════════════════════
-- La 0034 avait ouvert la seule INSERTION dans `products` : un plat du jour
-- se crée sans quitter la caisse. Cette migration étend EXACTEMENT la même
-- exception, et pas un pouce de plus, à trois autres entités du référentiel.
--
-- ── Ce qui est ouvert, et ce qui reste fermé ───────────────────────────────
--   • CRÉER une catégorie, une réduction, un groupe de modificateurs (avec
--     ses choix et son rattachement aux produits). Créer n'est pas écrire sur
--     un état partagé : deux caisses hors ligne créent deux lignes DISTINCTES,
--     avec leurs identifiants propres. Au pire deux fois le même nom, que le
--     back-office fusionne — un désagrément, pas une perte.
--   • un appareil ne MODIFIE toujours rien (prix, nom, min/max…) : une édition
--     hors ligne sur deux caisses exigerait le dernier-écrivain-gagne arbitré
--     par `(server_seq, device_id)`. On ne l'ajoute pas « en passant ».
--   • un appareil ne SUPPRIME ni n'ARCHIVE rien.
--   • le RATTACHEMENT produit ↔ groupe est additif, donc sûr : deux caisses
--     qui rattachent chacune un groupe au même produit produisent un produit
--     à deux groupes, sans conflit — comme deux articles sur la même table.
--
-- ── Pourquoi RLS, alors que le service vérifie déjà le rôle ────────────────
-- Deux questions différentes. QUI a le droit (gérant/admin) est relu EN BASE
-- par le service (`peutModifierCatalogue`), applicatif par nature : l'appareil
-- porte l'`employee_id` de qui demande, le service ne le croit pas. DANS QUEL
-- ÉTABLISSEMENT est une question de tenance, et celle-là ne dépend jamais d'un
-- `where` écrit à la main : les politiques ci-dessous la tranchent pour tout
-- le monde. Un défaut de filtrage applicatif ne peut pas créer chez le voisin.
--
-- `for insert` : pas de `using`, donc aucune ligne existante n'est atteignable
-- — ces politiques ne peuvent littéralement rien réécrire. Et `grant insert`
-- SEUL (ni update, ni delete) est la seconde serrure, celle qui tient même si
-- une politique était un jour réécrite.
-- ═══════════════════════════════════════════════════════════════════════════

create policy categories_creation_caisse on kaissi.categories
  for insert to kaissi_device
  with check (kaissi.acces_restaurant(restaurant_id));
grant insert on kaissi.categories to kaissi_device;

create policy discounts_creation_caisse on kaissi.discounts
  for insert to kaissi_device
  with check (kaissi.acces_restaurant(restaurant_id));
grant insert on kaissi.discounts to kaissi_device;

create policy modifier_groups_creation_caisse on kaissi.modifier_groups
  for insert to kaissi_device
  with check (kaissi.acces_restaurant(restaurant_id));
grant insert on kaissi.modifier_groups to kaissi_device;

create policy modifiers_creation_caisse on kaissi.modifiers
  for insert to kaissi_device
  with check (kaissi.acces_restaurant(restaurant_id));
grant insert on kaissi.modifiers to kaissi_device;

-- Le rattachement : le produit DOIT être de l'établissement. La contrainte de
-- clé étrangère le garantit déjà ; `acces_restaurant` garantit la tenance de
-- la ligne de liaison elle-même.
create policy product_modifiers_creation_caisse on kaissi.product_modifiers
  for insert to kaissi_device
  with check (kaissi.acces_restaurant(restaurant_id));
grant insert on kaissi.product_modifiers to kaissi_device;

comment on policy categories_creation_caisse on kaissi.categories is
  'Exception ÉTROITE (0044), jumelle de products_creation_caisse (0034) : la '
  'seule INSERTION. Ni update, ni delete, ni archivage — ceux-là restent au '
  'back-office et redescendent par change_log.';
