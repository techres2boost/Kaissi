/**
 * Migrateur local.
 *
 * Applique les migrations manquantes, dans l'ordre, chacune dans sa propre
 * transaction, et consigne ce qui a été appliqué. Conçu pour qu'un parc
 * hétérogène de tablettes converge sans intervention humaine : c'est le
 * risque « migration de schéma local » de l'analyse d'architecture, celui
 * qui est systématiquement sous-estimé.
 */

import type { AdaptateurSqlite } from './adaptateur.js'
import {
  MIGRATIONS,
  VERSION_SCHEMA_LOCAL,
  verifierRegistre,
  type MigrationLocale,
} from './migrations/index.js'

/** Table de suivi — créée avant toute autre chose. */
const SQL_TABLE_SUIVI = `
CREATE TABLE IF NOT EXISTS _migrations_locales (
  version     INTEGER PRIMARY KEY,
  nom         TEXT    NOT NULL,
  applique_a  TEXT    NOT NULL,
  duree_ms    INTEGER NOT NULL
) STRICT;
`

export interface MigrationAppliquee {
  readonly version: number
  readonly nom: string
  readonly appliqueA: string
  readonly dureeMs: number
}

export interface ResultatMigration {
  readonly versionAvant: number
  readonly versionApres: number
  readonly appliquees: readonly MigrationAppliquee[]
  readonly dureeTotaleMs: number
}

export class ErreurMigration extends Error {
  constructor(
    message: string,
    readonly version: number,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'ErreurMigration'
  }
}

/** Version de schéma actuellement en place dans la base locale. */
export async function versionCourante(db: AdaptateurSqlite): Promise<number> {
  await db.executerScript(SQL_TABLE_SUIVI)
  const ligne = await db.lireUne<{ v: number | null }>(
    'SELECT MAX(version) AS v FROM _migrations_locales',
  )
  return ligne?.v ?? 0
}

/** Journal complet des migrations appliquées — affiché dans l'écran Diagnostic. */
export async function journalMigrations(
  db: AdaptateurSqlite,
): Promise<MigrationAppliquee[]> {
  await db.executerScript(SQL_TABLE_SUIVI)
  const lignes = await db.lire<{
    version: number
    nom: string
    applique_a: string
    duree_ms: number
  }>('SELECT version, nom, applique_a, duree_ms FROM _migrations_locales ORDER BY version')
  return lignes.map((l) => ({
    version: l.version,
    nom: l.nom,
    appliqueA: l.applique_a,
    dureeMs: l.duree_ms,
  }))
}

/**
 * Applique toutes les migrations manquantes.
 *
 * Idempotent : appelable à chaque démarrage de l'application. Si la base est
 * déjà à jour, ne touche à rien et rend un résultat vide.
 */
export async function migrer(
  db: AdaptateurSqlite,
  migrations: readonly MigrationLocale[] = MIGRATIONS,
): Promise<ResultatMigration> {
  verifierRegistre(migrations)

  // Intégrité référentielle et journal WAL : deux réglages qui font la
  // différence entre « base corrompue après coupure de courant » et « base
  // intacte ». À poser AVANT toute migration, hors transaction.
  await db.executer('PRAGMA foreign_keys = ON')
  try {
    await db.executer('PRAGMA journal_mode = WAL')
  } catch {
    // Certains conteneurs (mémoire, OPFS) refusent le WAL : ce n'est pas
    // bloquant, on continue avec le journal par défaut.
  }

  const debutTotal = Date.now()
  const avant = await versionCourante(db)
  const cible = migrations.reduce((max, m) => Math.max(max, m.version), 0)

  if (avant > cible) {
    // L'utilisateur a installé une version PLUS ANCIENNE de l'application
    // par-dessus une base plus récente. On refuse de démarrer plutôt que
    // d'écrire dans un schéma qu'on ne comprend pas.
    throw new ErreurMigration(
      `Base locale en version ${avant}, application prévue pour la version ${cible}. ` +
        `Mettez à jour l'application : rétrograder détruirait des données.`,
      avant,
    )
  }

  const appliquees: MigrationAppliquee[] = []
  for (const migration of migrations) {
    if (migration.version <= avant) continue

    const debut = Date.now()
    try {
      await db.transaction(async () => {
        await db.executerScript(migration.sql)
        await db.executer(
          'INSERT INTO _migrations_locales (version, nom, applique_a, duree_ms) VALUES (?, ?, ?, ?)',
          [migration.version, migration.nom, new Date().toISOString(), Date.now() - debut],
        )
      })
    } catch (erreur) {
      throw new ErreurMigration(
        `Échec de la migration locale ${migration.version} (${migration.nom}) : ` +
          `${erreur instanceof Error ? erreur.message : String(erreur)}. ` +
          `La transaction a été annulée, la base reste en version ${avant + appliquees.length}.`,
        migration.version,
        erreur,
      )
    }

    appliquees.push({
      version: migration.version,
      nom: migration.nom,
      appliqueA: new Date().toISOString(),
      dureeMs: Date.now() - debut,
    })
  }

  return {
    versionAvant: avant,
    versionApres: await versionCourante(db),
    appliquees,
    dureeTotaleMs: Date.now() - debutTotal,
  }
}

export { VERSION_SCHEMA_LOCAL }
