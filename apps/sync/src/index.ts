/**
 * Point d'entrée de l'API de synchronisation Kaissi.
 *
 * Ce process ne sert QUE la synchronisation. Il ne rend aucune page, ne
 * porte aucune logique d'interface, et n'expose aucune clé Supabase : les
 * appareils s'authentifient avec leur propre jeton.
 */

import { serve } from '@hono/node-server'
import { DepotPostgres } from './depot-postgres.js'
import { creerServeur } from './serveur.js'

export * from './protocole.js'
export * from './depot.js'
export * from './service.js'
export * from './jeton.js'
export { DepotPostgres } from './depot-postgres.js'
export { creerServeur } from './serveur.js'

/** Démarrage autonome. Ignoré quand le module est importé par un test. */
export function demarrer(): void {
  const url = process.env['DATABASE_URL']

  // Message VOLONTAIREMENT gros et encadré : c'est l'erreur de démarrage la
  // plus fréquente, et sous « node --watch » elle se noyait sous un discret
  // « Waiting for file changes » qui donnait l'impression que rien ne se
  // passait. Impossible à manquer désormais.
  if (!url) {
    console.error(
      [
        '',
        '  ┌───────────────────────────────────────────────────────────────┐',
        '  │  DATABASE_URL est absente — le serveur ne peut pas démarrer.   │',
        '  └───────────────────────────────────────────────────────────────┘',
        '',
        '  Crée le fichier  apps/sync/.env  (pas ailleurs) à partir du modèle :',
        '',
        '      cp apps/sync/.env.example apps/sync/.env',
        '',
        '  puis mets-y ta chaîne Supabase dans DATABASE_URL (onglet « Connect »',
        '  → Session pooler). Relance ensuite  pnpm sync:dev.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  // Garde-fou : la valeur du modèle laissée telle quelle. Le serveur
  // démarrerait, puis échouerait à la première requête avec une erreur
  // d'authentification obscure. Autant le dire tout de suite.
  if (url.includes('MOT2PASSE')) {
    console.error(
      [
        '',
        '  ⚠ DATABASE_URL contient encore « MOT2PASSE » — le mot de passe du',
        '    modèle n\'a pas été remplacé. Édite apps/sync/.env avec le vrai',
        '    mot de passe de la base (Supabase → Project Settings → Database).',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  // L'URL doit être analysable. La cause n°1 d'échec : un mot de passe qui
  // contient un caractère spécial (?, @, #, /, :, espace…) non encodé. Dans
  // une URL, « ? » démarre la requête et « @ » sépare le mot de passe de
  // l'adresse — l'URL devient invalide ou mal découpée, et la connexion
  // échoue plus tard avec une erreur d'authentification incompréhensible.
  let hote: string
  try {
    hote = new URL(url).hostname
  } catch {
    console.error(
      [
        '',
        '  ┌───────────────────────────────────────────────────────────────┐',
        '  │  DATABASE_URL est mal formée — le mot de passe contient sans    │',
        '  │  doute un caractère spécial (?, @, #, /, :, espace…).           │',
        '  └───────────────────────────────────────────────────────────────┘',
        '',
        '  Supabase EXIGE un caractère spécial. Choisis-en un qui ne casse',
        '  pas une adresse : ! . - _ ~  (le « ! » est le plus simple).',
        '  ÉVITE   ? # / % @ :  et l\'espace — ceux-là cassent l\'URL.',
        '',
        '  Supabase → Project Settings → Database → Reset database password,',
        '  par exemple  Kaissi2026Res2boost!  puis remets-le dans apps/sync/.env.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  const port = Number.parseInt(process.env['SYNC_PORT'] ?? '8787', 10)
  const origines = (process.env['SYNC_ORIGINES'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  const depot = new DepotPostgres({
    connectionString: url,
    ssl: process.env['DATABASE_SSL'] !== 'false',
  })
  const app = creerServeur({ depot, origines })

  const serveur = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })
  console.log(
    `\n  ✓ API de synchronisation Kaissi — en écoute sur le port ${port}` +
      `\n    Base : ${hote}` +
      `\n    Laisse ce terminal OUVERT. Vérifie dans un autre : ` +
      `curl http://127.0.0.1:${port}/sante\n`,
  )

  const arreter = (signal: string) => {
    console.log(`${signal} reçu, arrêt en cours…`)
    serveur.close(() => {
      void depot.fermer().finally(() => process.exit(0))
    })
  }
  process.on('SIGTERM', () => arreter('SIGTERM'))
  process.on('SIGINT', () => arreter('SIGINT'))
}

// `import.meta.url` correspond au fichier lancé : on ne démarre le serveur
// que si ce module EST le point d'entrée, pas quand un test l'importe.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  demarrer()
}
