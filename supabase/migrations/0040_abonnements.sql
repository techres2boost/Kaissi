-- ═══════════════════════════════════════════════════════════════════════════
-- 0040 — Les ABONNEMENTS : une formule par organisation, et un essai
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Ce que cette table décide, et ce qu'elle ne décide JAMAIS ──────────────
--
-- Elle décide quels MODULES DE GESTION sont ouverts au back-office. Elle ne
-- décide rien de la caisse.
--
-- ⚠ ET C'EST LE POINT LE PLUS IMPORTANT DE CETTE MIGRATION.
--
-- Le cahier des charges demandait que la formule gratuite « n'ait pas la
-- partie offline qui fonctionne ». C'est infaisable ici, et le dire vaut
-- mieux que le contourner : le POS est EMPAQUETÉ dans l'APK, il n'a pas de
-- mode « connecté » dont on pourrait le priver. Sa base est locale, ses
-- ventes sont un journal d'événements local, et il encaisse avant même
-- d'avoir vu un serveur. Pour « désactiver l'offline », il faudrait écrire du
-- code qui EMPÊCHE la caisse de fonctionner sans réseau — c'est-à-dire
-- démonter la seule chose que ce produit promet, et le faire exprès.
--
-- Il y a pire : une caisse qui refuserait d'encaisser parce qu'un essai a
-- expiré s'arrêterait un vendredi soir, en plein service, avec des clients
-- qui attendent. Aucune ligne de revenu ne justifie cela.
--
-- La FRONTIÈRE est donc posée ici, une fois : **un abonnement ne peut
-- fermer que des écrans de GESTION, jamais un geste de caisse.** Ce que
-- `packages/domain/src/abonnement.ts` peut refuser, ce sont des rapports
-- longs et des modules d'inventaire. Jamais une vente.
--
-- ── Pourquoi le CLIENT ne peut pas écrire dans cette table ────────────────
--
-- Le back-office n'utilise que la clé publique de Supabase, avec la session
-- de l'utilisateur : tout passe par RLS. Une politique d'écriture ici, si
-- restreinte soit-elle, serait un bouton « je m'offre la formule payante » —
-- il suffirait d'un `update` depuis la console du navigateur.
--
-- La table est donc en LECTURE SEULE pour tout le monde. Les changements de
-- formule passent par le service de synchronisation, qui parle à Postgres
-- avec un rôle privilégié et relit les droits en base. C'est le même
-- raisonnement que pour la création d'un établissement.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists kaissi.subscriptions (
  -- La formule s'attache à l'ORGANISATION, pas à l'établissement : un client
  -- qui ouvre son deuxième restaurant ne recommence pas un essai.
  organization_id uuid        primary key
                  references kaissi.organizations(id) on delete cascade,

  plan            text        not null default 'essai'
                  check (plan in ('essai', 'gratuit', 'pro')),

  /*
   * Fin de l'essai. Nul pour les formules qui n'en ont pas.
   *
   * Un HORODATAGE et non un nombre de jours : « il te reste 14 jours » se
   * recalcule à chaque lecture et dérive selon le fuseau de qui regarde.
   * Une date est une date.
   */
  trial_ends_at   timestamptz,

  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  /** Pourquoi cette formule — repris tel quel par le support. */
  note            text,

  -- Un essai sans échéance serait un abonnement gratuit qui ne le dit pas.
  constraint essai_a_une_fin check (plan <> 'essai' or trial_ends_at is not null)
);

comment on table kaissi.subscriptions is
  'La formule d''une organisation. Ne ferme QUE des écrans de gestion : un '
  'abonnement expiré n''empêche jamais d''encaisser. En lecture seule sous '
  'RLS — une politique d''écriture serait un bouton « je m''offre le payant ».';

create index if not exists subscriptions_essai_idx
  on kaissi.subscriptions (trial_ends_at)
  where plan = 'essai';

alter table kaissi.subscriptions enable row level security;
alter table kaissi.subscriptions force row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- Les politiques, écrites À LA MAIN
-- ═══════════════════════════════════════════════════════════════════════════
-- `kaissi.protege_referentiel()` et `protege_transactionnel()` ne conviennent
-- pas ici : toutes deux s'articulent sur `restaurant_id`, et une formule
-- appartient à l'ORGANISATION. C'est le même cas que `audit_events`, dont les
-- politiques sont écrites à la main pour la même raison.
--
-- Ce qu'il ne faut donc pas perdre en s'en passant : les GRANTS. Une politique
-- n'accorde aucun privilège de table — sans le `grant select` ci-dessous, la
-- politique de lecture existe et la lecture échoue quand même, sur
-- « permission denied for table subscriptions ». Vu ici, en test.

-- ── Lecture : les membres de l'organisation, et eux seuls ─────────────────
--
-- `kaissi_device` en fait partie : l'écran Diagnostic de la caisse peut vouloir
-- dire quelle formule est en cours. Il ne s'en sert pour RIEN d'autre — voir
-- l'avertissement en tête de fichier.
drop policy if exists subscriptions_lecture on kaissi.subscriptions;
create policy subscriptions_lecture on kaissi.subscriptions
  for select to authenticated, kaissi_device
  using (kaissi.acces_organisation(organization_id));

grant select on kaissi.subscriptions to authenticated, kaissi_device;

/*
 * ── AUCUNE politique d'écriture, et AUCUN privilège d'écriture ────────────
 *
 * Les deux, et pas l'un des deux. Ce sont deux serrures distinctes, comme
 * pour la création d'article depuis la caisse (migration 0034) :
 *
 *   • aucune politique `for insert/update/delete` : avec RLS active, toute
 *     écriture est refusée, y compris à un administrateur ;
 *   • et aucun `grant insert, update, delete` : la seconde serrure tient même
 *     si quelqu'un ajoutait un jour une politique « juste pour l'admin ».
 *
 * C'est exactement ce qu'on veut : la formule ne se change pas depuis le
 * navigateur du client. Le back-office n'a que la clé publique de Supabase,
 * donc tout ce qu'il peut écrire, n'importe qui peut le rejouer depuis la
 * console de son navigateur — une politique d'écriture ici, si restreinte
 * soit-elle, serait un bouton « je m'offre la formule payante ».
 *
 * Le service de synchronisation emprunte un rôle privilégié et n'est donc pas
 * filtré par RLS ; c'est lui qui écrit — à l'inscription, pour poser l'essai,
 * et par `pnpm sync:abonnement` quand quelqu'un a payé.
 */

-- ── Les organisations DÉJÀ installées ─────────────────────────────────────
--
-- Elles passent en `pro`, et non en `essai`.
--
-- Kaissi se vend et s'installe : ces clients n'ont jamais demandé d'essai, et
-- leur en ouvrir un leur retirerait des modules dans quatorze jours, sans
-- prévenir et sans raison. Un logiciel qui reprend en silence ce qu'il avait
-- donné est pire qu'un logiciel qui ne l'a jamais donné.
insert into kaissi.subscriptions (organization_id, plan, note)
select o.id, 'pro', 'Installé avant la mise en place des formules (migration 0040).'
  from kaissi.organizations o
 where not exists (
   select 1 from kaissi.subscriptions s where s.organization_id = o.id
 );

create trigger subscriptions_updated_at
  before update on kaissi.subscriptions
  for each row execute function kaissi.touche_updated_at();
