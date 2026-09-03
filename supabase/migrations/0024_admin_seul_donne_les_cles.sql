-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 — Seul un administrateur donne les clés
--
-- Depuis la 0014, un gérant ne peut pas créer d'administrateur. Mais il
-- pouvait créer un GÉRANT — et un gérant voit tout l'argent, modifie la carte,
-- gère les employés et clôture les caisses. En pratique, la protection ne
-- protégeait donc rien : il suffisait d'un cran en dessous pour obtenir les
-- mêmes droits.
--
-- La ligne est déplacée là où elle a un sens. Un gérant EXPLOITE le
-- restaurant : catalogue, stock, rapports, embauche de caissiers, serveurs et
-- cuisine. Un administrateur décide QUI d'autre obtient ces pouvoirs.
--
-- C'est aussi ce qui rend la question « admin ou gérant ? » enfin
-- répondable : avant cette migration, les deux rôles étaient rigoureusement
-- équivalents partout sauf sur une ligne, ce qui n'est pas une distinction
-- mais un piège.
--
-- Le `using` de la politique porte sur le rôle ACTUEL de la ligne : un gérant
-- ne peut donc ni promouvoir quelqu'un, ni rétrograder un administrateur ou
-- un autre gérant, ni révoquer leur appartenance.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function kaissi.appartenance_autorisee(cible uuid, role_vise text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select kaissi.est_gestionnaire(cible)
     and (role_vise not in ('admin', 'gerant') or kaissi.est_administrateur(cible));
$$;

comment on function kaissi.appartenance_autorisee(uuid, text) is
  'Un gérant gère les rôles d''EXPLOITATION de son établissement — caissier, '
  'serveur, cuisine. Seul un administrateur accorde ou retire les rôles qui '
  'donnent accès à l''argent et à la configuration : « gerant » et « admin ». '
  'Le `using` de la politique portant sur le rôle actuel de la ligne, un '
  'gérant ne peut pas davantage rétrograder ou révoquer un pair.';

notify pgrst, 'reload schema';
