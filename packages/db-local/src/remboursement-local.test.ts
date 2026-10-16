/**
 * Le remboursement sur la TABLETTE : projeté, rattaché au bon service de
 * caisse, visible dans les reçus — et rejouable sans rien dupliquer.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  millimes,
  pointsDeBase,
  resumerShift,
  uuidV7,
  type ChargesUtiles,
  type ConfigCalcul,
  type EvenementCommande,
  type TypeEvenement,
} from '@kaissi/domain'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import { migrer } from './migrateur.js'
import { installerGraine, DEMO_ORG, DEMO_RESTO, DEMO_DEVICE } from './graine.js'
import { projeterCommande } from './projecteur.js'
import { depotCaisse } from './depots/caisse.js'
import { depotCatalogue } from './depots/catalogue.js'

let db: AdaptateurSqlite
let config: ConfigCalcul
let taux: string

beforeEach(async () => {
  db = adaptateurNode(':memory:')
  await migrer(db)
  await installerGraine(db)
  const taxes = await depotCatalogue(db).tauxTaxes()
  taux = taxes[0]!.id
  config = {
    tauxTaxes: Object.fromEntries(
      taxes.map((t) => [
        t.id,
        { id: t.id, nom: t.nom, tauxBp: pointsDeBase(t.tauxBp), incluse: t.incluse },
      ]),
    ),
  }
})

let seq = 0
function ev<T extends TypeEvenement>(orderId: string, type: T, payload: ChargesUtiles[T]): EvenementCommande<T> {
  seq += 1
  return {
    eventId: uuidV7(),
    orderId,
    restaurantId: DEMO_RESTO,
    organizationId: DEMO_ORG,
    deviceId: DEMO_DEVICE,
    seqDevice: seq,
    clientTs: new Date(Date.UTC(2026, 9, 16, 12, 0, seq)).toISOString(),
    serverSeq: null,
    type,
    payload,
    acteurId: null,
  }
}

function venteEtRemboursement(orderId: string, shiftDuRemboursement: string) {
  const ligneId = uuidV7()
  const paiementId = uuidV7()
  const vente = [
    ev(orderId, 'order.opened', { type: 'takeaway', ouvertePar: 'emp-1', numeroTicket: 'P1-000042' }),
    ev(orderId, 'line.added', {
      ligneId,
      produitId: 'prod-1',
      designation: 'Pizza Margherita',
      quantite: 1,
      prixBaseMillimes: millimes(14_500),
      modificateursMillimes: millimes(0),
      tauxTaxeId: taux,
    }),
    ev(orderId, 'payment.recorded', {
      paiementId,
      methodeId: '01930000-0000-7000-8000-000000000500',
      mode: 'cash',
      montantMillimes: millimes(14_500),
    }),
    ev(orderId, 'order.closed', { totalMillimes: millimes(14_500), closePar: 'emp-1' }),
  ]
  const remboursement = ev(orderId, 'refund.recorded', {
    remboursementId: uuidV7(),
    paiementId,
    mode: 'cash',
    montantMillimes: millimes(14_500),
    ligneIds: [ligneId],
    motif: 'Pizza froide',
    shiftId: shiftDuRemboursement,
  })
  return { vente, remboursement }
}

describe('remboursement — projection locale', () => {
  it('écrit le remboursement, sans toucher à la vente', async () => {
    const orderId = uuidV7()
    const { vente, remboursement } = venteEtRemboursement(orderId, 'shift-lundi')
    await projeterCommande(db, [...vente, remboursement], config, { shiftId: 'shift-samedi' })

    const cmd = await db.lireUne<{ status: string; total_millimes: number }>(
      'SELECT status, total_millimes FROM orders WHERE id = ?',
      [orderId],
    )
    expect(cmd).toEqual({ status: 'close', total_millimes: 14_500 })

    const r = await db.lire<{ amount_millimes: number; reason: string; shift_id: string }>(
      'SELECT amount_millimes, reason, shift_id FROM refunds WHERE order_id = ?',
      [orderId],
    )
    expect(r).toEqual([{ amount_millimes: 14_500, reason: 'Pizza froide', shift_id: 'shift-lundi' }])
  })

  it('reprojeter trois fois ne duplique rien', async () => {
    const orderId = uuidV7()
    const { vente, remboursement } = venteEtRemboursement(orderId, 'shift-1')
    for (let i = 0; i < 3; i += 1) {
      await projeterCommande(db, [...vente, remboursement], config)
    }
    const n = await db.lireUne<{ n: number }>('SELECT COUNT(*) AS n FROM refunds')
    expect(n?.n).toBe(1)
  })

  it('l argent sort du tiroir du jour du REMBOURSEMENT, pas de celui de la vente', async () => {
    const orderId = uuidV7()
    const { vente, remboursement } = venteEtRemboursement(orderId, 'shift-lundi')
    // Vendu samedi, remboursé lundi — reprojeté depuis lundi.
    await projeterCommande(db, vente, config, { shiftId: 'shift-samedi' })
    await projeterCommande(db, [...vente, remboursement], config, { shiftId: 'shift-lundi' })

    const caisse = depotCaisse(db)
    expect(await caisse.remboursementsDe('shift-samedi')).toEqual([])
    const lundi = await caisse.remboursementsDe('shift-lundi')
    expect(lundi).toEqual([{ mode: 'cash', montantMillimes: 14_500 }])

    const resume = resumerShift({
      shift: {
        id: 'shift-lundi',
        restaurantId: DEMO_RESTO,
        organizationId: DEMO_ORG,
        deviceId: DEMO_DEVICE,
        employeId: null,
        ouvertA: '2026-10-19T08:00:00Z',
        fondDeCaisseMillimes: millimes(50_000),
        closA: null,
        compteMillimes: null,
        noteCloture: null,
      },
      encaissements: await caisse.encaissementsDe('shift-lundi'),
      mouvements: [],
      nombreCommandes: 0,
      chiffreAffairesMillimes: millimes(0),
      remboursements: lundi,
    })
    expect(resume.attenduMillimes).toBe(35_500)
  })

  it('les reçus disent ce qui a déjà été rendu', async () => {
    const orderId = uuidV7()
    const { vente, remboursement } = venteEtRemboursement(orderId, 'shift-1')
    await projeterCommande(db, [...vente, remboursement], config)
    const [recu] = await depotCaisse(db).recus()
    expect(recu?.rembourseMillimes).toBe(14_500)
  })
})
