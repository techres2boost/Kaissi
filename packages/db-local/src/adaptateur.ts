/**
 * Adaptateur SQLite — la seule frontière d'entrée/sortie du paquet.
 *
 * Trois implémentations coexistent, avec la MÊME interface :
 *   • @capacitor-community/sqlite  → Android (le chemin de production) ;
 *   • wa-sqlite / OPFS             → navigateur, repli de secours ;
 *   • better-sqlite3               → Node, pour les tests.
 *
 * Aucun code métier ne connaît laquelle est active : c'est ce qui permet de
 * tester les migrations et les dépôts sans émulateur Android.
 */

export type ValeurSql = string | number | null | Uint8Array

export interface AdaptateurSqlite {
  /** Exécute une instruction sans résultat (INSERT, UPDATE, DDL). */
  executer(sql: string, params?: readonly ValeurSql[]): Promise<void>
  /** Exécute plusieurs instructions séparées par « ; » (migrations). */
  executerScript(sql: string): Promise<void>
  /** Lit des lignes. */
  lire<T = Record<string, ValeurSql>>(
    sql: string,
    params?: readonly ValeurSql[],
  ): Promise<T[]>
  /** Lit une ligne au plus. */
  lireUne<T = Record<string, ValeurSql>>(
    sql: string,
    params?: readonly ValeurSql[],
  ): Promise<T | null>
  /**
   * Exécute `travail` dans une transaction. Un échec annule TOUT.
   * L'atomicité n'est pas un luxe ici : une migration à moitié appliquée
   * sur la tablette d'un restaurant à Sfax n'est pas réparable à distance.
   */
  transaction<T>(travail: () => Promise<T>): Promise<T>
  /** Ferme la base. */
  fermer(): Promise<void>
}

export class ErreurSqlite extends Error {
  constructor(message: string, cause?: unknown) {
    // Le message d'origine de SQLite est CONSERVÉ dans le message final :
    // sans lui, un « ABORT » de déclencheur devient indiagnosticable sur
    // la tablette d'un client, à distance.
    const detail = cause instanceof Error ? cause.message : cause ? String(cause) : ''
    super(detail ? `${message} — ${detail}` : message, { cause })
    this.name = 'ErreurSqlite'
  }
}
