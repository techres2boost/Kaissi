-- ═══════════════════════════════════════════════════════════════════════════
-- 0048 — Pointeuse : les heures travaillées
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Un employé pointe son ARRIVÉE puis sa SORTIE sur la caisse, avec son PIN.
-- Le pointage naît sur la tablette (UUIDv7, RÈGLE 2) : on pointe en
-- arrivant, réseau ou pas.
--
-- Même voie que les services de caisse (0022) : une route ADDITIVE,
-- `POST /sync/pointages`, qui envoie le pointage à l'arrivée puis le RENVOIE
-- à la sortie. C'est la même ligne, enrichie — d'où l'update de l'appareil,
-- étroit comme celui des shifts : SES pointages, chez lui.
--
-- Pas un événement de commande : un pointage n'est pas une vente, n'a ni
-- projection ni total, et rien ne le rejoue.
--
-- Les heures sont celles de la TABLETTE (informatives, jamais un curseur —
-- RÈGLE 4). `received_at` est l'heure du SERVEUR à la réception : l'écart
-- entre les deux dit qu'une horloge est déréglée, ou qu'une caisse était
-- hors ligne.
--
-- Pas de contrainte « sortie >= arrivée » : une horloge reculée entre les
-- deux pointages produirait un refus, et le pointage serait PERDU. Il est
-- reçu, et le domaine le signale « incohérent » (`etatPointage`).
--
-- ⚠ Ce n'est pas un registre du temps de travail au sens du Code du travail
--   tunisien — à faire valider si un tel registre est exigé.

create table kaissi.time_entries (
  id              uuid        primary key,
  organization_id uuid        not null references kaissi.organizations(id) on delete restrict,
  restaurant_id   uuid        not null references kaissi.restaurants(id) on delete restrict,
  user_id         uuid        references kaissi.users(id) on delete set null,
  device_id       uuid        references kaissi.devices(id) on delete set null,
  clock_in_at     timestamptz not null,
  clock_out_at    timestamptz,
  -- Une sortie corrigée au back-office par un gérant : qui, et quand.
  corrected_by    uuid        references auth.users(id) on delete set null,
  corrected_at    timestamptz,
  received_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table kaissi.time_entries is
  'Pointeuse (0048) : une arrivée et une sortie, saisies sur la caisse au PIN. '
  'Heures de la tablette ; received_at est l''heure du serveur.';

create index time_entries_restaurant_idx on kaissi.time_entries (restaurant_id, clock_in_at desc);
create index time_entries_ouverts_idx on kaissi.time_entries (restaurant_id) where clock_out_at is null;

-- RLS dans le même fichier : lecture et insertion des membres et appareils
-- de l'établissement, correction par l'encadrement.
select kaissi.protege_transactionnel('time_entries');

create trigger time_entries_updated_at before update on kaissi.time_entries
  for each row execute function kaissi.touche_updated_at();

-- Un appareil ne modifie que SES pointages, et uniquement chez lui.
create policy time_entries_correction_appareil on kaissi.time_entries
  for update to kaissi_device
  using (
    device_id = kaissi.appareil_courant()
    and kaissi.acces_restaurant(restaurant_id)
  )
  with check (
    device_id = kaissi.appareil_courant()
    and kaissi.acces_restaurant(restaurant_id)
  );

grant select, insert, update on kaissi.time_entries to kaissi_device;

-- Jamais de suppression : une journée de travail ne disparaît pas.
revoke delete, truncate on kaissi.time_entries from kaissi_device, authenticated;

notify pgrst, 'reload schema';
