-- ═══════════════════════════════════════════════════════════════════════════
-- 0045 — Le remboursement d'un ticket payé, projeté depuis le journal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La table `refunds` existe depuis 0004, et les rapports la lisent déjà
-- (0033, ligne « Remboursements »). Rien ne la remplissait : aucun écran
-- ne permettait de rembourser. Le remboursement arrive maintenant de la
-- caisse, sous la forme d'un ÉVÉNEMENT `refund.recorded` dans
-- `order_events`, et cette table en devient une PROJECTION — reconstruite à
-- chaque reprojection de la commande, comme `payments`.
--
-- ── Ce que cette migration ajoute ─────────────────────────────────────────
--
--   order_id   la commande remboursée. Sans elle, la reprojection ne
--              saurait pas quelles lignes remplacer, et un rejeu
--              dupliquerait chaque remboursement.
--   type       rendu en espèces, sur carte… — le tiroir n'est concerné
--              que par les espèces.
--   items      les lignes remboursées, telles que l'événement les nomme.
--   shift_id   le service de caisse d'où l'argent est SORTI, porté par
--              l'événement : rembourser lundi une vente de samedi vide le
--              tiroir de lundi. Pas de clé étrangère : le service peut
--              remonter après le remboursement (POST /sync/shifts est une
--              route additive, sans ordre garanti avec /sync/push).
--   device_id  la caisse qui a rendu l'argent.
--
-- ── Ce qu'elle ne fait PAS ────────────────────────────────────────────────
--
-- Aucune colonne existante n'est modifiée, aucune n'est rendue obligatoire :
-- `order_id` reste NULLABLE pour qu'une ligne éventuellement saisie avant
-- cette migration ne la fasse pas échouer. La projection, elle, le
-- renseigne toujours.
--
-- RLS est déjà posée sur la table (0004, `protege_transactionnel`) : lecture
-- par les membres de l'établissement, insertion par l'appareil dans le
-- sien. La reprojection passe par le rôle de service, comme pour
-- `payments`.
--
-- Le CA reste HORS TAXE et les remboursements sont des montants TTC
-- présentés à part : c'est la décision déjà prise par le tableau de bord
-- (les additionner fausserait la marge d'un point de TVA).
-- ═══════════════════════════════════════════════════════════════════════════

alter table kaissi.refunds
  add column if not exists order_id  uuid references kaissi.orders(id) on delete cascade,
  add column if not exists type      text,
  add column if not exists items     jsonb not null default '[]'::jsonb,
  add column if not exists shift_id  uuid,
  add column if not exists device_id uuid;

create index if not exists refunds_commande_idx on kaissi.refunds (order_id);
create index if not exists refunds_restaurant_date_idx on kaissi.refunds (restaurant_id, created_at);

comment on column kaissi.refunds.order_id is
  'Commande remboursée. Projection de refund.recorded : reconstruite à chaque reprojection.';
comment on column kaissi.refunds.shift_id is
  'Service de caisse d''où l''argent est sorti — porté par l''événement, pas par la commande.';

-- ── Le journal doit ACCEPTER le nouvel événement ───────────────────────────
--
-- `order_events.type` est une liste fermée (0004). Sans cette extension, le
-- premier remboursement poussé ferait échouer l'insertion du LOT entier —
-- donc aussi les ventes qui le suivent dans l'outbox de la caisse, qui
-- réessaierait sans fin. `apps/sync/test/remboursement.test.ts` vérifie que
-- chaque type connu du service est accepté par cette contrainte.
--
-- NOT VALID puis VALIDATE : la validation relit la table sans bloquer les
-- insertions en cours. Le journal ne cesse jamais d'écrire.
alter table kaissi.order_events drop constraint if exists order_events_type_check;
alter table kaissi.order_events add constraint order_events_type_check check (type in (
  'order.opened', 'line.added', 'line.quantity_changed',
  'line.voided', 'line.note_set', 'discount.applied',
  'discount.removed', 'service.set', 'customer.attached',
  'table.moved', 'order.sent', 'payment.recorded',
  'payment.voided', 'order.closed', 'order.cancelled',
  'refund.recorded')) not valid;
alter table kaissi.order_events validate constraint order_events_type_check;
