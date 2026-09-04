-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0026 · L'historique du stock devient consultable
-- ═══════════════════════════════════════════════════════════════════════════
-- `stock_movements` existe depuis la 0019 et enregistre déjà tout : quoi,
-- combien, pourquoi, par qui, et quand. Rien n'était perdu — mais rien
-- n'était MONTRÉ. Un gérant qui constate un écart devait ouvrir la base pour
-- savoir ce qui était entré et quand, ce qu'il ne fera jamais.
--
-- Il manquait une seule donnée pour que l'écran soit utile : DE QUI vient la
-- marchandise. « +12 le 3 septembre » ne se rapproche d'aucune facture ;
-- « +12 le 3 septembre, Sfax Primeurs » se rapproche tout seul.
--
-- ── Pourquoi un TEXTE et pas une table « fournisseurs » ───────────────────
--
-- Le champ est facultatif, et le restera : c'est une aide au rapprochement,
-- pas une gestion d'achats. Une table imposerait de créer un fournisseur
-- avant de saisir une réception — donc un formulaire de plus au moment où
-- quelqu'un décharge des cageots. Le jour où les achats deviennent un sujet
-- (commandes, prix négociés, encours), cette colonne se remplacera par une
-- clé étrangère, et les valeurs déjà saisies serviront à créer les lignes.
--
-- ── Le motif « correction » reste en base ─────────────────────────────────
--
-- Il disparaît de l'INTERFACE : entre « réception » et « perte », un troisième
-- motif fourre-tout attire tout ce qu'on n'a pas envie de qualifier, et
-- l'historique perd précisément ce qu'on lui demande. Mais la contrainte
-- garde la valeur : des lignes existantes la portent, et retirer une valeur
-- d'un `check` rendrait la table illisible pour son propre passé.
-- ═══════════════════════════════════════════════════════════════════════════

alter table kaissi.stock_movements
  add column if not exists supplier text
  check (supplier is null or length(btrim(supplier)) between 1 and 120);

comment on column kaissi.stock_movements.supplier is
  'Nom du fournisseur, FACULTATIF et libre. Sert à rapprocher une réception '
  'd''une facture. Deviendra une clé étrangère le jour où les achats seront '
  'gérés pour eux-mêmes.';

-- L'écran d'historique liste par établissement et par date décroissante.
-- L'index de la 0019 porte sur (product_id, created_at) : il ne sert pas
-- cette requête-là, qui ne filtre pas sur un produit.
create index if not exists stock_movements_restaurant_idx
  on kaissi.stock_movements (restaurant_id, created_at desc);
