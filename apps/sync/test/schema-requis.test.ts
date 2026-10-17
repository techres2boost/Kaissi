/**
 * Un code qui attend une migration absente doit le DIRE — pas répondre 500.
 *
 * PANNE OBSERVÉE EN PRODUCTION (remboursement, migration 0045). Le service
 * redéployé depuis `main` exécutait `delete from kaissi.refunds where
 * order_id = …` à chaque vente ; la colonne n'existait pas encore. Chaque
 * push répondait « Erreur interne », la caisse gardait ses ventes, et ni la
 * cuisine, ni le bar, ni le back-office ne voyaient plus rien.
 *
 * Ce fichier rejoue la panne sur une vraie base : il RETIRE la colonne,
 * pousse une vente, et exige un 503 qui nomme la migration — puis il
 * réapplique 0045 et exige que la même vente, réessayée, soit projetée.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { SONDES, manquantes, requeteSondes } from '../src/schema-requis.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  ESPECES,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const MIGRATIONS = join(import.meta.dirname, '../../../supabase/migrations')

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

async function sql(texte: string): Promise<void> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    await client.query(texte)
  } finally {
    await client.end()
  }
}

/** Réapplique 0045 telle quelle : elle est écrite pour être rejouable. */
async function reappliquer0045(): Promise<void> {
  const fichier = readdirSync(MIGRATIONS).find((f) => f.startsWith('0045_'))!
  await sql(readFileSync(join(MIGRATIONS, fichier), 'utf8'))
}

function vente(a: AppareilTest, prix: number) {
  const orderId = uuidV7()
  let seq = 0
  const ev = (type: string, charge: unknown) => ({
    eventId: uuidV7(),
    orderId,
    organizationId: DEMO_ORG,
    restaurantId: DEMO_RESTO,
    deviceId: a.id,
    seqDevice: (seq += 1),
    type,
    payload: charge,
    clientTs: new Date().toISOString(),
    actorUserId: null,
  })
  return {
    orderId,
    evenements: [
      ev('order.opened', { type: 'takeaway', ouvertePar: null, numeroTicket: `${a.prefixe}-000001` }),
      ev('line.added', {
        ligneId: uuidV7(),
        produitId: '01930000-0000-7000-8000-000000000200',
        designation: 'Couscous poulet',
        quantite: 1,
        prixBaseMillimes: millimes(prix),
        modificateursMillimes: millimes(0),
        tauxTaxeId: TVA_19,
      }),
      ev('payment.recorded', {
        paiementId: uuidV7(),
        methodeId: ESPECES,
        mode: 'cash',
        montantMillimes: millimes(prix),
        recuMillimes: millimes(prix),
        renduMillimes: millimes(0),
      }),
      ev('order.closed', { totalMillimes: millimes(prix), closePar: null }),
    ] as never[],
  }
}

async function push(a: AppareilTest, evenements: never[]) {
  const r = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jetonClair}` },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  return { statut: r.status, corps: (await r.json().catch(() => null)) as any }
}

beforeEach(async () => {
  await nettoyer()
})

afterAll(async () => {
  // Quoi qu'il arrive plus haut, la base repart COMPLÈTE pour les fichiers
  // suivants : un test qui laisse le schéma amputé ferait échouer les autres
  // pour une raison qui n'a rien à voir avec eux.
  await reappliquer0045()
  await depot.fermer()
})

describe('le schéma attendu par le code', () => {
  it('une sonde couvre CHAQUE migration depuis 0030, dernière comprise', () => {
    const numeros = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 4))
      .filter((n) => n >= '0030')
    const sondees = new Set(SONDES.map((s) => s.migration))
    const oubliees = numeros.filter((n) => !sondees.has(n))
    expect(
      oubliees,
      'Migration sans sonde dans apps/sync/src/schema-requis.ts. Sans elle, un ' +
        'déploiement du service AVANT la migration casse chaque vente sans le dire.',
    ).toEqual([])
  })

  it('une base complète ne signale rien', async () => {
    expect(await depot.migrationsManquantes()).toEqual([])
  })

  it('chaque sonde dit « non » quand son objet manque (vérifié sur 0045)', async () => {
    const client = new Client({ connectionString: URL_TEST })
    await client.connect()
    try {
      await client.query('begin')
      await client.query('alter table kaissi.refunds drop column order_id cascade')
      const { rows } = await client.query<{ presentes: boolean[] }>(requeteSondes())
      expect(manquantes(rows[0]!.presentes).map((s) => s.migration)).toEqual(['0045'])
    } finally {
      await client.query('rollback')
      await client.end()
    }
  })
})

describe('panne du remboursement rejouée : 0045 absente', () => {
  it('le push répond 503 en nommant 0045, /sante refuse, et rien n’est perdu', async () => {
    const a = await creerAppareil('P1')
    const { orderId, evenements } = vente(a, 18_500)

    await sql('alter table kaissi.refunds drop column order_id cascade')
    try {
      // 1. La vente : un 503 LISIBLE, plus un « erreur interne ».
      const premier = await push(a, evenements)
      expect(premier.statut).toBe(503)
      expect(premier.corps.erreur).toBe('base_non_a_jour')
      expect(premier.corps.message).toContain('0045')

      // 2. La sonde de l'hébergeur refuse le déploiement.
      const sante = await app.request('http://test/sante')
      expect(sante.status).toBe(503)
      const corpsSante = (await sante.json()) as any
      expect(corpsSante.etat).toBe('schema_incomplet')
      expect(corpsSante.migrationsManquantes.map((m: any) => m.migration)).toEqual(['0045'])

      // 3. Les événements sont DANS le journal : rien n'est perdu.
      const connus = await depot.evenementsConnus(
        DEMO_RESTO,
        evenements.map((e: any) => e.eventId),
      )
      expect(connus.size).toBe(4)
    } finally {
      await reappliquer0045()
    }

    // 4. Migration appliquée : la caisse réessaie le MÊME lot, la vente
    //    apparaît — sans rien ressaisir.
    const second = await push(a, evenements)
    expect(second.statut).toBe(200)
    expect((await depot.statutsDesCommandes(DEMO_RESTO, [orderId])).get(orderId)).toBe('close')
  })
})
