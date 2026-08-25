/**
 * Registre des migrations locales.
 *
 * RÈGLES, non négociables — un appareil peut rester trois semaines hors ligne
 * puis se reconnecter avec une version ancienne de l'application :
 *
 *  1. Une migration PUBLIÉE ne se modifie JAMAIS. On en ajoute une nouvelle.
 *  2. Les versions sont contiguës et croissantes : 1, 2, 3…
 *  3. Le SQL est un littéral TypeScript, EMPAQUETÉ dans l'APK. Jamais un
 *     fichier téléchargé : une migration qui a besoin du réseau ne s'applique
 *     pas en mode avion.
 *  4. Chaque migration est appliquée dans UNE transaction. Une migration à
 *     moitié appliquée sur la tablette d'un restaurant à Sfax n'est pas
 *     réparable à distance.
 *  5. Toute migration doit être ADDITIVE tant que le protocole de sync
 *     supporte N−2 : ajouter une colonne, jamais en supprimer une que
 *     l'ancienne version écrit encore.
 */

import { SQL_001 } from './001_schema_initial.js'

export interface MigrationLocale {
  readonly version: number
  readonly nom: string
  readonly sql: string
}

export const MIGRATIONS: readonly MigrationLocale[] = [
  { version: 1, nom: 'schema_initial', sql: SQL_001 },
]

/** Version cible : celle de la dernière migration connue de ce binaire. */
export const VERSION_SCHEMA_LOCAL = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
)

/** Contrôle de cohérence du registre, exécuté au démarrage ET par les tests. */
export function verifierRegistre(migrations: readonly MigrationLocale[] = MIGRATIONS): void {
  migrations.forEach((m, index) => {
    if (m.version !== index + 1) {
      throw new Error(
        `Registre de migrations incohérent : la migration en position ${index} ` +
          `porte la version ${m.version}, ${index + 1} était attendu. ` +
          `Les versions doivent être contiguës et croissantes.`,
      )
    }
    if (m.sql.trim() === '') {
      throw new Error(`Migration ${m.version} (${m.nom}) : SQL vide.`)
    }
  })
}

export { SQL_001 }
