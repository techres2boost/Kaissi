import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * En développement, la base locale est un SQLite compilé en WebAssembly
 * (sql.js). Or `script-src 'self'` interdit d'instancier du WASM : la page
 * se charge, mais la base ne s'ouvre jamais.
 *
 * On n'assouplit donc la politique QUE pour le serveur de développement.
 * L'APK, lui, utilise le SQLite NATIF de Capacitor et n'a aucun besoin de
 * WebAssembly : sa politique reste strictement `script-src 'self'`, ce que
 * `scripts/verifier-mode-avion.mjs` vérifie sur le bundle livré.
 */
function cspDeveloppement(): Plugin {
  return {
    name: 'kaissi-csp-developpement',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
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
 * Build du POS : une SPA pure, entièrement statique.
 *
 * Aucun rendu serveur, aucune Server Action, aucun appel réseau au
 * démarrage : le bundle produit ici est empaqueté tel quel dans l'APK.
 */
export default defineConfig({
  plugins: [react(), cspDeveloppement()],
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
})
