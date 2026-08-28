/**
 * Adaptateur @capacitor-community/sqlite — le chemin de PRODUCTION (Android).
 *
 * Ce fichier vit dans `db-local` et NON dans `apps/pos` pour une seule
 * raison : il doit être testable sans émulateur Android. Il ne dépend
 * d'aucun module natif — il reçoit une connexion déjà ouverte, décrite par
 * l'interface structurelle `ConnexionCapacitor` ci-dessous. `apps/pos` se
 * contente d'ouvrir la vraie connexion et de la lui passer.
 *
 * ── Le piège Android ────────────────────────────────────────────────────
 * `execute()` et `run()` du plugin appellent `SQLiteDatabase.execSQL()`,
 * qui REFUSE catégoriquement toute instruction renvoyant des lignes :
 *
 *   « Queries can be performed using SQLiteDatabase query or rawQuery
 *     methods only. »
 *
 * Or `PRAGMA journal_mode = WAL` renvoie une ligne (« wal »). Le passer à
 * `execute()` fait échouer l'ouverture de la base — donc le démarrage de
 * l'application, donc l'encaissement. Tout PRAGMA part par `query()`
 * (`rawQuery` côté Android), qui accepte les deux cas.
 *
 * L'adaptateur Node porte la même précaution pour la raison symétrique :
 * `db.prepare().run()` de `node:sqlite` refuse lui aussi les PRAGMA.
 */

import { ErreurSqlite, type AdaptateurSqlite, type ValeurSql } from '../adaptateur.js'

/**
 * La part de `SQLiteDBConnection` que l'adaptateur utilise réellement.
 *
 * Décrite en structurel plutôt qu'importée : `db-local` reste pur, sans
 * dépendance vers un paquet natif, et le test peut fournir un double qui
 * reproduit fidèlement la restriction d'Android.
 */
export interface ConnexionCapacitor {
  execute(sql: string, transaction?: boolean): Promise<unknown>
  run(sql: string, valeurs?: ValeurSql[], transaction?: boolean): Promise<unknown>
  query(sql: string, valeurs?: ValeurSql[]): Promise<{ values?: unknown[] }>
  close(): Promise<unknown>
}

/**
 * Vrai pour une instruction qu'`execSQL` refuserait.
 *
 * On ne cherche pas à deviner quels PRAGMA renvoient une ligne : `PRAGMA
 * journal_mode` en renvoie une, `PRAGMA foreign_keys = ON` non, et la
 * liste change d'une version de SQLite à l'autre. Les router TOUS par
 * `query()` est correct dans les deux cas et ne coûte rien.
 */
export function estPragma(sql: string): boolean {
  return /^\s*PRAGMA\b/i.test(sql)
}

/**
 * Pose les réglages qui doivent précéder toute migration.
 *
 * WAL, c'est la différence entre « base corrompue après coupure de
 * courant » et « base intacte ». Sur une tablette de restaurant, la
 * coupure de courant n'est pas un cas limite.
 */
export async function preparerConnexionCapacitor(db: ConnexionCapacitor): Promise<void> {
  await db.query('PRAGMA journal_mode = WAL')
  await db.query('PRAGMA foreign_keys = ON')
}

export function adaptateurCapacitor(db: ConnexionCapacitor): AdaptateurSqlite {
  let profondeur = 0

  return {
    async executer(sql: string, p: readonly ValeurSql[] = []) {
      try {
        if (estPragma(sql)) {
          await db.query(sql)
          return
        }
        await db.run(sql, p as ValeurSql[], false)
      } catch (e) {
        throw new ErreurSqlite(`Échec de « ${sql.slice(0, 80)} »`, e)
      }
    },

    async executerScript(sql: string) {
      try {
        await db.execute(sql, false)
      } catch (e) {
        throw new ErreurSqlite("Échec de l'exécution du script SQL", e)
      }
    },

    async lire<T>(sql: string, p: readonly ValeurSql[] = []) {
      try {
        const r = await db.query(sql, p as ValeurSql[])
        return (r.values ?? []) as T[]
      } catch (e) {
        throw new ErreurSqlite(`Échec de la lecture « ${sql.slice(0, 80)} »`, e)
      }
    },

    async lireUne<T>(sql: string, p: readonly ValeurSql[] = []) {
      try {
        const r = await db.query(sql, p as ValeurSql[])
        return ((r.values ?? [])[0] ?? null) as T | null
      } catch (e) {
        throw new ErreurSqlite(`Échec de la lecture « ${sql.slice(0, 80)} »`, e)
      }
    },

    async transaction<T>(travail: () => Promise<T>): Promise<T> {
      // SAVEPOINT pour les transactions imbriquées : un dépôt peut en
      // appeler un autre sans que l'annulation de l'un défasse l'autre.
      const nom = `sp_${profondeur}`
      const racine = profondeur === 0
      profondeur += 1
      await db.execute(racine ? 'BEGIN;' : `SAVEPOINT ${nom};`, false)
      try {
        const resultat = await travail()
        await db.execute(racine ? 'COMMIT;' : `RELEASE ${nom};`, false)
        return resultat
      } catch (erreur) {
        await db.execute(racine ? 'ROLLBACK;' : `ROLLBACK TO ${nom};`, false)
        throw erreur
      } finally {
        profondeur -= 1
      }
    },

    async fermer() {
      await db.close()
    },
  }
}
