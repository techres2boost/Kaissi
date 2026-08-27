-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0013 · La journée commerciale ne commence pas à minuit
-- ═══════════════════════════════════════════════════════════════════════════
-- Un restaurant tunisien qui sert jusqu'à une heure du matin encaisse une
-- partie de sa soirée du vendredi APRÈS minuit. Découper le rapport sur le
-- jour calendaire couperait ce service en deux : le gérant verrait un
-- vendredi amputé et un samedi qui commence par des ventes qu'il ne
-- reconnaît pas. Pire, le rapprochement avec la clôture de caisse — qui,
-- elle, suit le shift — ne tomberait jamais juste.
--
-- On stocke donc l'heure à laquelle la journée commerciale bascule.
--
-- ⚠ La valeur par défaut (04:00) est un usage courant, pas une règle. Chaque
--   établissement doit la confirmer : un salon de thé qui ouvre à 06:00 la
--   voudra plus tôt.
-- ═══════════════════════════════════════════════════════════════════════════

alter table kaissi.restaurants
  add column if not exists business_day_start time not null default '04:00';

comment on column kaissi.restaurants.business_day_start is
  'Heure locale de bascule de la journée commerciale. Une vente encaissée '
  'avant cette heure appartient à la journée PRÉCÉDENTE. ⚠ À confirmer par '
  'établissement.';

-- ───────────────────────────────────────────────────────────────────────────
-- La journée commerciale d'un horodatage, dans le fuseau de l'établissement
-- ───────────────────────────────────────────────────────────────────────────
-- Écrite en SQL plutôt qu'en TypeScript parce qu'elle doit servir dans un
-- WHERE indexable côté serveur, et parce que la refaire dans chaque écran
-- garantirait qu'un écran finisse par la faire autrement.
create or replace function kaissi.journee_commerciale(
  instant timestamptz,
  fuseau text,
  bascule time
)
returns date
language sql
immutable
as $$
  select ((instant at time zone fuseau) - bascule)::date;
$$;

comment on function kaissi.journee_commerciale(timestamptz, text, time) is
  'Journée commerciale d''un horodatage. Une vente à 00h30 avec une bascule à '
  '04:00 appartient à la veille.';
