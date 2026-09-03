-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0021 · Un terminal garde SON identité quand il se remet en service
-- ═══════════════════════════════════════════════════════════════════════════
-- Défaut constaté en production, sur une base réelle : une seule tablette,
-- CINQ appareils. P1, P2, P3, P4, P5, tous créés en une demi-heure.
--
-- Cause : `POST /appairage` créait un appareil NEUF à chaque appel. Rien ne
-- reliait la deuxième mise en service d'un terminal à la première — ni
-- l'adresse, ni le compte, ni le matériel. Le serveur n'avait aucun moyen de
-- reconnaître un terminal déjà connu.
--
-- Ce que ça coûtait, concrètement :
--
--   • les événements DÉJÀ dans l'outbox portent l'ancien `device_id`. Le
--     nouveau jeton ne les couvre pas : ils sont refusés « appareil_etranger »
--     — définitivement, puisqu'un rejet ne se réessaie jamais tout seul.
--     Ce sont des VENTES qui n'arrivent jamais au back-office.
--   • la numérotation des tickets repart : P1-000001 puis P2-000001. Deux
--     tickets différents, deux préfixes, la même caisse.
--   • l'écran « Appareils » du back-office devient illisible : cinq lignes
--     pour une tablette, et aucun moyen de savoir laquelle est la vraie.
--
-- Le correctif : le TERMINAL porte un identifiant d'installation, tiré une
-- seule fois au premier démarrage et conservé dans sa base locale. Il
-- l'envoie à chaque appairage ; le serveur reconnaît alors l'installation et
-- rend la MÊME identité — même `device_id`, même préfixe de tickets — en se
-- contentant de faire tourner le jeton.
--
-- ── Pourquoi l'index est partiel sur `revoked_at is null` ──────────────────
--
-- Une révocation est DÉFINITIVE. Si le gérant révoque une tablette volée,
-- la retrouver en se réappairant avec les identifiants du gérant annulerait
-- sa décision en silence. L'unicité ne porte donc que sur l'appareil ACTIF :
-- après révocation, la même installation obtient une identité NEUVE, et
-- la ligne révoquée reste dans l'historique.
--
-- ── Pourquoi la colonne reste nullable ────────────────────────────────────
--
-- Les appareils déjà appairés — dont ceux de la production actuelle — n'ont
-- pas d'identifiant d'installation et ne peuvent pas en recevoir un après
-- coup : personne ne sait quelle ligne correspond à quelle tablette. Ils
-- continuent de fonctionner tels quels ; leur jeton reste valide. C'est au
-- prochain appairage que le terminal s'annonce, et il ne se dédoublera plus.
-- ═══════════════════════════════════════════════════════════════════════════

alter table kaissi.devices
  add column installation_id uuid;

comment on column kaissi.devices.installation_id is
  'Identifiant STABLE de l''installation du POS, tiré par le terminal à son '
  'premier démarrage et conservé dans sa base locale. C''est lui qui permet '
  'de reconnaître un terminal qui se remet en service au lieu de lui créer '
  'un appareil de plus. Nul pour les appareils appairés avant la 0021.';

-- Un seul appareil ACTIF par installation et par établissement.
--
-- La même tablette peut légitimement servir deux établissements du même
-- groupe (une caisse qu'on déplace) : l'unicité porte donc sur le couple,
-- pas sur l'installation seule.
create unique index devices_installation_idx
  on kaissi.devices (restaurant_id, installation_id)
  where installation_id is not null and revoked_at is null;
