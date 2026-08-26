-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0010 · Rétablit le search_path figé sur kaissi.uuid_v7()
-- ═══════════════════════════════════════════════════════════════════════════
-- Le linter de sécurité a de nouveau signalé un search_path mutable sur
-- cette fonction. Une fonction dont le chemin de recherche n'est pas figé
-- peut être détournée : un appelant crée un schéma dans son propre chemin
-- et y place une fonction homonyme.
--
-- `alter function ... set search_path` est idempotent : le rejouer ne coûte
-- rien et garantit l'état voulu quelle que soit l'histoire de la base.
-- ═══════════════════════════════════════════════════════════════════════════

alter function kaissi.uuid_v7() set search_path = '';
