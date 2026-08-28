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

import {
  adaptateurCapacitor,
  preparerConnexionCapacitor,
  type AdaptateurSqlite,
} from '@kaissi/db-local'
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
    const adaptateur = await ouvrirConnexionNative()
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
 * Ouvre la base native et rend l'adaptateur correspondant.
 *
 * L'import est DYNAMIQUE : le module natif n'existe pas dans un navigateur,
 * et l'importer statiquement ferait échouer le build de développement.
 *
 * Toute la logique d'adaptation vit dans `@kaissi/db-local`
 * (`adaptateurs/capacitor.ts`), où elle est testée contre un double qui
 * reproduit la restriction d'`execSQL` d'Android. Ici, on se contente
 * d'ouvrir la connexion : ce fichier n'a rien à tester.
 */
async function ouvrirConnexionNative(): Promise<AdaptateurSqlite> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite')
  const connexion = new SQLiteConnection(CapacitorSQLite)

  // Réutilise une connexion existante après un rechargement à chaud.
  const dejaOuverte = (await connexion.isConnection(NOM_BASE, false)).result === true
  const db = dejaOuverte
    ? await connexion.retrieveConnection(NOM_BASE, false)
    : await connexion.createConnection(NOM_BASE, false, 'no-encryption', 1, false)

  await db.open()
  await preparerConnexionCapacitor(db)

  const adaptateur = adaptateurCapacitor(db)
  return {
    ...adaptateur,
    // La connexion doit être RELÂCHÉE en plus d'être fermée : sans cela, une
    // réouverture après rechargement à chaud échoue sur « already exists ».
    async fermer() {
      await adaptateur.fermer()
      await connexion.closeConnection(NOM_BASE, false)
    },
  }
}
