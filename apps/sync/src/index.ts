/**
 * Point d'entrée de l'API de synchronisation Kaissi.
 *
 * Ce process ne sert QUE la synchronisation. Il ne rend aucune page, ne
 * porte aucune logique d'interface, et n'expose aucune clé Supabase : les
 * appareils s'authentifient avec leur propre jeton.
 */

import { serve } from '@hono/node-server'
import { pathToFileURL } from 'node:url'
import { DepotPostgres } from './depot-postgres.js'
import { creerServeur } from './serveur.js'
import { formaterErreurBase } from './diagnostic-base.js'
import { configurationPg, hoteDe } from './connexion.js'

export * from './protocole.js'
export * from './depot.js'
export * from './service.js'
export * from './jeton.js'
export { DepotPostgres } from './depot-postgres.js'
export { creerServeur } from './serveur.js'

/** Démarrage autonome. Ignoré quand le module est importé par un test. */
export async function demarrer(): Promise<void> {
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
  //
  // Sauf si DATABASE_PASSWORD est renseignée : laisser « MOT2PASSE » dans
  // l'URL est alors la marche à suivre RECOMMANDÉE, celle qui évite d'avoir
  // à encoder quoi que ce soit. Refuser de démarrer dans ce cas ferait de ce
  // garde-fou un obstacle à la seule solution correcte.
  const motDePasseSepare = (process.env['DATABASE_PASSWORD'] ?? '') !== ''
  if (url.includes('MOT2PASSE') && !motDePasseSepare) {
    console.error(
      [
        '',
        '  ⚠ DATABASE_URL contient encore « MOT2PASSE », et aucun',
        '    DATABASE_PASSWORD n\'est renseigné — la connexion ne peut pas',
        '    aboutir.',
        '',
        '  Le plus simple, dans apps/sync/.env : garde « MOT2PASSE » dans',
        '  l\'URL et ajoute la ligne',
        '',
        '      DATABASE_PASSWORD="ton mot de passe exact"',
        '',
        '  Cette valeur n\'est jamais analysée comme une URL : aucun caractère',
        '  n\'a besoin d\'être encodé.',
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
        '  Le plus simple : NE mets PAS le mot de passe dans l\'URL.',
        '  Laisse MOT2PASSE tel quel et ajoute, dans apps/sync/.env :',
        '',
        '      DATABASE_PASSWORD="ton mot de passe exact"',
        '',
        '  Cette valeur n\'est jamais analysée comme une URL : aucun caractère',
        '  n\'a besoin d\'être encodé. Les guillemets évitent qu\'un « # » ne',
        '  soit pris pour un commentaire.',
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

  let configuration
  try {
    configuration = configurationPg()
  } catch (erreur) {
    // Configuration invalide AVANT toute connexion : DATABASE_CA_FILE
    // introuvable, DATABASE_URL illisible. On imprime le message clair de
    // l'erreur plutôt qu'une pile Node.
    console.error(`\n  ✗ ${erreur instanceof Error ? erreur.message : String(erreur)}\n`)
    process.exit(1)
  }
  const hoteBase = hoteDe(configuration)
  const depot = new DepotPostgres(configuration)

  // On JOINT la base avant d'annoncer quoi que ce soit. Annoncer « en
  // écoute » sans l'avoir fait donnerait un serveur qui paraît sain et qui
  // échouera au premier encaissement d'une tablette — au pire moment, et
  // loin d'ici.
  try {
    await depot.verifier()
  } catch (erreur) {
    console.error(
      `\n  ✗ La base de données est injoignable.\n    Hôte : ${hoteBase}\n\n  ` +
        formaterErreurBase(erreur).split('\n').join('\n  ') +
        '\n',
    )
    await depot.fermer().catch(() => {})
    process.exit(1)
  }

  const app = creerServeur({ depot, origines })

  const serveur = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })
  console.log(
    `\n  ✓ API de synchronisation Kaissi — en écoute sur le port ${port}` +
      `\n    Base : ${hoteBase} — connexion vérifiée` +
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

// On ne démarre le serveur que si ce module EST le point d'entrée, pas quand
// un test l'importe.
//
// `pathToFileURL` et non « file:// + argv[1] » : sur Windows, argv[1] est un
// chemin à antislash (C:\\…\\index.ts) et « file:// » n'ajoute pas la
// troisième barre. La comparaison échouait donc en silence, demarrer()
// n'était jamais appelé, et « pnpm sync:dev » ne faisait RIEN — sans la
// moindre erreur. pathToFileURL produit l'URL correcte sur chaque OS.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demarrer().catch((erreur) => {
    console.error(erreur)
    process.exit(1)
  })
}
