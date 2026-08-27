-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0016 · Aligner la démonstration sur la charte Res2Boost
-- ═══════════════════════════════════════════════════════════════════════════
-- La 0007 donnait aux quatre catégories de démonstration des couleurs vives
-- et sans rapport entre elles — orange, ambre, cyan, violet. Sur le fond vert
-- profond de la marque, l'écran de prise de commande ressemblait à un sapin
-- de Noël, et la première impression d'une démonstration client compte.
--
-- Les catégories doivent rester DISTINGUABLES d'un coup d'œil : on prend donc
-- trois valeurs différentes du vert de marque plus l'or, et non quatre nuances
-- voisines qu'un serveur confondrait en plein service.
--
-- Purement cosmétique, et strictement limité aux données de démonstration.
-- Un établissement réel choisit ses couleurs depuis le back-office.
--
-- Effet de bord voulu : ces UPDATE passent par le déclencheur de journal, donc
-- les tablettes déjà appairées reçoivent les nouvelles couleurs à leur
-- prochaine synchronisation. Aucun APK à reconstruire.
-- ═══════════════════════════════════════════════════════════════════════════

update kaissi.categories set color = '#7EC694', updated_at = now()
  where name = 'Plats'    and color = '#C2410C';
update kaissi.categories set color = '#9BE3AE', updated_at = now()
  where name = 'Snacks'   and color = '#B45309';
update kaissi.categories set color = '#4E9E77', updated_at = now()
  where name = 'Boissons' and color = '#0E7490';
update kaissi.categories set color = '#C9A86B', updated_at = now()
  where name = 'Desserts' and color = '#9333EA';
