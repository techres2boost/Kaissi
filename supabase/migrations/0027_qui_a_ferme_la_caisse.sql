-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0027 · Qui a FERMÉ la caisse, et pas seulement qui l'a ouverte
-- ═══════════════════════════════════════════════════════════════════════════
-- `shifts.user_id` désigne celui qui a PRIS le poste. Le back-office
-- l'affichait comme « l'employé du service », ce qui est faux dès que le
-- service change de main — et il change de main tous les jours : un caissier
-- ouvre à midi, un serveur compte la caisse à la fermeture.
--
-- Or le nom qui compte, devant un écart, est celui de la personne qui a
-- COMPTÉ. C'est elle qui a vu les billets ; c'est à elle qu'on demande
-- d'expliquer un manque. Afficher le nom de celui qui a ouvert met en cause
-- quelqu'un qui était parti depuis quatre heures.
--
-- ── Pourquoi une colonne de plus, et non un remplacement ──────────────────
--
-- Les deux informations sont utiles et différentes. « Qui a ouvert » dit qui
-- a pris la responsabilité du fond de caisse ; « qui a fermé » dit qui
-- répond de l'écart. Écraser la première par la seconde perdrait la moitié
-- de la traçabilité — et le journal d'audit ne se reconstitue pas.
--
-- ADDITIVE et NULLABLE : les services déjà clos n'ont pas cette information
-- et ne l'auront jamais. Un `null` se lit « on ne sait pas », ce qui est la
-- vérité ; le remplir avec `user_id` inventerait une donnée fausse qui aurait
-- l'air juste.
-- ═══════════════════════════════════════════════════════════════════════════

alter table kaissi.shifts
  add column if not exists closed_by uuid references kaissi.users(id) on delete set null;

comment on column kaissi.shifts.closed_by is
  'L''employé qui a COMPTÉ la caisse. Distinct de user_id, qui a ouvert le '
  'service. Nul pour les services clos avant la 0027, et pour ceux encore '
  'ouverts — jamais rempli par défaut : un nom inventé aurait l''air juste.';
