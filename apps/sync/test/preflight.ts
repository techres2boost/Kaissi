/**
 * Contrôle préalable des tests de synchronisation.
 *
 * Sans lui, une base absente produit trente-cinq échecs identiques dont le
 * seul indice utile est un « ECONNREFUSED 127.0.0.1:5433 » noyé à la fin.
 * On perd dix minutes à chercher une régression qui n'existe pas.
 *
 * Ici, un seul message, qui dit quoi faire.
 */

import { Client } from 'pg'
import { URL_TEST } from './aide.js'

export async function setup(): Promise<void> {
  const client = new Client({ connectionString: URL_TEST, connectionTimeoutMillis: 5_000 })
  try {
    await client.connect()
  } catch {
    throw new Error(
      [
        '',
        `Aucun PostgreSQL joignable sur ${URL_TEST}`,
        '',
        "Ces tests tapent dans une VRAIE base : ils vérifient RLS, les contraintes",
        "et l'idempotence, c'est-à-dire ce que fait Postgres, pas ce que fait notre",
        'code. Une base simulée ne prouverait rien de tout cela.',
        '',
        '  ./scripts/postgres-test.sh          démarre une base jetable et applique',
        '                                      le schéma de production tel quel',
        '  ./scripts/postgres-test.sh --stop   pour tout supprimer ensuite',
        '',
        "Le reste de la suite n'a besoin de rien : pnpm test:rapide",
        '',
      ].join('\n'),
    )
  }

  // Une base joignable mais vide est le second piège : les tests échoueraient
  // sur « relation kaissi.devices does not exist », ce qui ressemble à un bug
  // de code alors que ce sont les migrations qui n'ont pas été appliquées.
  const { rows } = await client.query<{ present: boolean }>(
    "select to_regclass('kaissi.order_events') is not null as present",
  )
  await client.end()

  if (!rows[0]?.present) {
    throw new Error(
      [
        '',
        `PostgreSQL répond sur ${URL_TEST}, mais le schéma kaissi est absent.`,
        '',
        'La base existe, les migrations non. Applique-les :',
        '  ./scripts/postgres-test.sh',
        '',
      ].join('\n'),
    )
  }
}
