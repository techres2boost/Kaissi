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
  if (!url) {
    console.error(
      "DATABASE_URL est absente. L'API de synchronisation ne peut pas démarrer.\n" +
        'Voir .env.example et docs/deploiement.md.',
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
  console.log(`API de synchronisation Kaissi — port ${port}`)

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
