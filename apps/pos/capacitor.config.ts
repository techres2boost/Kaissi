import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Configuration Capacitor du terminal de caisse.
 *
 * ⚠ RÈGLE ABSOLUE — ne jamais ajouter de bloc `server` avec une `url`.
 *
 * Le pattern Stampi / Box (coque Capacitor qui charge un site distant) est
 * DISQUALIFIANT ici : quand Internet tombe, la WebView n'a plus rien à
 * charger et l'application ne s'ouvre même pas. Ce n'est pas un problème de
 * données, c'est que le code de l'application lui-même viendrait du réseau.
 *
 * Le bundle JS/CSS vit dans l'APK, point. `webDir` pointe sur `dist`, et
 * `dist` est copié dans les ressources Android par `cap sync`.
 *
 * Idem pour Bubblewrap / TWA : exclus. Une TWA est un Chrome déguisé qui
 * charge une URL distante, sans accès aux périphériques.
 */
const config: CapacitorConfig = {
  appId: 'tn.res2boost.kaissi',
  appName: 'Kaissi',
  webDir: 'dist',
  // Pas de `server.url`. Pas de `server.hostname` distant. JAMAIS.
  android: {
    // Le contenu local est servi par le schéma https:// interne de Capacitor :
    // WebCrypto (nécessaire au chaînage d'audit) exige un contexte sécurisé.
    allowMixedContent: false,
    // Permet l'impression réseau en clair sur le LAN (TCP 9100) sans exposer
    // la WebView au contenu mixte.
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false,
      },
    },
  },
}

export default config
