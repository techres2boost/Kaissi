/**
 * Base SQLite EN MÉMOIRE, pour `pnpm dev` dans un navigateur.
 *
 * ⚠ Confort de développement UNIQUEMENT. Ce chemin :
 *   • ne persiste rien — tout est perdu au rechargement de la page ;
 *   • n'est PAS inclus dans le build de production (voir la garde
 *     `import.meta.env.DEV` dans `sqlite.ts`), donc pas un octet de WASM
 *     ne part dans l'APK.
 *
 * En production, la seule implémentation est @capacitor-community/sqlite.
 * Le stockage navigateur est évinçable par l'OS sous pression mémoire :
 * inacceptable pour des données d'encaissement.
 */

import type { AdaptateurSqlite, ValeurSql } from '@kaissi/db-local'
import { ErreurSqlite } from '@kaissi/db-local'
import initSqlJs, { type Database } from 'sql.js'
import urlWasm from 'sql.js/dist/sql-wasm.wasm?url'

let base: Database | null = null

export async function adaptateurMemoire(): Promise<AdaptateurSqlite> {
  if (!base) {
    const SQL = await initSqlJs({ locateFile: () => urlWasm })
    base = new SQL.Database()
  }
  const db = base
  let profondeur = 0

  const lignes = <T>(sql: string, params: readonly ValeurSql[]): T[] => {
    const stmt = db.prepare(sql)
    try {
      if (params.length > 0) stmt.bind(params as ValeurSql[])
      const resultat: T[] = []
      while (stmt.step()) resultat.push(stmt.getAsObject() as T)
      return resultat
    } finally {
      stmt.free()
    }
  }

  return {
    async executer(sql, params = []) {
      try {
        db.run(sql, params as ValeurSql[])
      } catch (e) {
        throw new ErreurSqlite(`Échec de « ${sql.slice(0, 80)} »`, e)
      }
    },

    async executerScript(sql) {
      try {
        db.exec(sql)
      } catch (e) {
        throw new ErreurSqlite("Échec de l'exécution du script SQL", e)
      }
    },

    async lire(sql, params = []) {
      try {
        return lignes(sql, params) as never
      } catch (e) {
        throw new ErreurSqlite(`Échec de la lecture « ${sql.slice(0, 80)} »`, e)
      }
    },

    async lireUne(sql, params = []) {
      try {
        return (lignes(sql, params)[0] ?? null) as never
      } catch (e) {
        throw new ErreurSqlite(`Échec de la lecture « ${sql.slice(0, 80)} »`, e)
      }
    },

    async transaction(travail) {
      const nom = `sp_${profondeur}`
      const racine = profondeur === 0
      profondeur += 1
      db.run(racine ? 'BEGIN' : `SAVEPOINT ${nom}`)
      try {
        const resultat = await travail()
        db.run(racine ? 'COMMIT' : `RELEASE ${nom}`)
        return resultat
      } catch (e) {
        db.run(racine ? 'ROLLBACK' : `ROLLBACK TO ${nom}`)
        throw e
      } finally {
        profondeur -= 1
      }
    },

    async fermer() {
      // On garde la base vivante entre deux rechargements à chaud de Vite :
      // la refermer ferait perdre le catalogue à chaque sauvegarde de fichier.
    },
  }
}
