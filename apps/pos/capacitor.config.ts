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
    /*
     * Les appels de synchronisation partent par le RÉSEAU NATIF, pas par la
     * WebView. Sans cela, deux règles de navigateur se cumulent et bloquent
     * tout, avec le même message inutile — « Failed to fetch » :
     *
     *  • CONTENU MIXTE. La page est servie par le schéma https:// interne de
     *    Capacitor. Une requête vers http://10.0.2.2:8787 — le serveur de
     *    développement sur le PC — est une ressource non sécurisée demandée
     *    depuis une origine sécurisée : la WebView la refuse, et
     *    `allowMixedContent: false` doit le RESTER.
     *
     *  • CORS. Le serveur de sync n'est pas la même origine que la page ;
     *    sans en-tête Access-Control-Allow-Origin, la réponse est jetée.
     *
     * Le POS est une application native, pas un site : ses appels vers SON
     * propre serveur n'ont aucune raison de subir les règles inter-origines
     * d'un navigateur. Le plugin remplace `fetch` par une implémentation
     * native, ce qui règle les deux d'un coup — en développement comme en
     * production, où l'API sera de toute façon en HTTPS.
     *
     * Aucune conséquence sur le mode avion : c'est le TRANSPORT des appels
     * réseau qui change, pas le fait qu'il n'y en ait aucun au démarrage.
     */
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false,
      },
    },
  },
}

export default config
