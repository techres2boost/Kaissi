import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Deux cibles, deux moteurs SQLite, deux politiques de sécurité.
 *
 *   • `android` (défaut) → SQLite NATIF de Capacitor. Aucun besoin de
 *     WebAssembly : la politique reste strictement `script-src 'self'`, ce
 *     que `scripts/verifier-mode-avion.mjs` vérifie sur le bundle livré.
 *
 *   • `web` et le serveur de développement → SQLite compilé en WebAssembly
 *     (sql.js). Or `script-src 'self'` interdit d'INSTANCIER du WASM : la
 *     page se charge, mais la base ne s'ouvre jamais.
 *
 * `'wasm-unsafe-eval'` n'autorise QUE l'instanciation WebAssembly — pas
 * `eval()`, pas de script en ligne, pas de script distant. C'est la
 * directive prévue exactement pour ce cas, et elle n'ouvre rien d'autre.
 */
function cspWasm(actif: boolean): Plugin {
  return {
    name: 'kaissi-csp-wasm',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        if (!actif) return html
        // On vise l'ATTRIBUT `content` de la balise, pas la première
        // occurrence du texte : `script-src 'self'` apparaît aussi dans le
        // commentaire qui explique la politique, juste au-dessus.
        return html.replace(
          /(<meta[^>]*Content-Security-Policy[^>]*content=")([^"]*)(")/i,
          (_tout, avant: string, politique: string, apres: string) =>
            avant +
            politique.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'") +
            apres,
        )
      },
    },
  }
}

/**
 * Cible web : déclare le manifeste d'application.
 *
 * Injecté ici plutôt qu'écrit dans `index.html` : un manifeste embarqué dans
 * l'APK ferait référence à un service worker qui n'y existe pas, et le
 * vérificateur de mode avion aurait raison de s'en plaindre.
 */
function manifesteWeb(actif: boolean): Plugin {
  return {
    name: 'kaissi-manifeste-web',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        if (!actif) return html
        return html.replace(
          '</head>',
          '    <link rel="manifest" href="./manifest.webmanifest" />\n  </head>',
        )
      },
    },
  }
}

/**
 * Build du POS : une SPA pure, entièrement statique.
 *
 * Aucun rendu serveur, aucune Server Action, aucun appel réseau au
 * démarrage : le bundle produit ici est empaqueté tel quel dans l'APK.
 */
export default defineConfig(({ command, mode }) => {
  // La cible vient de l'environnement, avec Android par défaut : oublier la
  // variable donne le build le plus contraint, jamais le plus permissif.
  const cible = process.env['VITE_CIBLE'] === 'web' ? 'web' : 'android'
  const wasm = cible === 'web' || command === 'serve' || mode === 'development'

  return {
    plugins: [react(), cspWasm(wasm), manifesteWeb(cible === 'web')],
    // Le service worker et le manifeste ne concernent QUE la cible web :
    // hors d'elle, `publicDir` est éteint pour ne rien glisser dans l'APK.
    publicDir: cible === 'web' ? 'public-web' : false,
    define: {
      // Figée ici plutôt que laissée à l'environnement du shell : le bundle
      // doit dire lui-même pour quelle cible il a été construit.
      'import.meta.env.VITE_CIBLE': JSON.stringify(cible),
    },
    // Chemins RELATIFS : indispensable pour un chargement depuis le schéma
    // interne de Capacitor.
    base: './',
    build: {
      outDir: 'dist',
      target: 'es2022',
      sourcemap: true,
      // Pas de découpage exotique : moins de fichiers = démarrage à froid
      // plus rapide sur une tablette d'entrée de gamme.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
          },
        },
      },
    },
    server: { port: 5173, host: true },
  }
})
