-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0012 · Exposer le schéma kaissi à l'API REST, sous RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- Le back-office lit et écrit le référentiel depuis Next.js. Deux chemins
-- étaient possibles :
--
--   a) une connexion PostgreSQL directe depuis les fonctions Vercel — mais
--      elles démarrent à froid et ne réutilisent pas leurs connexions, ce qui
--      est exactement le motif pour lequel docs/deploiement.md refuse Vercel
--      pour l'API de synchronisation ;
--   b) l'API REST de Supabase, avec la CLÉ PUBLIQUE et la session de
--      l'utilisateur — donc entièrement soumise à RLS.
--
-- (b) est retenu. C'est la « décision explicite » que le socle appelait : le
-- schéma `public` reste vide, et `kaissi` devient joignable UNIQUEMENT par
-- des rôles qui passent par les politiques.
--
-- Ce que cela n'ouvre pas : `anon` ne reçoit aucun privilège ici. Un visiteur
-- non authentifié ne peut lire aucune ligne, de aucune table. Et les REVOKE
-- d'immuabilité sur order_events et audit_events restent en vigueur — l'API
-- REST ne les contourne pas, elle emprunte les mêmes rôles.
-- ═══════════════════════════════════════════════════════════════════════════

-- PostgREST ne sert que les schémas qu'on lui nomme. Sans cette ligne, toute
-- requête du back-office répondrait « The schema must be one of the following »
-- — un message qui ne dit pas qu'il manque une configuration.
--
-- ⚠ Le tableau de bord Supabase (Settings → API → Exposed schemas) écrit la
--   même variable. S'il est modifié ensuite depuis l'interface, il écrase
--   cette valeur : il faut alors y ajouter « kaissi » à la main.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_schemas = ''public, graphql_public, kaissi''';
  end if;
end
$$;

-- Recharge la configuration sans redémarrage. Sans notification, le
-- changement n'est visible qu'au prochain redémarrage de PostgREST — et on
-- conclurait à tort que la migration n'a rien fait.
notify pgrst, 'reload config';

comment on schema kaissi is
  'Schéma applicatif Kaissi. Exposé à PostgREST pour le back-office, et '
  'protégé exclusivement par RLS : chaque table a ses politiques, aucune '
  'n''est lisible par le rôle anon.';
