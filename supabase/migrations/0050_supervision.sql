-- ═══════════════════════════════════════════════════════════════════════════
-- 0050 — Supervision : l'HISTORIQUE, les incidents, le journal de sécurité
-- ═══════════════════════════════════════════════════════════════════════════
--
-- L'écran « Surveillance » (S3, octobre) répondait à une seule question :
-- « maintenant ? ». Ses mesures vivaient dans la mémoire du service, sur une
-- heure, et repartaient de zéro à chaque redémarrage — donc exactement au
-- moment où l'on voudrait savoir ce qui s'est passé AVANT.
--
-- Trois questions restaient sans réponse, et ce sont celles d'une
-- exploitation réelle :
--
--   • « C'était comment cette nuit ? la semaine dernière ? » — pas
--     d'historique ;
--   • « Cette alerte, quelqu'un s'en occupe ? depuis quand dure-t-elle ? » —
--     une alerte recalculée à chaque affichage n'a ni début, ni fin, ni
--     responsable ;
--   • « Quelqu'un essaie-t-il des mots de passe ? » — les refus
--     d'authentification n'étaient comptés nulle part.
--
-- ── Ce que cette migration N'ajoute PAS ───────────────────────────────────
--
-- Aucune écriture par vente. La règle posée en octobre tient toujours :
-- écrire une métrique par requête dans la base qu'on surveille ajouterait
-- une écriture à chaque encaissement pour savoir si les encaissements vont
-- bien. Le service agrège EN MÉMOIRE et écrit UNE ligne par minute — 1 440
-- par jour, quelle que soit la charge. Les événements (sécurité, erreurs)
-- sont mis en file et partent dans la même écriture.
--
-- ── Aucune donnée de vente, aucune donnée personnelle ─────────────────────
--
-- Des compteurs, des durées, des tailles. Le journal des événements ne
-- porte jamais un mot de passe ni un jeton ; une adresse e-mail y est
-- MASQUÉE par le service (« s•••@domaine.tn »), une adresse IP TRONQUÉE à
-- son réseau. Ce qui permet de reconnaître une attaque ne permet pas de
-- reconnaître une personne.
--
-- ── Qui lit ces tables ────────────────────────────────────────────────────
--
-- Personne par PostgREST : aucun privilège n'est accordé à `authenticated`,
-- `anon` ni `kaissi_device`, et la politique posée refuse tout. Ces chiffres
-- traversent TOUS les restaurants : ils ne se lisent que par le service de
-- synchronisation, qui vérifie que l'appelant est un ÉDITEUR
-- (`POST /admin/supervision`). Pas d'`organization_id` ni de
-- `restaurant_id` de tenance ici (règle 3) : ces tables décrivent la
-- plateforme, pas un client.

-- ── 1. Un point par minute et par instance ────────────────────────────────

create table kaissi.supervision_points (
  -- Début de la période agrégée. Une minute en production
  -- (`SYNC_SUPERVISION_SECONDES`, 60 par défaut) ; plus court en test.
  minute                  timestamptz not null,
  -- L'instance du service. Une seule aujourd'hui ; le jour où il y en aura
  -- deux, leurs minutes ne s'écraseront pas.
  instance                text        not null,

  -- Trafic
  requetes                integer     not null default 0,
  erreurs_5xx             integer     not null default 0,
  erreurs_4xx             integer     not null default 0,
  latence_moyenne_ms      integer     not null default 0,
  push_requetes           integer     not null default 0,
  push_p50_ms             integer,
  push_p95_ms             integer,
  push_p99_ms             integer,
  pull_p95_ms             integer,
  -- Le plus grand nombre de requêtes EN COURS au même instant, dans la
  -- minute : c'est la « charge simultanée », que ni le débit ni la latence
  -- ne disent.
  concurrence_max         integer     not null default 0,
  evenements_recus        integer     not null default 0,

  -- Processus
  cpu_pourcent            numeric(6,1),
  rss_octets              bigint,
  tas_octets              bigint,
  boucle_p99_ms           numeric(9,2),
  -- Vrai sur le PREMIER point d'une vie du service : un redémarrage se lit
  -- dans l'historique sans avoir à comparer des durées de vie.
  redemarrage             boolean     not null default false,

  -- Base
  base_latence_ms         integer,
  base_taille_octets      bigint,
  base_connexions         integer,
  base_connexions_actives integer,
  pool_ouvertes           integer,
  pool_en_attente         integer,
  cache_pourcent          numeric(5,1),
  attentes_verrou         integer,

  -- Métier
  caisses_vues_15min      integer,
  projections_manquantes  integer,
  rejets_24h              integer,

  -- Sécurité (compteurs de la minute)
  echecs_authentification integer     not null default 0,
  limites_de_debit        integer     not null default 0,
  acces_refuses           integer     not null default 0,

  primary key (minute, instance)
);

comment on table kaissi.supervision_points is
  'Une ligne par MINUTE et par instance du service de synchronisation : '
  'trafic, latences, processus, base, sécurité. Agrégée en mémoire, écrite '
  'une fois par minute — jamais une écriture par vente. 30 jours gardés.';

-- ── 2. Les incidents : une alerte qui a un début, une fin, un responsable ──

create table kaissi.supervision_incidents (
  id                 uuid        primary key,
  -- Identifiant STABLE de la condition (« ventes.taux_erreur »). C'est lui
  -- qui fait qu'une alerte vue soixante fois en une heure reste UN incident.
  cle                text        not null,
  niveau             text        not null check (niveau in ('critique', 'attention', 'info')),
  sujet              text        not null,
  message            text        not null,
  statut             text        not null default 'ouvert'
                     check (statut in ('ouvert', 'pris_en_charge', 'resolu')),
  ouvert_le          timestamptz not null default now(),
  dernier_vu_le      timestamptz not null default now(),
  occurrences        integer     not null default 1,
  pris_en_charge_par text,
  pris_en_charge_le  timestamptz,
  resolu_le          timestamptz,
  -- « automatique » : la condition a disparu d'elle-même. « manuelle » :
  -- quelqu'un a clos. La différence compte au moment du bilan.
  resolution         text        check (resolution in ('automatique', 'manuelle')),
  resolu_par         text,
  note               text
);

-- UN SEUL incident non résolu par condition : c'est cet index, et non le
-- code, qui garantit qu'une alerte persistante n'ouvre pas mille incidents.
create unique index supervision_incidents_ouvert_idx
  on kaissi.supervision_incidents (cle) where statut <> 'resolu';
create index supervision_incidents_recents_idx
  on kaissi.supervision_incidents (ouvert_le desc);

comment on table kaissi.supervision_incidents is
  'Les alertes de supervision, avec leur cycle de vie : ouvert → pris en '
  'charge → résolu. Un seul incident non résolu par condition (index unique '
  'partiel). Résolution automatique quand la condition disparaît.';

-- ── 3. Le journal des événements : sécurité, application, terminaux ───────

create table kaissi.supervision_evenements (
  -- Séquence serveur : ce journal n'est jamais créé hors ligne (règle 2 ne
  -- s'applique qu'aux entités qu'un appareil peut créer).
  id            bigint      generated always as identity primary key,
  instant       timestamptz not null default now(),
  categorie     text        not null
                check (categorie in ('securite', 'application', 'synchronisation', 'terminal')),
  type          text        not null,
  niveau        text        not null default 'info'
                check (niveau in ('critique', 'attention', 'info')),
  -- Nuls quand l'événement n'est rattaché à personne — un échec de
  -- connexion n'a, par définition, pas encore d'établissement.
  --
  -- PAS de clé étrangère, à dessein : ce journal OBSERVE. Une écriture de
  -- supervision qui échouerait parce qu'un établissement vient d'être
  -- supprimé emporterait tout le lot d'événements de la minute — et l'on
  -- perdrait la trace précisément au moment où il se passe quelque chose.
  restaurant_id uuid,
  device_id     uuid,
  -- Réseau d'origine, TRONQUÉ par le service (203.0.113.0/24) : assez pour
  -- voir qu'une même source insiste, pas assez pour identifier un poste.
  origine       text,
  message       text        not null default '',
  detail        jsonb       not null default '{}'::jsonb
);

create index supervision_evenements_instant_idx
  on kaissi.supervision_evenements (instant desc);
create index supervision_evenements_categorie_idx
  on kaissi.supervision_evenements (categorie, instant desc);

comment on table kaissi.supervision_evenements is
  'Journal de supervision : refus d''authentification, limites de débit, '
  'erreurs serveur, erreurs remontées par les caisses, redémarrages. Jamais '
  'un mot de passe ni un jeton ; e-mails masqués, adresses IP tronquées. '
  '90 jours gardés.';

-- ── 4. Fermé à tout le monde, sauf au service ─────────────────────────────
--
-- RLS activée ET forcée, avec une politique qui refuse tout : la règle du
-- dépôt (aucune table sans RLS ni politique — `rls-partout.test.ts`) vaut
-- ici aussi, et « aucun privilège accordé » n'est pas une protection qu'un
-- `grant` distrait ne puisse défaire. Les deux serrures tiennent ensemble.

do $$
declare
  t text;
begin
  foreach t in array array['supervision_points', 'supervision_incidents', 'supervision_evenements']
  loop
    execute format('alter table kaissi.%I enable row level security', t);
    execute format('alter table kaissi.%I force row level security', t);
    execute format('revoke all on kaissi.%I from public', t);
    execute format('revoke all on kaissi.%I from anon', t);
    execute format('revoke all on kaissi.%I from authenticated', t);
    execute format('revoke all on kaissi.%I from kaissi_device', t);
    execute format(
      'create policy %I on kaissi.%I for all to public using (false) with check (false)',
      t || '_service_seul', t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
