#!/usr/bin/env node
/**
 * Reconstruit la projection des commandes à partir du journal.
 *
 * `order_events` est la source de vérité ; `orders`, `order_items` et
 * `payments` n'en sont que des projections. Une projection peut donc
 * toujours être refaite — c'est précisément ce que cette architecture
 * achète, et ce script est l'outil qui l'encaisse.
 *
 * ── À lire avant de le lancer ─────────────────────────────────────────────
 *
 * Le SERVICE fait déjà ce travail tout seul à chaque démarrage
 * (`src/reparation.ts`) : il balaie les derniers événements reçus et
 * reconstruit les projections manquantes. Un redéploiement suffit donc à
 * rattraper un trou, et c'est le chemin normal — on ne demande pas à un
 * restaurateur de lancer une commande contre sa base de production.
 *
 * Ce script reste utile pour ce que le balayage ne fait PAS : rejouer
 * l'historique ENTIER (`--tout`), plus ancien que la fenêtre de démarrage,
 * après un changement de calcul des totaux.
 *
 * À quoi il sert :
 *   • réparer des commandes dont les événements sont arrivés mais dont la
 *     projection a échoué (voir le correctif « une reprojection ratée
 *     n'efface plus une vente ») ;
 *   • rejouer une journée après un changement de calcul des totaux.
 *
 * Par défaut il ne touche QUE les commandes absentes de la projection.
 * `--tout` les refait toutes — plus lent, à réserver aux heures creuses :
 * ce n'est pas une commande à lancer en plein service.
 *
 *   pnpm sync:reprojeter --restaurant <uuid> [--tout]
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DepotPostgres } from '../src/depot-postgres.ts'
import { configurationPg } from '../src/connexion.ts'
import { formaterErreurBase } from '../src/diagnostic-base.ts'

const FICHIER_ENV = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env')
if (existsSync(FICHIER_ENV) && !process.env.DATABASE_URL) {
  process.loadEnvFile(FICHIER_ENV)
}

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i]
  if (a === '--tout') args.set('tout', true)
  else if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i])
}

const restaurantId = args.get('restaurant')
if (!restaurantId) {
  console.error(
    '\n  Usage : pnpm sync:reprojeter --restaurant <uuid> [--tout]\n\n' +
      '  Sans --tout, seules les commandes ABSENTES de la projection sont\n' +
      '  reconstruites — c’est le cas qui répare une panne.\n',
  )
  process.exit(1)
}

let configuration
try {
  configuration = configurationPg()
} catch (erreur) {
  console.error(`\n  ✗ ${erreur instanceof Error ? erreur.message : String(erreur)}\n`)
  process.exit(1)
}

const depot = new DepotPostgres(configuration)

try {
  await depot.verifier()
} catch (erreur) {
  console.error(
    `\n  ✗ La base de données est injoignable.\n\n  ` +
      formaterErreurBase(erreur, {
        motDePasseSepare: configuration.password !== undefined,
        utilisateur: configuration.user,
      })
        .split('\n')
        .join('\n  ') +
      '\n',
  )
  process.exit(1)
}

const commandes = await depot.commandesAReprojeter(restaurantId, args.get('tout') === true)

if (commandes.length === 0) {
  console.log('\n  ✓ Rien à reprojeter : toutes les commandes ont leur projection.\n')
  await depot.fermer()
  process.exit(0)
}

console.log(`\n  ${commandes.length} commande(s) à reprojeter…\n`)

let refaites = 0
const echecs = []
for (const order_id of commandes) {
  try {
    await depot.reprojeter(restaurantId, [order_id])
    refaites += 1
    console.log(`  ✓ ${order_id}`)
  } catch (erreur) {
    // On CONTINUE : une commande qui résiste ne doit pas empêcher de
    // réparer les autres. Elles sont listées à la fin, pour qu'aucune ne
    // disparaisse du rapport.
    echecs.push({ order_id, message: erreur instanceof Error ? erreur.message : String(erreur) })
    console.log(`  ✗ ${order_id}`)
  }
}

console.log(`\n  ${refaites} reprojetée(s), ${echecs.length} en échec.`)
for (const e of echecs) console.log(`    ✗ ${e.order_id} — ${e.message}`)
console.log('')

await depot.fermer()
process.exit(echecs.length > 0 ? 1 : 0)
