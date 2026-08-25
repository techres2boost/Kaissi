/**
 * Adaptateur `node:sqlite` — pour les TESTS et l'outillage Node uniquement.
 *
 * Jamais embarqué dans l'APK : en production le POS utilise
 * @capacitor-community/sqlite (voir `apps/pos/src/donnees/`).
 *
 * `node:sqlite` est intégré à Node ≥ 22 : aucune compilation native, donc
 * une CI qui démarre en quelques secondes et ne casse pas au premier
 * changement de version de Node.
 */

import { DatabaseSync } from 'node:sqlite'
import { ErreurSqlite, type AdaptateurSqlite, type ValeurSql } from '../adaptateur.js'

type ParamsSql = readonly ValeurSql[]

export function adaptateurNode(chemin = ':memory:'): AdaptateurSqlite {
  const db = new DatabaseSync(chemin)
  let profondeurTransaction = 0

  const params = (p: ParamsSql) => p as unknown as never[]

  return {
    async executer(sql, p = []) {
      // Les PRAGMA renvoient parfois une ligne : `run` les refuse.
      if (/^\s*PRAGMA/i.test(sql)) {
        db.exec(sql)
        return
      }
      try {
        db.prepare(sql).run(...params(p))
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

    async lire(sql, p = []) {
      try {
        return db.prepare(sql).all(...params(p)) as never
      } catch (e) {
        throw new ErreurSqlite(`Échec de la lecture « ${sql.slice(0, 80)} »`, e)
      }
    },

    async lireUne(sql, p = []) {
      try {
        return (db.prepare(sql).get(...params(p)) ?? null) as never
      } catch (e) {
        throw new ErreurSqlite(`Échec de la lecture « ${sql.slice(0, 80)} »`, e)
      }
    },

    async transaction(travail) {
      // SAVEPOINT pour les transactions imbriquées : un dépôt peut en appeler
      // un autre sans que l'annulation de l'un défasse le travail de l'autre.
      const nom = `sp_${profondeurTransaction}`
      const racine = profondeurTransaction === 0
      profondeurTransaction += 1
      db.exec(racine ? 'BEGIN' : `SAVEPOINT ${nom}`)
      try {
        const resultat = await travail()
        db.exec(racine ? 'COMMIT' : `RELEASE ${nom}`)
        return resultat
      } catch (e) {
        db.exec(racine ? 'ROLLBACK' : `ROLLBACK TO ${nom}`)
        throw e
      } finally {
        profondeurTransaction -= 1
      }
    },

    async fermer() {
      db.close()
    },
  }
}
