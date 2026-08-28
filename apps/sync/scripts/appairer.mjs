#!/usr/bin/env node
/**
 * Appairage d'un terminal.
 *
 * Crée un appareil et imprime son jeton UNE SEULE FOIS. La base n'en garde
 * que l'empreinte : si le jeton est perdu, on n'en retrouve pas la valeur,
 * on réappaire.
 *
 *   node apps/sync/scripts/appairer.mjs \
 *     --restaurant <uuid> --libelle "Caisse 1" --prefixe P1
 *
 * Variables : DATABASE_URL (obligatoire), DATABASE_SSL=false en local.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

// Le même `apps/sync/.env` que `pnpm sync:dev`, quel que soit le dossier
// depuis lequel on lance le script. Sans cela, appairer depuis la racine du
// dépôt échouait sur « DATABASE_URL est absente » alors que le fichier
// existait deux dossiers plus bas — et rien ne disait où le chercher.
const FICHIER_ENV = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env')
if (existsSync(FICHIER_ENV) && !process.env.DATABASE_URL) {
  process.loadEnvFile(FICHIER_ENV)
}

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error(
    `DATABASE_URL est absente.\n` +
      `  Attendue dans ${FICHIER_ENV}\n` +
      `  Modèle : apps/sync/.env.example — voir docs/deploiement.md.`,
  )
  process.exit(1)
}

const restaurantId = args.get('restaurant')
const libelle = args.get('libelle') ?? 'Terminal'
const prefixe = (args.get('prefixe') ?? 'P1').toUpperCase()
const type = args.get('type') ?? 'pos'

if (!restaurantId) {
  console.error('Usage : --restaurant <uuid> [--libelle "Caisse 1"] [--prefixe P1]')
  process.exit(1)
}
if (!/^[A-Z0-9]{1,4}$/.test(prefixe)) {
  console.error('Le préfixe de ticket doit faire 1 à 4 caractères alphanumériques majuscules.')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true },
})
await client.connect()

try {
  const { rows: restos } = await client.query(
    'select id, organization_id, name from kaissi.restaurants where id = $1',
    [restaurantId],
  )
  if (restos.length === 0) {
    console.error(`Établissement ${restaurantId} introuvable.`)
    process.exit(1)
  }
  const resto = restos[0]

  const deviceId = randomUUID()
  const jetonClair = `kdev_${randomBytes(32).toString('base64url')}`
  const empreinte = createHash('sha256').update(jetonClair, 'utf8').digest('hex')

  await client.query('begin')
  await client.query(
    `insert into kaissi.devices
       (id, organization_id, restaurant_id, label, type, ticket_prefix,
        token_hash, protocol_version)
     values ($1,$2,$3,$4,$5,$6,$7,1)`,
    [deviceId, resto.organization_id, restaurantId, libelle, type, prefixe, empreinte],
  )
  await client.query(
    `insert into kaissi.device_pairings
       (organization_id, restaurant_id, device_id, token_hash)
     values ($1,$2,$3,$4)`,
    [resto.organization_id, restaurantId, deviceId, empreinte],
  )
  await client.query('commit')

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  APPAIRAGE RÉUSSI — ${resto.name.padEnd(52)}║
╚══════════════════════════════════════════════════════════════════════════╝

  Appareil        ${deviceId}
  Libellé         ${libelle}
  Préfixe ticket  ${prefixe}

  JETON (affiché UNE SEULE FOIS — notez-le maintenant) :

  ${jetonClair}

  À saisir sur la tablette : Diagnostic → Appairage.
  En cas de perte : révoquez l'appareil et réappairez-le. Ses ventes
  locales ne sont jamais perdues.
`)
} catch (erreur) {
  await client.query('rollback').catch(() => {})
  console.error('Échec de l’appairage :', erreur.message)
  process.exitCode = 1
} finally {
  await client.end()
}
