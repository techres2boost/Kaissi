-- ═══════════════════════════════════════════════════════════════════════════
-- 0042 — La caisse ne lit pas les abonnements. Ni maintenant, ni plus tard.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La migration 0040 avait accordé `select` sur `kaissi.subscriptions` au rôle
-- `kaissi_device`, avec cette justification :
--
--   « l'écran Diagnostic de la caisse peut vouloir dire quelle formule est en
--     cours. Il ne s'en sert pour RIEN d'autre. »
--
-- ── Pourquoi c'était une erreur ───────────────────────────────────────────
--
-- « Peut vouloir » n'est pas un besoin, c'est une supposition. Aucune ligne du
-- POS ne lit cette table, et il n'y en a jamais eu.
--
-- Or ce privilège-là n'est pas anodin : c'est le SEUL fil par lequel un
-- abonnement pourrait un jour atteindre la caisse. Tant qu'il existe, quelqu'un
-- peut écrire, de bonne foi, un `if (formule === 'gratuit')` sur un écran de
-- vente — et personne ne le verra passer, parce que la lecture était permise.
--
-- La frontière de ce produit est qu'un abonnement ne ferme JAMAIS un geste de
-- caisse. La façon la plus solide de l'écrire n'est pas un commentaire dans le
-- domaine : c'est que le rôle de la caisse n'ait rien à lire. Une règle qu'on
-- ne peut pas enfreindre vaut mieux qu'une règle qu'on rappelle.
--
-- C'est aussi ce que demande le moindre privilège, qui n'a pas d'exception
-- « au cas où » : un privilège accordé pour un usage qui n'existe pas est un
-- usage qui finit par exister.
--
-- ⚑ Éprouvé par `apps/sync/test/rls-partout.test.ts`, qui exige désormais que
--   `has_table_privilege('kaissi_device', 'kaissi.subscriptions', 'select')`
--   réponde faux. Rétablir le `grant` fait échouer ce test.
--
-- Le back-office, lui, garde sa lecture : c'est LUI qui affiche la formule,
-- avec la session de l'utilisateur et sous RLS.
-- ═══════════════════════════════════════════════════════════════════════════

revoke select on kaissi.subscriptions from kaissi_device;

-- La politique de lecture perd son rôle `kaissi_device` du même coup : une
-- politique qui nomme un rôle sans privilège de table ne rend rien, mais elle
-- laisse croire le contraire à qui la relit.
drop policy if exists subscriptions_lecture on kaissi.subscriptions;
create policy subscriptions_lecture on kaissi.subscriptions
  for select to authenticated
  using (kaissi.acces_organisation(organization_id));

comment on table kaissi.subscriptions is
  'La formule d''une organisation. Ne ferme QUE des écrans de gestion : un '
  'abonnement expiré n''empêche jamais d''encaisser — la caisse ne peut même '
  'pas lire cette table (0042). En lecture seule sous RLS pour le back-office : '
  'une politique d''écriture serait un bouton « je m''offre le payant ».';
