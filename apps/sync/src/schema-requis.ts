/**
 * Le schéma que CE code attend — vérifié au démarrage, et dit à voix haute.
 *
 * ── La panne qui a fait écrire ce fichier ─────────────────────────────────
 *
 * Le remboursement (migration 0045) a ajouté `refunds.order_id`, et la
 * reprojection s'est mise à exécuter `delete from kaissi.refunds where
 * order_id = …` à CHAQUE vente reçue. Railway redéploie le service tout
 * seul depuis `main` ; les migrations Supabase, elles, s'appliquent à la
 * main. Le code est parti, la migration non.
 *
 * Résultat : chaque push répondait 500, la caisse gardait ses ventes en
 * attente (« ↑↓ 2 »), et rien n'arrivait ni en cuisine, ni au bar, ni au
 * back-office — sur aucun appareil. Les événements, eux, étaient bien dans
 * `order_events` : rien n'était perdu, mais tout était invisible. Et le
 * message de la caisse — « Erreur interne du serveur » — ne disait rien de
 * la cause, qui tenait en une ligne.
 *
 * ── Ce que fait ce module ─────────────────────────────────────────────────
 *
 * Une SONDE par migration dont le code dépend : une question booléenne à
 * PostgreSQL (« cette colonne existe-t-elle ? »), posée au démarrage en une
 * seule requête. Il en sort la liste des migrations manquantes, et :
 *
 *   • le démarrage l'imprime dans un cadre impossible à manquer ;
 *   • `/sante` répond 503 `schema_incomplet` — et Railway, dont la sonde
 *     de déploiement est `/sante`, refuse alors de remplacer la version
 *     qui tourne. Un code qui exige une migration absente ne PREND PAS la
 *     place d'un code qui marche ;
 *   • une erreur 42703 / 42P01 / 42883 en pleine requête est rendue à la
 *     caisse avec le NUMÉRO de la migration, au lieu d'un « erreur interne ».
 *
 * Pourquoi des sondes et pas la table `supabase_migrations` : coller une
 * migration dans le SQL Editor — le chemin documenté (docs/mvp.md) — ne
 * l'inscrit nulle part. Seul le schéma lui-même dit la vérité.
 *
 * ⚑ `test/schema-requis.test.ts` exige qu'une sonde couvre la DERNIÈRE
 *   migration du dépôt. Ajouter 0046 sans sa sonde fait tomber la CI : c'est
 *   précisément l'oubli qui a coûté cette panne.
 */

export interface SondeMigration {
  /** « 0045 » — le préfixe du fichier dans supabase/migrations. */
  readonly migration: string
  /** Ce qui manque, en clair, pour le journal. */
  readonly objet: string
  /** Une expression SQL BOOLÉENNE, vraie quand la migration est appliquée. */
  readonly sql: string
}

// Les quatre formes de sonde. Les noms sont des CONSTANTES de ce fichier,
// jamais une donnée reçue : la concaténation n'ouvre aucune injection.
const colonne = (table: string, nom: string) =>
  `exists (select 1 from information_schema.columns
            where table_schema = 'kaissi' and table_name = '${table}' and column_name = '${nom}')`
const table = (nom: string) => `(to_regclass('kaissi.${nom}') is not null)`
const fonction = (nom: string) =>
  `exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'kaissi' and p.proname = '${nom}')`
const politique = (tableNom: string, nom: string) =>
  `exists (select 1 from pg_policies
            where schemaname = 'kaissi' and tablename = '${tableNom}' and policyname = '${nom}')`

/**
 * Une sonde par migration, de la plus ancienne que le code lit encore à la
 * plus récente. Les migrations 0001–0029 ne sont pas sondées : le service
 * ne joint même pas la base sans elles (`devices`, `order_events`), et le
 * démarrage échoue alors avec un message déjà clair.
 */
export const SONDES: readonly SondeMigration[] = [
  { migration: '0030', objet: 'orders.discount_id', sql: colonne('orders', 'discount_id') },
  { migration: '0031', objet: 'table customers', sql: table('customers') },
  { migration: '0032', objet: 'politique users_lecture', sql: politique('users', 'users_lecture') },
  { migration: '0033', objet: 'fonction rapport_ventes', sql: fonction('rapport_ventes') },
  { migration: '0034', objet: 'sync_mutations.kind', sql: colonne('sync_mutations', 'kind') },
  { migration: '0035', objet: 'restaurants.receipt_footer', sql: colonne('restaurants', 'receipt_footer') },
  {
    migration: '0036',
    objet: 'restaurants.service_tax_rate_id',
    sql: colonne('restaurants', 'service_tax_rate_id'),
  },
  {
    migration: '0037',
    objet: 'fonction journalise_modificateurs_produit',
    sql: fonction('journalise_modificateurs_produit'),
  },
  { migration: '0038', objet: 'restaurants.closed_at', sql: colonne('restaurants', 'closed_at') },
  { migration: '0039', objet: 'fonction etablissement_vivant', sql: fonction('etablissement_vivant') },
  { migration: '0040', objet: 'table subscriptions', sql: table('subscriptions') },
  {
    migration: '0041',
    objet: 'stock_movements.supplier_id',
    sql: `(${table('suppliers')} and ${colonne('stock_movements', 'supplier_id')})`,
  },
  {
    migration: '0042',
    objet: 'politique subscriptions_lecture',
    sql: politique('subscriptions', 'subscriptions_lecture'),
  },
  {
    migration: '0043',
    objet: 'fonction numerote_evenement_sous_verrou',
    sql: fonction('numerote_evenement_sous_verrou'),
  },
  {
    migration: '0044',
    objet: 'politique categories_creation_caisse',
    sql: politique('categories', 'categories_creation_caisse'),
  },
  {
    migration: '0045',
    objet: 'refunds.order_id et l’événement refund.recorded',
    sql:
      `(${colonne('refunds', 'order_id')} and exists (
          select 1 from pg_constraint
           where conname = 'order_events_type_check'
             and pg_get_constraintdef(oid) like '%refund.recorded%'))`,
  },
  {
    migration: '0046',
    objet: 'orders.last_sent_seq, order_items.sent_seq, kitchen_ready.sent_seq',
    sql:
      `(${colonne('orders', 'last_sent_seq')} and ${colonne('order_items', 'sent_seq')}` +
      ` and ${colonne('kitchen_ready', 'sent_seq')})`,
  },
  {
    migration: '0047',
    objet: 'push_subscriptions.alertes_preparation',
    sql: colonne('push_subscriptions', 'alertes_preparation'),
  },
]

/** La requête unique : un tableau de booléens, dans l'ordre de `SONDES`. */
export function requeteSondes(sondes: readonly SondeMigration[] = SONDES): string {
  return `select array[${sondes.map((s) => s.sql).join(',\n')}]::boolean[] as presentes`
}

/** Les sondes dont la réponse est « non ». */
export function manquantes(
  presentes: readonly boolean[],
  sondes: readonly SondeMigration[] = SONDES,
): SondeMigration[] {
  return sondes.filter((_, i) => presentes[i] !== true)
}

/**
 * Codes PostgreSQL d'un schéma en RETARD sur le code : colonne, table ou
 * fonction inconnue. Ce ne sont jamais des erreurs de donnée — rejouer la
 * même vente donnera la même erreur tant que la migration manque.
 */
export const CODES_SCHEMA_EN_RETARD = new Set(['42703', '42P01', '42883'])

export function estSchemaEnRetard(erreur: unknown): boolean {
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    'code' in erreur &&
    CODES_SCHEMA_EN_RETARD.has(String((erreur as { code: unknown }).code))
  )
}

/** Le message rendu à la caisse — il s'affiche dans Synchronisation. */
export function messageSchemaEnRetard(migrations: readonly string[]): string {
  const liste = migrations.length > 0 ? ` (${migrations.join(', ')})` : ''
  return (
    `La base de données du serveur n'est pas à jour : une migration manque${liste}. ` +
    'Vos ventes sont conservées sur cette caisse et dans le journal du serveur ; ' +
    'elles apparaîtront dès que la migration sera appliquée, sans rien ressaisir.'
  )
}

/** Le cadre du démarrage : ce qu'il faut FAIRE, pas seulement ce qui manque. */
export function avertissementDemarrage(sondes: readonly SondeMigration[]): string {
  const lignes = sondes.map((s) => `      ${s.migration}  — ${s.objet}`)
  return [
    '',
    '  ┌───────────────────────────────────────────────────────────────┐',
    '  │  ✗ SCHÉMA INCOMPLET — ce code attend des migrations absentes.  │',
    '  └───────────────────────────────────────────────────────────────┘',
    '',
    ...lignes,
    '',
    '  Les ventes poussées échoueront tant qu’elles manquent (elles restent',
    '  en attente sur les caisses : rien n’est perdu).',
    '',
    '  Supabase → SQL Editor → coller chaque fichier',
    '  supabase/migrations/<numéro>_*.sql, dans l’ordre, puis « Run ».',
    '  Ensuite : redéployer ce service, ou attendre /sante (60 s).',
    '',
    '  /sante répond 503 « schema_incomplet » d’ici là : Railway garde',
    '  donc la version précédente en service au lieu de la remplacer.',
    '',
  ].join('\n')
}
