/**
 * Ouverture de la base locale du terminal.
 *
 * Deux implémentations de `AdaptateurSqlite`, choisies à l'exécution :
 *
 *   • APPAREIL (Capacitor natif) → @capacitor-community/sqlite.
 *     C'est le chemin de PRODUCTION : base persistante, WAL, transactions
 *     ACID, survit au redémarrage de l'appareil et à la coupure de courant.
 *
 *   • NAVIGATEUR (`pnpm dev`)   → base en mémoire, réinitialisée à chaque
 *     rechargement. Confort de développement UNIQUEMENT : le stockage
 *     navigateur est évinçable par l'OS sous pression mémoire, ce qui est
 *     inacceptable pour des données d'encaissement.
 *
 * Aucun des deux chemins ne fait le moindre appel réseau.
 */

import type { AdaptateurSqlite, ValeurSql } from '@kaissi/db-local'
import { Capacitor } from '@capacitor/core'

export const NOM_BASE = 'kaissi'

export type ModeStockage = 'natif' | 'memoire'

export interface BaseLocale {
  readonly adaptateur: AdaptateurSqlite
  readonly mode: ModeStockage
  /** Vrai si les données survivent au redémarrage de l'application. */
  readonly persistant: boolean
  readonly detail: string
}

/** Vrai si l'on tourne dans une coque native (Android / iOS). */
export function estNatif(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export async function ouvrirBaseLocale(): Promise<BaseLocale> {
  if (estNatif()) {
    const adaptateur = await adaptateurCapacitor()
    return {
      adaptateur,
      mode: 'natif',
      persistant: true,
      detail: `SQLite natif (${NOM_BASE}.db) — ${Capacitor.getPlatform()}`,
    }
  }
  // `import.meta.env.DEV` est remplacé par une constante au build : Vite
  // élimine complètement cette branche en production, donc le WASM de
  // développement ne pèse pas un octet dans l'APK.
  if (import.meta.env.DEV) {
    const { adaptateurMemoire } = await import('./sqlite-memoire.js')
    return {
      adaptateur: await adaptateurMemoire(),
      mode: 'memoire',
      persistant: false,
      detail: 'Base EN MÉMOIRE — navigateur de développement, non persistante',
    }
  }

  throw new Error(
    "Aucun moteur SQLite disponible. Le POS Kaissi est prévu pour tourner " +
      "EMPAQUETÉ dans l'APK Android (Capacitor natif), jamais comme site web.",
  )
}

/**
 * Adaptateur @capacitor-community/sqlite.
 *
 * L'import est DYNAMIQUE : le module natif n'existe pas dans un navigateur,
 * et l'importer statiquement ferait échouer le build de développement.
 */
async function adaptateurCapacitor(): Promise<AdaptateurSqlite> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite')
  const connexion = new SQLiteConnection(CapacitorSQLite)

  // Réutilise une connexion existante après un rechargement à chaud.
  const dejaOuverte = (await connexion.isConnection(NOM_BASE, false)).result === true
  const db = dejaOuverte
    ? await connexion.retrieveConnection(NOM_BASE, false)
    : await connexion.createConnection(NOM_BASE, false, 'no-encryption', 1, false)

  await db.open()
  // WAL : la différence entre « base corrompue après coupure » et « base intacte ».
  await db.execute('PRAGMA journal_mode = WAL;')
  await db.execute('PRAGMA foreign_keys = ON;')

  let profondeur = 0

  return {
    async executer(sql: string, params: readonly ValeurSql[] = []) {
      await db.run(sql, params as ValeurSql[], false)
    },

    async executerScript(sql: string) {
      await db.execute(sql, false)
    },

    async lire<T>(sql: string, params: readonly ValeurSql[] = []) {
      const r = await db.query(sql, params as ValeurSql[])
      return (r.values ?? []) as T[]
    },

    async lireUne<T>(sql: string, params: readonly ValeurSql[] = []) {
      const r = await db.query(sql, params as ValeurSql[])
      return ((r.values ?? [])[0] ?? null) as T | null
    },

    async transaction<T>(travail: () => Promise<T>): Promise<T> {
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
      await connexion.closeConnection(NOM_BASE, false)
    },
  }
}
