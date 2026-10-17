/**
 * Régression iPhone : « Échec de la migration locale 14 : near "id": syntax
 * error ». La caisse ne démarrait plus après la mise à jour TestFlight.
 *
 * ── Pourquoi ce double est fidèle ───────────────────────────────────────
 * Comme le double Android (`capacitor.test.ts`), il ne devine rien : il
 * PORTE le code qui réécrit le SQL avant SQLite, lu dans le paquet installé
 * (`@capacitor-community/sqlite@7`, dossier `ios/Plugin`) :
 *
 *   1. `CapacitorSQLite.execute` : coupe aux « \n », ôte les espaces de
 *      chaque ligne, recolle avec « \n » ;
 *   2. `UtilsSQLCipher.execute` : si le script contient « DELETE FROM »,
 *      supprime TOUS les « \n », coupe aux « ; », jette le dernier morceau
 *      et recolle avec « ; » (les DELETE ne sont réécrits en UPDATE que sur
 *      une base qui porte `last_modified` et `sql_deleted` — pas la nôtre) ;
 *   3. `sqlite3_exec` sur le résultat.
 */

import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { adaptateurCapacitor, preparerConnexionCapacitor, type ConnexionCapacitor } from './capacitor.js'
import { aplatirScript } from './aplatir.js'
import { migrer, MIGRATIONS } from '../index.js'
import type { ValeurSql } from '../adaptateur.js'

/** Ce que le greffon iOS fait du script avant de le donner à SQLite. */
export function reecrireCommeIos(script: string): string {
  // 1. CapacitorSQLite.execute
  let sql = script
  if (sql.includes('\n')) {
    sql = sql
      .split('\n')
      .filter((ligne) => ligne.length > 0) // `split(separator:)` de Swift omet les vides
      .map((ligne) => ligne.trim())
      .join('\n')
  }
  // 2. UtilsSQLCipher.execute
  if (sql.toUpperCase().includes('DELETE FROM')) {
    sql = sql.replaceAll('\n', '')
    const morceaux = sql.split(';')
    morceaux.pop()
    sql = morceaux.join(';')
  }
  return sql
}

function connexionIos(): ConnexionCapacitor {
  const db = new DatabaseSync(':memory:')
  return {
    async execute(sql: string) {
      db.exec(reecrireCommeIos(sql))
      return {}
    },
    async run(sql: string, valeurs: ValeurSql[] = []) {
      db.prepare(sql).run(...(valeurs as never[]))
      return {}
    },
    async query(sql: string, valeurs: ValeurSql[] = []) {
      return { values: db.prepare(sql).all(...(valeurs as never[])) }
    },
    async close() {
      db.close()
      return {}
    },
  }
}

describe('le greffon iOS', () => {
  it('le double reproduit la panne de l’iPhone sur la migration 14 brute', () => {
    // Sans cette assertion, le double pourrait être trop permissif et le
    // reste du fichier ne rien prouver.
    const m14 = MIGRATIONS.find((m) => m.version === 14)!
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE discounts (id TEXT); CREATE TABLE customers (id TEXT); CREATE TABLE sync_state (cle TEXT, valeur TEXT);')
    expect(() => db.exec(reecrireCommeIos(m14.sql))).toThrow(/syntax error/)
  })

  it('applique la totalité des migrations locales, une fois le script aplati', async () => {
    const connexion = connexionIos()
    await preparerConnexionCapacitor(connexion)
    const db = adaptateurCapacitor(connexion)

    const resultat = await migrer(db)
    expect(resultat.appliquees.length).toBe(MIGRATIONS.length)

    const declencheurs = await db.lire<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    expect(declencheurs.map((d) => d.name)).toContain('order_events_pas_delete')
  })
})

describe('aplatirScript', () => {
  it('une instruction par ligne, sans commentaire', () => {
    expect(aplatirScript('-- en-tête\nDELETE FROM t\n  WHERE a = 1; /* bloc */\nUPDATE t SET a = 2\n')).toBe(
      'DELETE FROM t WHERE a = 1;\nUPDATE t SET a = 2;\n',
    )
  })

  it('ne touche pas au contenu d’une chaîne', () => {
    expect(aplatirScript("INSERT INTO t VALUES ('a -- b ; c', 'l''x');")).toBe(
      "INSERT INTO t VALUES ('a -- b ; c', 'l''x');\n",
    )
  })

  it('garde le corps d’un déclencheur sur une seule instruction', () => {
    const sql = `CREATE TRIGGER x BEFORE DELETE ON t
BEGIN
  SELECT RAISE(ABORT, 'non');
END;
CREATE TABLE u (a);`
    expect(aplatirScript(sql)).toBe(
      "CREATE TRIGGER x BEFORE DELETE ON t BEGIN SELECT RAISE(ABORT, 'non'); END;\nCREATE TABLE u (a);\n",
    )
  })

  it('aucune migration ne porte de saut de ligne DANS une chaîne', () => {
    // Le greffon iOS les retirerait aussi : une donnée serait altérée en
    // silence. L'aplatissement les laisse intacts — il faut donc qu'il n'y
    // en ait pas.
    for (const m of MIGRATIONS) {
      const aplati = aplatirScript(m.sql)
      const lignes = aplati.split('\n').filter(Boolean)
      for (const ligne of lignes) expect(ligne.endsWith(';'), `migration ${m.version}`).toBe(true)
    }
  })
})
