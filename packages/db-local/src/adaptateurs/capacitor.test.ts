/**
 * Régression Android : « Queries can be performed using SQLiteDatabase
 * query or rawQuery methods only. »
 *
 * Ce message a empêché le POS de démarrer sur une vraie tablette :
 * `PRAGMA journal_mode = WAL` renvoie une ligne, et l'adaptateur l'envoyait
 * à `execute()` — donc à `execSQL()` — qui refuse toute instruction dont
 * l'exécution produit une ligne.
 *
 * ── Pourquoi ce double est fidèle ───────────────────────────────────────
 * Il ne devine pas le comportement d'Android : il PORTE les deux morceaux
 * de code qui décident, lus dans le paquet installé
 * (`@capacitor-community/sqlite@7`) :
 *
 *   1. le découpeur `UtilsSQLite.getStatementsArray()` — un `split(";\n")`
 *      suivi d'un recollage des déclencheurs ;
 *   2. le refus de SQLCipher : `executeNonQuery()` lève dès que
 *      `sqlite3_step()` renvoie `SQLITE_ROW`.
 *
 * Le critère est bien « l'exécution a produit une ligne », PAS « la
 * requête déclare des colonnes » : `ALTER TABLE … ADD COLUMN … NOT NULL
 * DEFAULT 1` déclare une colonne de vérification interne mais ne renvoie
 * aucune ligne — et passe donc sur Android, comme dans des millions
 * d'applications. Confondre les deux critères ferait échouer ce test sur
 * du SQL parfaitement valide.
 *
 * Un adaptateur qui passe ici démarre sur la tablette. C'est le seul
 * moyen de le savoir sans émulateur Android dans la CI.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  adaptateurCapacitor,
  estPragma,
  preparerConnexionCapacitor,
  type ConnexionCapacitor,
} from './capacitor.js'
import { migrer, MIGRATIONS } from '../index.js'
import type { ValeurSql } from '../adaptateur.js'

const MESSAGE_ANDROID =
  'Queries can be performed using SQLiteDatabase query or rawQuery methods only.'

/**
 * Port de `UtilsSQLite.getStatementsArray()` (Java, plugin Capacitor).
 *
 * Ce découpeur est rudimentaire, et c'est précisément pour cela qu'il faut
 * le reproduire : il impose au SQL de nos migrations une forme précise —
 * chaque instruction terminée par « ; » suivi d'un saut de ligne, et le
 * « END; » d'un déclencheur SEUL sur sa ligne. Une migration mal formatée
 * partirait en morceaux sur la tablette et nulle part ailleurs.
 */
function decouperCommeLePlugin(statements: string): string[] {
  let tableau = statements.replace(/end;/g, 'END;').split(';\n')

  // `concatRemoveEnd` : recolle « … BEGIN … » avec le « END » isolé.
  tableau = tableau.map((s) => s.trim())
  for (let i = tableau.indexOf('END'); i > -1; i = tableau.indexOf('END')) {
    tableau[i - 1] = `${tableau[i - 1]}; END`
    tableau.splice(i, 1)
  }

  // Chaque instruction est aplatie sur une ligne, commentaires « -- » ôtés.
  const aplaties = tableau.map((instruction) =>
    instruction
      .split('\n')
      .map((ligne) => {
        const nette = ligne.trim()
        const idx = nette.indexOf('--')
        return idx > -1 ? nette.slice(0, idx) : nette
      })
      .filter((ligne) => ligne.length > 0)
      .join(' '),
  )

  if (aplaties.length > 0 && aplaties[aplaties.length - 1]!.trim().length === 0) {
    aplaties.pop()
  }
  return aplaties
}

interface DoubleAndroid extends ConnexionCapacitor {
  /** Tout le SQL réellement passé par `execSQL`, dans l'ordre. */
  readonly viaExecSql: string[]
  chemin: string
}

function connexionAndroid(chemin: string): DoubleAndroid {
  const db = new DatabaseSync(chemin)
  const viaExecSql: string[] = []

  /**
   * Port d'`executeNonQuery()` (SQLCipher, `SQLiteConnection.cpp`) :
   * exécute, puis lève si un `sqlite3_step()` a renvoyé une ligne.
   * L'ordre compte : l'instruction est bel et bien exécutée avant le refus.
   */
  const execSql = (sql: string) => {
    if (!sql.trim()) return
    viaExecSql.push(sql.trim())
    const lignes = db.prepare(sql).all()
    if (lignes.length > 0) throw new Error(MESSAGE_ANDROID)
  }

  return {
    viaExecSql,
    chemin,
    async execute(sql: string) {
      for (const instruction of decouperCommeLePlugin(sql)) execSql(instruction)
      return {}
    },
    async run(sql: string, valeurs: ValeurSql[] = []) {
      if (!sql.trim()) return {}
      viaExecSql.push(sql.trim())
      const lignes = db.prepare(sql).all(...(valeurs as never[]))
      if (lignes.length > 0) throw new Error(MESSAGE_ANDROID)
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

describe('estPragma', () => {
  it('reconnaît un PRAGMA quelle que soit sa casse ou son indentation', () => {
    expect(estPragma('PRAGMA journal_mode = WAL')).toBe(true)
    expect(estPragma('  pragma foreign_keys = ON')).toBe(true)
    expect(estPragma('\n\tPragma user_version')).toBe(true)
  })

  it('ne confond pas un identifiant commençant par « pragma »', () => {
    expect(estPragma('SELECT pragmatique FROM t')).toBe(false)
    expect(estPragma('INSERT INTO pragmas VALUES (1)')).toBe(false)
  })
})

describe('adaptateurCapacitor sur une connexion au comportement Android', () => {
  let dossier: string
  let connexion: DoubleAndroid

  beforeEach(() => {
    // Un vrai fichier, pas « :memory: » : une base en mémoire répond
    // toujours « memory » à PRAGMA journal_mode, ce qui rendrait la
    // vérification du WAL sans valeur.
    dossier = mkdtempSync(join(tmpdir(), 'kaissi-capacitor-'))
    connexion = connexionAndroid(join(dossier, 'kaissi.db'))
  })

  afterEach(async () => {
    await connexion.close().catch(() => {})
    rmSync(dossier, { recursive: true, force: true })
  })

  it('le double reproduit bien le refus d’Android', async () => {
    // Sans cette assertion, tout le reste du fichier pourrait passer sur un
    // double trop permissif : un test qui ne teste rien.
    await expect(connexion.execute('PRAGMA journal_mode = WAL')).rejects.toThrow(
      MESSAGE_ANDROID,
    )
    await expect(connexion.run('SELECT 1')).rejects.toThrow(MESSAGE_ANDROID)
  })

  it('le double laisse passer ce qu’Android laisse passer', async () => {
    // Le critère est « une ligne a été produite », pas « des colonnes sont
    // déclarées ». `ALTER TABLE … NOT NULL DEFAULT` tombe entre les deux.
    await connexion.execute('CREATE TABLE t (a INTEGER);\n')
    await expect(
      connexion.execute('ALTER TABLE t ADD COLUMN b INTEGER NOT NULL DEFAULT 1;\n'),
    ).resolves.toBeDefined()
    await expect(connexion.execute('PRAGMA foreign_keys = ON;\n')).resolves.toBeDefined()
  })

  it('active le WAL sans passer par execSQL', async () => {
    await preparerConnexionCapacitor(connexion)
    expect(connexion.viaExecSql).toEqual([])

    const db = adaptateurCapacitor(connexion)
    const [mode] = await db.lire<{ journal_mode: string }>('PRAGMA journal_mode')
    expect(mode?.journal_mode).toBe('wal')
  })

  it('route les PRAGMA de `executer` par query()', async () => {
    const db = adaptateurCapacitor(connexion)
    await db.executer('PRAGMA foreign_keys = ON')
    await db.executer('PRAGMA journal_mode = WAL')
    expect(connexion.viaExecSql).toEqual([])

    const [fk] = await db.lire<{ foreign_keys: number }>('PRAGMA foreign_keys')
    expect(fk?.foreign_keys).toBe(1)
  })

  it('applique la totalité des migrations locales', async () => {
    // Le scénario exact du démarrage sur tablette — celui qui affichait
    // « Démarrage impossible ».
    await preparerConnexionCapacitor(connexion)
    const db = adaptateurCapacitor(connexion)

    const resultat = await migrer(db)
    expect(resultat.appliquees.length).toBe(MIGRATIONS.length)

    // Les déclencheurs d'immuabilité ont survécu au découpeur du plugin.
    const declencheurs = await db.lire<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    expect(declencheurs.map((d) => d.name)).toContain('order_events_pas_delete')

    // Idempotent : un second démarrage ne réapplique rien.
    const second = await migrer(db)
    expect(second.appliquees).toEqual([])
  })

  it('annule tout le travail d’une transaction qui échoue', async () => {
    const db = adaptateurCapacitor(connexion)
    await db.executerScript('CREATE TABLE t (a INTEGER PRIMARY KEY);\n')

    await expect(
      db.transaction(async () => {
        await db.executer('INSERT INTO t (a) VALUES (?)', [1])
        throw new Error('échec métier')
      }),
    ).rejects.toThrow('échec métier')

    expect(await db.lire('SELECT a FROM t')).toEqual([])
  })

  it('conserve le message SQLite d’origine dans l’erreur', async () => {
    const db = adaptateurCapacitor(connexion)
    await expect(db.executer('INSERT INTO inexistante VALUES (1)')).rejects.toThrow(
      /inexistante/,
    )
  })
})
