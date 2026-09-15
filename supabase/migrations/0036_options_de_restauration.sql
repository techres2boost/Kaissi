-- ═══════════════════════════════════════════════════════════════════════════
-- 0036 — Les options de RESTAURATION s'appliquent enfin
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Ce qui existait, et ne servait à rien ──────────────────────────────────
--
-- `kaissi.restaurants` porte depuis la 0002 :
--   • `service_rate_bp`      — frais de service en points de base ;
--   • `service_taxable`      — le service est-il lui-même soumis à la taxe ;
--   • `stamp_duty_millimes`  — droit de timbre, montant fixe.
--
-- `packages/domain/src/totaux.ts` sait les appliquer depuis toujours : les
-- étapes 7 et 8 de l'ordre figé les attendent, et `ConfigCalcul` a les champs
-- pour les recevoir. Mais AUCUN des deux appelants ne les lisait — ni
-- `chargerConfig()` côté serveur, ni le contexte de la caisse. Trois colonnes,
-- un calcul qui les attend, et personne pour les relier.
--
-- La 0035 avait constaté le fait et refusé de les faire descendre, à juste
-- titre : « les rendre modifiables sans les appliquer donnerait un réglage
-- qui ne fait rien ». Cette migration fait l'autre moitié du chemin.
--
-- ── Ce que cette migration AJOUTE, et pourquoi ─────────────────────────────
--
-- Une seule colonne : `service_tax_rate_id`.
--
-- `service_taxable` à `true` ne suffisait pas à taxer quoi que ce soit. Le
-- domaine ne calcule la taxe du service que s'il connaît AUSSI le taux
-- (`ConfigService.tauxTaxeId`) — et ce taux n'existait nulle part. La case
-- pouvait donc être cochée sans le moindre effet, ce qui est précisément le
-- genre de réglage muet qu'on refuse.
--
-- Deviner le taux par défaut de l'établissement aurait été le raccourci
-- tentant. On ne le prend pas : le taux applicable au service est une
-- QUESTION FISCALE, pas une commodité d'interface, et rien ici ne doit
-- répondre à sa place.
--
-- ⚠ À VALIDER PAR UN EXPERT-COMPTABLE TUNISIEN — cette migration ouvre des
--   champs, elle n'affirme aucune règle :
--     • le droit de timbre s'applique-t-il à un ticket de restaurant, à
--       quel montant, et sur quelle base ;
--     • les frais de service sont-ils soumis à la TVA, et à quel taux ;
--     • un service « compris » doit-il figurer séparément sur le reçu.
--   Les valeurs par défaut sont TOUTES à zéro, et le restent : un logiciel
--   qui pose 1 % de service et 600 millimes de timbre « parce que c'est
--   l'usage » facture faux pendant des mois sans que personne ne le relise.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Le taux applicable au SERVICE ─────────────────────────────────────────
--
-- `on delete restrict` et non `set null` : un taux encore désigné par les
-- options de restauration ne doit pas disparaître en laissant `service_taxable`
-- à `true` et plus aucun taux — la caisse cesserait silencieusement de taxer
-- le service. L'écran « Taxes » refuse déjà d'archiver un taux utilisé ; la
-- contrainte tient la même promesse côté base, pour la suppression.
alter table kaissi.restaurants
  add column if not exists service_tax_rate_id uuid
    references kaissi.tax_rates(id) on delete restrict;

comment on column kaissi.restaurants.service_tax_rate_id is
  'Taux de taxe appliqué AUX FRAIS DE SERVICE, quand service_taxable est vrai. '
  'Nul = service non taxé. ⚠ Le fait que le service soit taxable, et à quel '
  'taux, doit être validé par un expert-comptable tunisien.';

comment on column kaissi.restaurants.stamp_duty_millimes is
  'Droit de timbre : montant FIXE en millimes ajouté au total, après taxes et '
  'service. 0 = aucun. ⚠ Son application à un ticket de restaurant et son '
  'montant doivent être validés par un expert-comptable tunisien.';

comment on column kaissi.restaurants.service_taxable is
  'Les frais de service sont-ils soumis à la taxe. Sans service_tax_rate_id, '
  'cette case N''A AUCUN EFFET — le domaine ne taxe le service que s''il '
  'connaît le taux. Les deux se règlent ensemble.';

-- ── Une entrée de journal pour l'existant ─────────────────────────────────
--
-- Même raison qu'en 0035 : le déclencheur `restaurants_change_log` (posé par
-- cette même 0035) ne se réveille qu'à l'écriture. Sans ce `update` sans
-- effet, les caisses déjà en service n'apprendraient la colonne qu'au premier
-- changement — c'est-à-dire peut-être jamais. Le miroir est idempotent, la
-- ligne est inoffensive.
update kaissi.restaurants set updated_at = now();
