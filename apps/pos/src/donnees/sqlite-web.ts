/**
 * Base SQLite du POS servi comme SITE STATIQUE (cible `web`).
 *
 * SQLite compilé en WebAssembly (sql.js), dont l'image complète est
 * sauvegardée dans IndexedDB après chaque écriture validée.
 *
 * ── Ce que cette cible garantit, et ce qu'elle ne garantit pas ────────────
 *
 * Elle garantit : la caisse s'ouvre et encaisse sans réseau une fois la page
 * mise en cache, et les ventes survivent au rechargement, à la fermeture de
 * l'onglet et au redémarrage de la machine.
 *
 * Elle NE garantit PAS l'inviolabilité du stockage : sous pression disque, un
 * navigateur peut évincer les données d'une origine. On demande donc le
 * stockage PERSISTANT (`navigator.storage.persist()`), qui met l'origine
 * hors de portée de l'éviction automatique — et l'écran Diagnostic dit
 * clairement si la demande a été refusée.
 *
 * C'est pour cette raison que l'APK Android reste la cible nominale : son
 * SQLite natif n'est évinçable par personne. La cible web existe pour
 * démarrer un restaurant le jour même, sans chaîne de build Android.
 *
 * ── Pourquoi sauvegarder l'image entière ──────────────────────────────────
 *
 * sql.js tient sa base en mémoire ; il n'a pas de fichier. La seule
 * persistance possible est d'exporter l'image et de l'écrire. On le fait à
 * la SORTIE de chaque transaction racine, et on l'ATTEND : différer la
 * sauvegarde ferait perdre l'encaissement qui vient d'être validé si
 * l'onglet meurt dans l'intervalle. Une base de service pèse quelques
 * centaines de kilo-octets — l'export coûte quelques millisecondes.
 */

import type { AdaptateurSqlite, ValeurSql } from '@kaissi/db-local'
import { ErreurSqlite } from '@kaissi/db-local'
import initSqlJs, { type Database } from 'sql.js'
import urlWasm from 'sql.js/dist/sql-wasm.wasm?url'

const BASE_IDB = 'kaissi-pos'
const MAGASIN = 'base'
const CLE = 'sqlite'

export interface BaseWeb {
  readonly adaptateur: AdaptateurSqlite
  /**
   * Vrai si le navigateur a accordé le stockage PERSISTANT, c'est-à-dire s'il
   * s'engage à ne pas évincer l'origine sous pression disque.
   *
   * À ne pas confondre avec « les données survivent au rechargement » : cela,
   * IndexedDB le fait dans tous les cas. Le refus ne rend pas la caisse
   * volatile, il la rend ÉVINÇABLE — un risque qui doit être dit, pas caché.
   */
  readonly protege: boolean
  readonly detail: string
}

// ─── IndexedDB, réduit à deux opérations ────────────────────────────────────

function ouvrirIdb(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(BASE_IDB, 1)
    requete.onupgradeneeded = () => {
      requete.result.createObjectStore(MAGASIN)
    }
    requete.onsuccess = () => resoudre(requete.result)
    requete.onerror = () =>
      rejeter(new ErreurSqlite("IndexedDB inaccessible — navigation privée ?", requete.error))
  })
}

function lireImage(idb: IDBDatabase): Promise<Uint8Array | null> {
  return new Promise((resoudre, rejeter) => {
    const requete = idb.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).get(CLE)
    requete.onsuccess = () => {
      const valeur = requete.result as ArrayBuffer | Uint8Array | undefined
      if (!valeur) return resoudre(null)
      resoudre(valeur instanceof Uint8Array ? valeur : new Uint8Array(valeur))
    }
    requete.onerror = () => rejeter(requete.error)
  })
}

function ecrireImage(idb: IDBDatabase, image: Uint8Array): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const tx = idb.transaction(MAGASIN, 'readwrite')
    // `oncomplete` de la TRANSACTION, pas `onsuccess` de la requête : la
    // seconde signale que l'écriture est acceptée, la première qu'elle est
    // durable. Confondre les deux, c'est croire une vente enregistrée alors
    // qu'elle est encore en vol.
    tx.oncomplete = () => resoudre()
    tx.onerror = () => rejeter(tx.error)
    tx.onabort = () => rejeter(tx.error)
    // Une COPIE : sql.js rend une vue sur sa mémoire linéaire, que la
    // prochaine écriture peut réallouer sous les pieds d'IndexedDB.
    tx.objectStore(MAGASIN).put(new Uint8Array(image), CLE)
  })
}

// ─── Adaptateur ─────────────────────────────────────────────────────────────

export async function adaptateurWeb(): Promise<BaseWeb> {
  const idb = await ouvrirIdb()
  const SQL = await initSqlJs({ locateFile: () => urlWasm })
  const image = await lireImage(idb)
  const db: Database = image ? new SQL.Database(image) : new SQL.Database()

  // Demandé UNE fois : sans cela, le navigateur range l'origine parmi les
  // caches jetables. Certains navigateurs l'accordent sans rien demander,
  // d'autres exigent que le site soit installé — d'où le rapport honnête.
  let protege = false
  try {
    protege = (await navigator.storage?.persisted?.()) === true
    if (!protege) protege = (await navigator.storage?.persist?.()) === true
  } catch {
    protege = false
  }

  let profondeur = 0
  let sale = false
  /** Sérialise les sauvegardes : deux exports concurrents s'écraseraient. */
  let file: Promise<void> = Promise.resolve()

  const sauvegarder = async (): Promise<void> => {
    if (!sale) return
    sale = false
    file = file.then(() => ecrireImage(idb, db.export()))
    await file
  }

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

  const adaptateur: AdaptateurSqlite = {
    async executer(sql, params = []) {
      try {
        db.run(sql, params as ValeurSql[])
        sale = true
      } catch (e) {
        throw new ErreurSqlite(`Échec de « ${sql.slice(0, 80)} »`, e)
      }
      // Hors transaction, chaque écriture est sa propre unité de travail.
      if (profondeur === 0) await sauvegarder()
    },

    async executerScript(sql) {
      try {
        db.exec(sql)
        sale = true
      } catch (e) {
        throw new ErreurSqlite("Échec de l'exécution du script SQL", e)
      }
      if (profondeur === 0) await sauvegarder()
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
        // La sauvegarde suit le COMMIT, jamais l'inverse : une image écrite
        // avant la validation contiendrait une transaction en cours.
        if (racine) {
          profondeur -= 1
          await sauvegarder()
          return resultat
        }
        profondeur -= 1
        return resultat
      } catch (e) {
        db.run(racine ? 'ROLLBACK' : `ROLLBACK TO ${nom}`)
        profondeur -= 1
        throw e
      }
    },

    async fermer() {
      await sauvegarder()
    },
  }

  // Dernier filet : un onglet fermé ou masqué pendant qu'une écriture hors
  // transaction n'a pas encore été sauvegardée.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void sauvegarder()
    })
  }

  return {
    adaptateur,
    protege,
    detail: protege
      ? 'SQLite WebAssembly dans IndexedDB — stockage persistant accordé'
      : 'SQLite WebAssembly dans IndexedDB — stockage persistant REFUSÉ par le ' +
        'navigateur : les ventes survivent au rechargement, mais l’origine ' +
        'reste évinçable sous pression disque',
  }
}
