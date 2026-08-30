/**
 * Ouverture de la base locale du terminal.
 *
 * Trois implémentations de `AdaptateurSqlite`, choisies à l'exécution :
 *
 *   • APPAREIL (Capacitor natif) → @capacitor-community/sqlite.
 *     C'est le chemin NOMINAL : base persistante, WAL, transactions ACID,
 *     survit au redémarrage de l'appareil et à la coupure de courant, et
 *     n'est évinçable par personne.
 *
 *   • SITE STATIQUE (cible `web`) → SQLite WebAssembly persisté dans
 *     IndexedDB. Chemin de DÉMARRAGE RAPIDE, choisi pour ouvrir un
 *     restaurant sans chaîne de build Android. Ses limites exactes sont
 *     écrites dans `sqlite-web.ts` — et rapportées à l'écran Diagnostic.
 *
 *   • NAVIGATEUR (`pnpm pos:dev`) → base en mémoire, réinitialisée à chaque
 *     rechargement. Confort de développement UNIQUEMENT.
 *
 * Aucun des trois chemins ne fait le moindre appel réseau.
 */

import {
  adaptateurCapacitor,
  preparerConnexionCapacitor,
  type AdaptateurSqlite,
} from '@kaissi/db-local'
import { Capacitor } from '@capacitor/core'

export const NOM_BASE = 'kaissi'

export type ModeStockage = 'natif' | 'web' | 'memoire'

export interface BaseLocale {
  readonly adaptateur: AdaptateurSqlite
  readonly mode: ModeStockage
  /** Vrai si les données survivent au redémarrage de l'application. */
  readonly persistant: boolean
  readonly detail: string
  /**
   * Réserve à énoncer sur cette base, ou `null` si elle n'en a aucune.
   *
   * Distinct de `persistant` : une base peut très bien tout conserver ET
   * rester évinçable par le système. Confondre les deux amènerait soit à
   * crier au loup, soit à taire un vrai risque.
   */
  readonly avertissement: string | null
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
      avertissement: null,
    }
  }
  // `import.meta.env.VITE_CIBLE` est remplacé par une CONSTANTE au build :
  // sur la cible Android la comparaison est toujours fausse, Vite élimine la
  // branche, et le moteur WebAssembly ne pèse pas un octet dans l'APK.
  if (import.meta.env.VITE_CIBLE === 'web') {
    const { adaptateurWeb } = await import('./sqlite-web.js')
    const base = await adaptateurWeb()
    return {
      adaptateur: base.adaptateur,
      mode: 'web',
      // Les ventes survivent au rechargement et au redémarrage : c'est bien
      // une base persistante. Ce qui manque éventuellement, c'est la
      // PROTECTION contre l'éviction — dit à part, sans ambiguïté.
      persistant: true,
      detail: base.detail,
      avertissement: base.protege
        ? null
        : "Le navigateur a refusé le stockage persistant : sous forte pression " +
          "disque, il peut effacer les données de ce site. Installez " +
          "l'application depuis le navigateur (« Installer »), ou passez à " +
          "l'APK Android, dont le stockage n'est évinçable par personne.",
    }
  }

  // Idem pour `import.meta.env.DEV` : la branche disparaît en production.
  if (import.meta.env.DEV) {
    const { adaptateurMemoire } = await import('./sqlite-memoire.js')
    return {
      adaptateur: await adaptateurMemoire(),
      mode: 'memoire',
      persistant: false,
      detail: 'Base EN MÉMOIRE — navigateur de développement, non persistante',
      avertissement:
        'Base en mémoire : tout disparaît au rechargement. Développement ' +
        'uniquement — jamais un poste de caisse réel.',
    }
  }

  throw new Error(
    "Aucun moteur SQLite disponible. Ce bundle a été construit pour la cible " +
      "Android (SQLite natif de Capacitor) et tourne hors d'une coque native. " +
      "Pour servir le POS comme site, construisez la cible web : " +
      '`pnpm pos:build:web`.',
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
