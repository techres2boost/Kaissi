/**
 * Back-office Kaissi.
 *
 * Ici — et SEULEMENT ici — les Server Components et Server Actions sont les
 * bienvenus : rapports rendus côté serveur, administration, invitations.
 * Sur le chemin de la caisse, ils sont interdits : chaque ajout d'article
 * deviendrait un aller-retour réseau, inutilisable en service.
 */

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Les paquets du monorepo sont consommés en SOURCE TypeScript.
  transpilePackages: ['@kaissi/domain'],
  // Routes typées : un lien vers une page qui n'existe pas casse la
  // compilation. Les gabarits `/${restaurant}/journee` sont bien vérifiés ;
  // seule une destination venue de l'extérieur exige un filtrage explicite
  // (voir `destinationSure` dans app/connexion/actions.ts).
  typedRoutes: true,
  webpack(configuration) {
    // `@kaissi/domain` importe ses modules avec l'extension `.js`, comme
    // l'exige la résolution ESM de Node. Webpack, lui, doit être averti
    // qu'un « ./monnaie.js » se trouve dans « ./monnaie.ts ».
    configuration.resolve.extensionAlias = {
      ...configuration.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return configuration
  },
}

export default config
