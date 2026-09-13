-- ═══════════════════════════════════════════════════════════════════════════
-- 0034 — Un article créé SUR la caisse, et la seule exception qu'il exige
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Ce que cette migration ouvre, et ce qu'elle laisse fermé ───────────────
--
-- La 0003 posait une règle sans nuance : « un APPAREIL ne modifie JAMAIS le
-- référentiel — il le reçoit par le pull de synchronisation ». Elle reste
-- vraie de tout ce qui la rendait nécessaire, et on n'en retire rien :
--
--   • un appareil ne MODIFIE toujours pas un article existant. Un prix édité
--     hors ligne sur deux caisses exigerait un arbitrage dernier-écrivain-
--     gagne, et on ne l'ajoute pas « en passant » ;
--   • un appareil ne SUPPRIME rien ;
--   • un appareil ne bascule toujours pas `is_available`. C'est tout le sujet
--     de la 0023 : le serveur calcule le stock à l'instant, une tablette hors
--     ligne travaille sur un souvenir de trois heures ;
--   • aucune autre table de référentiel ne change — taux de TVA, catégories,
--     modificateurs, tables de salle restent descendants.
--
-- Seule l'INSERTION dans `products` s'ouvre. Créer un article n'est pas
-- modifier un état partagé : deux caisses hors ligne créent deux lignes
-- DISTINCTES, avec leurs identifiants propres. Au pire deux fois le même nom,
-- que le back-office fusionne. C'est un désagrément, pas une perte — et c'est
-- précisément ce qui distingue cette opération de toutes celles ci-dessus.
--
-- ── Pourquoi RLS, alors que le service vérifie déjà le rôle ───────────────
--
-- Parce que ce sont deux questions différentes, et qu'une seule des deux se
-- laisse contourner par une faute de frappe.
--
--   • QUI a le droit — gérant ou administrateur — est relu EN BASE par le
--     service avant d'appliquer (`peutModifierCatalogue`). C'est applicatif
--     par nature : l'appareil n'est pas une personne, il porte le
--     `employee_id` de qui a demandé, et le service ne le croit pas sur
--     parole.
--   • DANS QUEL ÉTABLISSEMENT est une question de tenance, et celle-là ne
--     doit jamais dépendre d'un `where` écrit à la main. La politique
--     ci-dessous la tranche pour tout le monde, définitivement.
--
-- Un défaut de filtrage applicatif ne peut donc pas créer un article chez le
-- restaurant d'à côté.
-- ═══════════════════════════════════════════════════════════════════════════

-- Insertion par un appareil, dans SON établissement et nulle part ailleurs.
-- `for insert` : pas de `using`, donc aucune ligne existante n'est atteignable
-- par cette politique — elle ne peut littéralement rien réécrire.
create policy products_creation_caisse on kaissi.products
  for insert to kaissi_device
  with check (kaissi.acces_restaurant(restaurant_id));

comment on policy products_creation_caisse on kaissi.products is
  'Exception ÉTROITE à « un appareil ne modifie jamais le référentiel » : la '
  'seule INSERTION, pour qu''un plat du jour se crée sans quitter la caisse. '
  'Ni update, ni delete, ni is_available — voir 0034.';

-- `insert` seul. Pas `update`, pas `delete` : le privilège manquant est la
-- seconde serrure, celle qui tient même si une politique était réécrite.
grant insert on kaissi.products to kaissi_device;

-- ── Le registre d'idempotence accueille une seconde sorte de mutation ──────
--
-- `sync_mutations` n'a jamais rien su des commandes : sa clé primaire est
-- `event_id`, et c'est tout ce qu'il lui faut pour garantir « appliqué une
-- seule fois ». Elle sert donc aux mutations de catalogue telles quelles.
--
-- La colonne ci-dessous ne change pas cette garantie : elle rend le registre
-- LISIBLE. Sans elle, un rejet de catalogue et un rejet de vente se
-- ressemblent trait pour trait dans la table où le support va chercher.
alter table kaissi.sync_mutations
  add column if not exists kind text not null default 'order_event'
    check (kind in ('order_event', 'catalogue'));

comment on column kaissi.sync_mutations.kind is
  'De quelle file vient la mutation. L''idempotence, elle, ne dépend que de '
  'event_id — une seule clé pour les deux sortes.';
