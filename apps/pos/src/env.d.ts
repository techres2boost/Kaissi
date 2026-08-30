/// <reference types="vite/client" />

/**
 * Variables de build du POS.
 *
 * Ce sont des CONSTANTES remplacées littéralement par Vite au build : une
 * comparaison contre l'une d'elles est éliminée du bundle si elle est
 * toujours fausse. C'est ce qui permet à la cible Android de ne pas
 * embarquer un octet du moteur SQLite WebAssembly réservé à la cible web.
 */
interface ImportMetaEnv {
  /**
   * Cible du build.
   *
   *  • `android` (défaut) → SQLite NATIF de Capacitor, bundle empaqueté
   *    dans l'APK. C'est le chemin nominal, le seul qui garantisse le mode
   *    avion.
   *  • `web`             → SQLite WebAssembly persisté dans IndexedDB, pour
   *    servir le POS comme site statique. Voir `donnees/sqlite-web.ts` pour
   *    ce que cette cible garantit — et ce qu'elle ne garantit pas.
   */
  readonly VITE_CIBLE?: 'android' | 'web'
  /**
   * `1` pour rallumer l'impression ESC/POS. Éteinte par défaut : le MVP
   * n'imprime pas, il affiche. Voir `config.ts`.
   */
  readonly VITE_IMPRESSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
