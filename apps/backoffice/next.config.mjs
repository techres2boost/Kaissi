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
  /*
   * Ne pas annoncer la technologie ni sa version.
   *
   * `X-Powered-By: Next.js` ne sert à personne d'utile et sert beaucoup à qui
   * cherche les serveurs vulnérables à une faille de version : c'est du
   * repérage offert.
   */
  poweredByHeader: false,
  async headers() {
    /*
     * Les en-têtes de sécurité, posés à UN seul endroit.
     *
     * Aucun n'était présent : le back-office était encadrable dans une iframe
     * (donc détournable au clic), et son navigateur n'avait aucune consigne
     * sur ce qu'il avait le droit de charger.
     *
     * La politique de contenu (CSP) est POSÉE PAR LE MIDDLEWARE et non ici :
     * elle porte un nonce différent à chaque réponse, ce qu'une valeur
     * statique ne peut pas faire. Ici ne restent que les en-têtes constants.
     */
    return [
      {
        source: '/:chemin*',
        headers: [
          {
            /*
             * HSTS — plus jamais de HTTP en clair, deux ans, sous-domaines
             * compris.
             *
             * Sans lui, la toute première visite tapée « kaissi.tn » part en
             * clair et peut être détournée avant même la redirection. Vercel
             * redirige déjà vers HTTPS ; HSTS fait que le NAVIGATEUR n'essaie
             * même plus.
             */
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            // Interdit au navigateur de « deviner » qu'un fichier texte est
            // en réalité du script. C'est ce qui transforme un export CSV en
            // vecteur d'exécution.
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // Le pendant ancien de `frame-ancestors`, pour les navigateurs
            // qui ne lisent pas encore la CSP. Les deux coexistent.
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            /*
             * L'adresse complète ne sort JAMAIS du site.
             *
             * Nos URL contiennent l'identifiant de l'établissement et les
             * filtres du rapport. Les laisser partir dans un `Referer` vers
             * un site tiers, c'est publier qui consulte quoi.
             */
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // On n'utilise ni caméra, ni micro, ni géolocalisation, ni
            // paiement : le dire ferme ces portes pour toute dépendance
            // ajoutée demain sans qu'on y pense.
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          {
            // Isole notre origine des fenêtres qu'elle ouvre — et l'inverse.
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ]
  },
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
