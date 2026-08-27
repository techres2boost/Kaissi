/**
 * Utilitaires des tests d'intégration.
 *
 * Ces tests tapent dans un VRAI PostgreSQL, avec les migrations de
 * production appliquées telles quelles. Une base simulée validerait notre
 * idée du SQL, pas le SQL — or c'est précisément là que se cachent les
 * erreurs de RLS, de contrainte et d'idempotence.
 */

import { Client } from 'pg'
import { uuidV7, type ChargesUtiles, type EvenementCommande, type TypeEvenement } from '@kaissi/domain'
import { genererJeton } from '../src/jeton.js'

export const URL_TEST =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://postgres@127.0.0.1:5433/postgres'

export const DEMO_ORG = '01930000-0000-7000-8000-000000000001'
export const DEMO_RESTO = '01930000-0000-7000-8000-000000000002'

export interface AppareilTest {
  id: string
  jetonClair: string
  prefixe: string
}

/** Crée un appareil appairé et rend son jeton en clair, une seule fois. */
export async function creerAppareil(prefixe: string): Promise<AppareilTest> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const id = uuidV7()
    const jeton = genererJeton()
    await client.query(
      `insert into kaissi.devices
         (id, organization_id, restaurant_id, label, type, ticket_prefix,
          token_hash, app_version, protocol_version)
       values ($1,$2,$3,$4,'pos',$5,$6,'0.2.0',1)`,
      [id, DEMO_ORG, DEMO_RESTO, `Terminal ${prefixe}`, prefixe, jeton.empreinte],
    )
    return { id, jetonClair: jeton.clair, prefixe }
  } finally {
    await client.end()
  }
}

/** Remet les tables transactionnelles à zéro entre deux tests. */
export async function nettoyer(): Promise<void> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    // order_events est en insertion seule : les déclencheurs interdisent
    // même au propriétaire d'y toucher. On les désactive le temps du
    // nettoyage — un privilège que SEUL un test possède.
    await client.query('alter table kaissi.order_events disable trigger order_events_immuable')
    await client.query('truncate kaissi.order_items, kaissi.payments cascade')
    await client.query('delete from kaissi.sync_mutations')
    await client.query('delete from kaissi.sync_cursors')
    await client.query('delete from kaissi.order_events')
    await client.query('delete from kaissi.orders')
    await client.query('delete from kaissi.devices')
    // Les tests d'employés et de RLS créent des appartenances, donc des
    // entrées de journal. Sans ce ménage, change_log grossit à chaque
    // fichier et finit par déborder la pagination du catalogue — un test
    // échouait alors selon l'ordre d'exécution, ce qui est le pire des
    // échecs : il n'apprend rien et on finit par l'ignorer.
    await client.query("delete from kaissi.change_log where entity_type = 'employees'")
    await client.query('alter table kaissi.order_events enable trigger order_events_immuable')
  } finally {
    await client.end()
  }
}

let compteur = 0

/** Fabrique un événement signé par un appareil donné. */
export function ev<T extends TypeEvenement>(
  appareil: AppareilTest,
  orderId: string,
  type: T,
  payload: ChargesUtiles[T],
  seqDevice?: number,
): EvenementCommande<T> {
  compteur += 1
  return {
    eventId: uuidV7(),
    orderId,
    restaurantId: DEMO_RESTO,
    organizationId: DEMO_ORG,
    deviceId: appareil.id,
    seqDevice: seqDevice ?? compteur,
    clientTs: new Date(Date.UTC(2026, 7, 25, 19, 0, compteur % 60)).toISOString(),
    serverSeq: null,
    type,
    payload,
    acteurId: null,
  }
}

/** Identifiant du taux de TVA 19 % du jeu de démonstration. */
export const TVA_19 = '01930000-0000-7000-8000-000000000010'
export const TVA_07 = '01930000-0000-7000-8000-000000000012'
export const ESPECES = '01930000-0000-7000-8000-000000000500'
