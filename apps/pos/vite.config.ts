import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Adresse de synchronisation de ce déploiement.
 *
 * Lue dans `deploiement.json`, versionné, plutôt que dans une variable posée
 * sur un tableau de bord : le gérant n'a alors plus rien à saisir sur la
 * tablette, et le même commit produit le même bundle partout.
 *
 * `VITE_URL_SYNC` l'emporte quand elle est posée — un bundle de recette se
 * construit sans modifier le dépôt.
 *
 * `scripts/verifier-mode-avion.mjs` lit la MÊME source pour décider quel hôte
 * a le droit d'apparaître dans le bundle. Une seule vérité, pas deux.
 */
function urlSyncDuDeploiement(): string {
  const posee = (process.env['VITE_URL_SYNC'] ?? '').trim()
  if (posee) return posee
  try {
    const fichier = new URL('./deploiement.json', import.meta.url)
    const { urlSync } = JSON.parse(readFileSync(fichier, 'utf8')) as { urlSync?: unknown }
    return typeof urlSync === 'string' ? urlSync.trim() : ''
  } catch {
    // Fichier absent ou illisible : le POS demandera l'adresse à l'écran.
    // Ce n'est jamais une raison d'empêcher un build de sortir.
    return ''
  }
}

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
 * Cible web : tamponne le service worker avec la version du build.
 *
 * Sans ce tampon, `sw.js` est IDENTIQUE d'un déploiement à l'autre. Or un
 * navigateur ne réinstalle un service worker que si son contenu a changé :
 * l'ancien restait donc actif indéfiniment, avec son cache au nom constant
 * et sa coque figée. Une caisse a tourné plusieurs jours sur un bundle
 * périmé, hors de portée de tout correctif.
 *
 * Le tampon est écrit APRÈS la copie de `publicDir` — sinon Vite l'écraserait
 * avec le fichier source.
 */
function versionnerServiceWorker(actif: boolean, version: string): Plugin {
  return {
    name: 'kaissi-sw-version',
    apply: 'build',
    closeBundle() {
      if (!actif) return
      const chemin = new URL('./dist/sw.js', import.meta.url)
      try {
        const source = readFileSync(chemin, 'utf8')
        writeFileSync(chemin, source.replace('__VERSION_BUILD__', version))
      } catch (erreur) {
        // Le service worker est un confort hors ligne, pas le produit : on
        // ne fait pas échouer un build pour lui. Mais on le DIT, parce qu'un
        // service worker non versionné est exactement la panne qu'on vient
        // de corriger.
        this.warn(
          `sw.js non versionné (${String(erreur)}) — la coque hors ligne ` +
            'risque de rester figée sur cette version.',
        )
      }
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

  // Empreinte de CE build : le commit s'il existe, sinon l'horodatage. Elle
  // nomme le cache du service worker, donc elle DOIT changer à chaque
  // déploiement — c'est ce qui permet à une correction d'atteindre la caisse.
  const versionBuild =
    (process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GIT_COMMIT'] ?? '').slice(0, 7) ||
    String(Date.now())

  return {
    plugins: [
      react(),
      cspWasm(wasm),
      manifesteWeb(cible === 'web'),
      versionnerServiceWorker(cible === 'web', versionBuild),
    ],
    // Le service worker et le manifeste ne concernent QUE la cible web :
    // hors d'elle, `publicDir` est éteint pour ne rien glisser dans l'APK.
    publicDir: cible === 'web' ? 'public-web' : false,
    define: {
      // Figée ici plutôt que laissée à l'environnement du shell : le bundle
      // doit dire lui-même pour quelle cible il a été construit.
      'import.meta.env.VITE_CIBLE': JSON.stringify(cible),
      // Empreinte du build, lisible dans l'écran Diagnostic.
      //
      // Avec trois déploiements qui se redéploient tout seuls, « est-ce que
      // ma correction est en ligne ? » devient la question la plus fréquente
      // — et la plus coûteuse, parce qu'on cherche un bug dans du code qui
      // n'est pas celui qui tourne. Le bundle porte donc sa propre date et
      // son commit. Vercel fournit VERCEL_GIT_COMMIT_SHA ; ailleurs, la
      // date suffit à trancher.
      'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(
        (process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GIT_COMMIT'] ?? '').slice(0, 7),
      ),
      'import.meta.env.VITE_BUILD_DATE': JSON.stringify(new Date().toISOString()),
      // Pré-remplit l'adresse du serveur de synchronisation. Voir
      // `deploiement.json` : c'est une DONNÉE, pas un `server.url`.
      'import.meta.env.VITE_URL_SYNC': JSON.stringify(urlSyncDuDeploiement()),
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
