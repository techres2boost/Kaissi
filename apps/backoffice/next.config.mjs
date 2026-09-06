import { readFileSync } from 'node:fs'

/**
 * Back-office Kaissi.
 *
 * Ici — et SEULEMENT ici — les Server Components et Server Actions sont les
 * bienvenus : rapports rendus côté serveur, administration, invitations.
 * Sur le chemin de la caisse, ils sont interdits : chaque ajout d'article
 * deviendrait un aller-retour réseau, inutilisable en service.
 */

/*
 * L'adresse du service de synchronisation vient du MÊME fichier que celle
 * du POS : `apps/pos/deploiement.json`, versionnée.
 *
 * Le back-office l'appelle pour une seule chose — ouvrir un accès et changer
 * un mot de passe, deux gestes qui exigent la clé `service_role` et qui
 * n'ont donc rien à faire ici. La déclarer une seconde fois, dans une
 * variable d'hébergeur, c'est se garantir qu'un jour les deux ne pointeront
 * plus au même endroit, et que personne ne saura laquelle fait foi.
 *
 * `URL_SYNC` reste prioritaire pour le développement local.
 */
const deploiement = JSON.parse(
  readFileSync(new URL('../pos/deploiement.json', import.meta.url), 'utf8'),
)

/** @type {import('next').NextConfig} */
const config = {
  env: {
    URL_SYNC: process.env.URL_SYNC || deploiement.urlSync || '',
  },
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
