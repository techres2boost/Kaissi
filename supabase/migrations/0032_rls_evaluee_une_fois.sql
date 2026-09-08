-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0032 · `auth.uid()` évalué UNE fois, pas une fois par ligne
-- ═══════════════════════════════════════════════════════════════════════════
-- Signalé par l'analyseur de Supabase (`auth_rls_initplan`), et confirmé par
-- le plan d'exécution : deux politiques sur `kaissi.users` appellent
-- `auth.uid()` DANS leur prédicat, sans le sous-requêter. PostgreSQL le
-- réévalue alors pour CHAQUE ligne examinée.
--
-- ── Pourquoi cela compte ici précisément ─────────────────────────────────
--
-- `kaissi.users` est lue SANS FILTRE par le chargement des rapports : le
-- back-office demande tous les employés pour pouvoir nommer un vendeur, et
-- c'est RLS — pas un `where` — qui borne le résultat. C'est donc exactement
-- la table où le coût par ligne se multiplie, et sur le chemin le plus
-- fréquenté du back-office.
--
-- ── Ce que change `(select auth.uid())` ──────────────────────────────────
--
-- La sous-requête n'a pas de dépendance à la ligne courante : le planificateur
-- la reconnaît comme un « InitPlan », l'exécute UNE fois, et compare ensuite
-- une constante. Le prédicat est strictement le même — même résultat, mêmes
-- lignes rendues.
--
-- ⚠ Ce n'est PAS un relâchement de sécurité. `auth.uid()` lit un réglage de
--   session, constant pendant toute la requête : l'évaluer mille fois donne
--   mille fois la même valeur. On ne gagne pas en permissivité, seulement en
--   temps.
--
-- ── Ce que cette migration ne touche pas ─────────────────────────────────
--
-- `kaissi.acces_organisation()` et `kaissi.gere_utilisateur()` restent
-- appelées telles quelles : elles prennent la LIGNE en argument
-- (`organization_id`, `id`), donc leur résultat dépend d'elle. Les
-- sous-requêter serait faux, pas plus rapide.
--
-- ── LE GAIN MESURÉ, et il est petit ──────────────────────────────────────
--
-- Sur 40 000 lignes, rôle `authenticated`, contexte de session posé :
--
--     avant  3,628 ms
--     après  3,492 ms
--
-- Soit 4 % — dans le bruit de mesure. La raison est que `auth.uid()` est
-- déclarée `stable` : PostgreSQL met déjà en cache son résultat pour des
-- arguments identiques à l'intérieur d'une requête. Le « une fois par
-- ligne » de l'analyseur décrit le PLAN, pas le coût réel.
--
-- On applique quand même, pour une raison qui n'est pas la performance :
-- l'analyseur de Supabase doit rester LISIBLE. Un avertissement permanent
-- qu'on a décidé d'ignorer enterre celui qui, un jour, comptera vraiment.
-- Deux politiques, prédicat identique, risque nul.
--
-- En revanche, l'autre recommandation de l'analyseur — fusionner les
-- politiques permissives multiples sur 18 tables — a été MESURÉE puis
-- ÉCARTÉE : 3,569 ms contre 3,552 ms sur 50 000 produits. Réécrire dix-huit
-- politiques de sécurité pour zéro gain mesurable est un mauvais échange.
-- Voir `docs/audit-production.md`.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists users_lecture on kaissi.users;
create policy users_lecture on kaissi.users
  for select to authenticated, kaissi_device
  using (
    -- Seul changement : `(select auth.uid())` au lieu de `auth.uid()`.
    auth_user_id = (select auth.uid())
    or kaissi.acces_organisation(organization_id)
  );

drop policy if exists users_ecriture_soi on kaissi.users;
create policy users_ecriture_soi on kaissi.users
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

comment on policy users_lecture on kaissi.users is
  'Lecture des employés de MES établissements. `auth.uid()` est sous-requêté '
  'pour être évalué une seule fois par requête et non par ligne (0032) — le '
  'prédicat est inchangé.';
