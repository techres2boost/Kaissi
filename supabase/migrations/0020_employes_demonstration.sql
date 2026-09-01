-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0020 · Les employés de démonstration existent aussi côté serveur
-- ═══════════════════════════════════════════════════════════════════════════
-- Trou découvert en production, et qui ne se voyait pas avant la première
-- vente réellement synchronisée.
--
-- La graine LOCALE du POS (`packages/db-local/src/graine.ts`) crée trois
-- employés de démonstration — Ahmed, Salma, Karim — avec des identifiants
-- FIXES, pour que la caisse soit utilisable dès le premier lancement, sans
-- réseau. Le jeu de démonstration serveur (0007), lui, créait l'établissement,
-- la carte, les tables et les moyens de paiement… mais aucun employé.
--
-- Conséquence : `orders.opened_by` et `orders.closed_by` référencent
-- `kaissi.users`. À la première vente poussée, la projection violait la clé
-- étrangère et le push entier échouait. Toutes les autres références du POS
-- (produits, taxes, tables, stations, moyens de paiement) partageaient déjà
-- leurs identifiants avec la 0007 ; seuls les employés manquaient.
--
-- Les hachages Argon2id sont ceux de la graine locale, à l'identique : le
-- terminal ne voit donc aucun changement, et les PIN de démonstration
-- continuent de fonctionner hors ligne.
--
--   Ahmed  1357  gérant     Salma  2468  caissier     Karim  9753  serveur
--
-- ⚠ Données de DÉMONSTRATION. Sur une installation réelle, les employés se
--   créent depuis le back-office (écran « Employés »).
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_org   uuid := '01930000-0000-7000-8000-000000000001';
  v_resto uuid := '01930000-0000-7000-8000-000000000002';
begin
  -- Rien à faire si le jeu de démonstration n'a pas été installé.
  if not exists (select 1 from kaissi.restaurants where id = v_resto) then
    return;
  end if;

  -- `email` et `auth_user_id` restent NULS : un serveur en salle n'ouvre
  -- jamais le back-office, il tape un PIN sur une tablette (migration 0017).
  insert into kaissi.users
    (id, organization_id, auth_user_id, email, full_name, pin_hash, status)
  values
    ('01930000-0000-7000-8000-000000000700', v_org, null, null, 'Ahmed Ben Salah',
     'argon2id$m=8192,t=3,p=1$JTgeDj0ICNrg+OR4I8FMxQ==$F41EUhI2TK+yOduItfO2UL7wb5WNhsjnHO297/vrd0g=',
     'actif'),
    ('01930000-0000-7000-8000-000000000701', v_org, null, null, 'Salma Trabelsi',
     'argon2id$m=8192,t=3,p=1$mQR6YFgbGBRCFCWJEXArcg==$9EobXd52+moNNOoYrEAJhKUJ+Y3bxnIKD5+b+PjGe5k=',
     'actif'),
    ('01930000-0000-7000-8000-000000000702', v_org, null, null, 'Karim Jelassi',
     'argon2id$m=8192,t=3,p=1$dIPsUbsZBcAVKeCREBKJ5g==$S5nNIyyVxMxuTgOH7dGLYatgpqu0AvcLHN4GKiF2KME=',
     'actif')
  on conflict (id) do nothing;

  insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
  values
    (v_org, '01930000-0000-7000-8000-000000000700', v_resto, 'gerant'),
    (v_org, '01930000-0000-7000-8000-000000000701', v_resto, 'caissier'),
    (v_org, '01930000-0000-7000-8000-000000000702', v_resto, 'serveur')
  on conflict (user_id, restaurant_id) do nothing;
end
$$;

notify pgrst, 'reload schema';
