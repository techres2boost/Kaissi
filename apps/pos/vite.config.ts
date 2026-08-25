import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Build du POS : une SPA pure, entièrement statique.
 *
 * Aucun rendu serveur, aucune Server Action, aucun appel réseau au
 * démarrage : le bundle produit ici est empaqueté tel quel dans l'APK.
 */
export default defineConfig({
  plugins: [react()],
  // Chemins RELATIFS : indispensable pour un chargement depuis file:// ou
  // depuis le schéma interne de Capacitor.
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
