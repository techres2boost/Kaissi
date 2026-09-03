-- ═══════════════════════════════════════════════════════════════════════════
-- 0022 — Le terminal remonte ses services de caisse
--
-- Jusqu'ici, un shift ne quittait jamais la tablette : l'écran « Journée »
-- du back-office affichait donc toujours une table « Caisses » vide, même
-- après une prise de poste et une clôture en bonne et due forme. Le fond de
-- caisse, le montant compté et surtout l'ÉCART — le chiffre pour lequel on
-- tient une caisse — n'existaient nulle part hors de la tablette.
--
-- Les POLITIQUES existaient déjà (0004) : lecture et insertion sont ouvertes
-- à `kaissi_device`. Ce qui manquait, ce sont les PRIVILÈGES de table — RLS
-- ne donne aucun droit, elle ne fait que restreindre ceux qu'on a déjà — et
-- une politique d'UPDATE pour l'appareil : la tablette envoie son shift à
-- l'ouverture, puis le RENVOIE à la clôture, enrichi de son écart.
--
-- L'update est volontairement étroit : un terminal ne peut corriger QUE les
-- services qu'il a lui-même ouverts. Il ne touche ni à ceux du terminal
-- voisin, ni à ceux d'un autre établissement.
-- ═══════════════════════════════════════════════════════════════════════════

-- Un appareil ne modifie que SES services, et uniquement chez lui.
create policy shifts_correction_appareil on kaissi.shifts
  for update to kaissi_device
  using (
    device_id = kaissi.appareil_courant()
    and kaissi.acces_restaurant(restaurant_id)
  )
  with check (
    device_id = kaissi.appareil_courant()
    and kaissi.acces_restaurant(restaurant_id)
  );

comment on policy shifts_correction_appareil on kaissi.shifts is
  'La tablette envoie son shift à l''ouverture puis le renvoie à la clôture : '
  'c''est le MÊME shift, enrichi. Sans update, la clôture — et donc l''écart '
  'de caisse — n''arriverait jamais au back-office.';

-- RLS restreint des privilèges ; elle n'en accorde aucun. Sans ce grant,
-- l'appareil se voyait refuser « permission denied for table shifts » alors
-- que ses politiques étaient correctes.
grant select, insert, update on kaissi.shifts to kaissi_device;

-- Jamais de suppression : un service de caisse est une pièce comptable.
revoke delete, truncate on kaissi.shifts from kaissi_device;

notify pgrst, 'reload schema';
