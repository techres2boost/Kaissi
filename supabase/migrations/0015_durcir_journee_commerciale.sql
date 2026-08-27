-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0015 · Épingler le search_path de journee_commerciale
-- ═══════════════════════════════════════════════════════════════════════════
-- La 0013 avait créé la fonction sans `set search_path`. Le linter de Supabase
-- le signale, et il a raison : une fonction dont le chemin de recherche suit
-- celui de l'appelant peut être détournée en créant un objet homonyme dans un
-- schéma placé devant. Le risque est faible ici — la fonction n'appelle que
-- des opérateurs natifs — mais la règle du dépôt (migration 0008) est que
-- TOUTE fonction épingle son chemin. Une exception tolérée est une exception
-- qui se multiplie.
--
-- Une migration publiée ne se modifie jamais : on en ajoute une.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function kaissi.journee_commerciale(
  instant timestamptz,
  fuseau text,
  bascule time
)
returns date
language sql
immutable
set search_path = ''
as $$
  select ((instant at time zone fuseau) - bascule)::date;
$$;

comment on function kaissi.journee_commerciale(timestamptz, text, time) is
  'Journée commerciale d''un horodatage. Une vente à 00h30 avec une bascule à '
  '04:00 appartient à la veille.';
