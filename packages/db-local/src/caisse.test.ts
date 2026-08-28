import { beforeEach, describe, expect, it } from 'vitest'
import {
  millimes,
  pointsDeBase,
  resumerShift,
  uuidV7,
  type ConfigCalcul,
  type EvenementCommande,
  type TypeEvenement,
  type ChargesUtiles,
} from '@kaissi/domain'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import { migrer } from './migrateur.js'
import { installerGraine, DEMO_ORG, DEMO_RESTO, DEMO_DEVICE } from './graine.js'
import { projeterCommande } from './projecteur.js'
import { depotCaisse } from './depots/caisse.js'
import { depotCatalogue } from './depots/catalogue.js'
import { depotEmployes } from './depots/employes.js'
import { depotImpression, TENTATIVES_MAX } from './depots/impression.js'
import { depotStations } from './depots/stations.js'

let db: AdaptateurSqlite
let config: ConfigCalcul

beforeEach(async () => {
  db = adaptateurNode(':memory:')
  await migrer(db)
  await installerGraine(db)
  const taxes = await depotCatalogue(db).tauxTaxes()
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
function ev<T extends TypeEvenement>(
  orderId: string,
  type: T,
  payload: ChargesUtiles[T],
): EvenementCommande<T> {
  seq += 1
  return {
    eventId: uuidV7(),
    orderId,
    restaurantId: DEMO_RESTO,
    organizationId: DEMO_ORG,
    deviceId: DEMO_DEVICE,
    seqDevice: seq,
    clientTs: new Date(Date.UTC(2026, 7, 25, 19, 0, seq)).toISOString(),
    serverSeq: null,
    type,
    payload,
    acteurId: null,
  }
}

async function commandePayee(orderId: string, prix: number, tauxTaxeId: string) {
  const journal: EvenementCommande[] = [
    ev(orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: 'emp-1',
      numeroTicket: `P1-${orderId.slice(-6)}`,
    }),
    ev(orderId, 'line.added', {
      ligneId: uuidV7(),
      produitId: 'prod-1',
      designation: 'Pizza Margherita',
      quantite: 1,
      prixBaseMillimes: millimes(prix),
      modificateursMillimes: millimes(0),
      tauxTaxeId,
    }),
    ev(orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: '01930000-0000-7000-8000-000000000500',
      mode: 'cash',
      montantMillimes: millimes(prix),
      recuMillimes: millimes(prix),
      renduMillimes: millimes(0),
    }),
    ev(orderId, 'order.closed', { totalMillimes: millimes(prix), closePar: 'emp-1' }),
  ]
  return journal
}

describe('projection locale — journal → tables lisibles', () => {
  it('écrit une commande, ses lignes et ses paiements', async () => {
    const orderId = uuidV7()
    const taxes = await depotCatalogue(db).tauxTaxes()
    const journal = await commandePayee(orderId, 14_500, taxes[0]!.id)
    const { etat, totaux } = await projeterCommande(db, journal, config)

    expect(etat.statut).toBe('close')
    expect(totaux.totalMillimes).toBe(14_500)

    const cmd = await db.lireUne<{ status: string; total_millimes: number; paid_millimes: number }>(
      'SELECT status, total_millimes, paid_millimes FROM orders WHERE id = ?',
      [orderId],
    )
    expect(cmd?.status).toBe('close')
    expect(cmd?.total_millimes).toBe(14_500)
    expect(cmd?.paid_millimes).toBe(14_500)

    const lignes = await db.lire('SELECT * FROM order_items WHERE order_id = ?', [orderId])
    expect(lignes).toHaveLength(1)
    const paiements = await db.lire('SELECT * FROM payments WHERE order_id = ?', [orderId])
    expect(paiements).toHaveLength(1)
  })

  it('EST IDEMPOTENTE : reprojeter ne duplique ni ligne ni paiement', async () => {
    const orderId = uuidV7()
    const taxes = await depotCatalogue(db).tauxTaxes()
    const journal = await commandePayee(orderId, 14_500, taxes[0]!.id)
    await projeterCommande(db, journal, config)
    await projeterCommande(db, journal, config)
    await projeterCommande(db, journal, config)

    expect(await db.lire('SELECT id FROM orders WHERE id = ?', [orderId])).toHaveLength(1)
    expect(await db.lire('SELECT id FROM order_items WHERE order_id = ?', [orderId])).toHaveLength(1)
    expect(await db.lire('SELECT id FROM payments WHERE order_id = ?', [orderId])).toHaveLength(1)
  })

  it('conserve une ligne annulée mais l exclut du total', async () => {
    const orderId = uuidV7()
    const ligneId = uuidV7()
    const taxes = await depotCatalogue(db).tauxTaxes()
    const journal = [
      ev(orderId, 'order.opened', { type: 'takeaway', ouvertePar: 'emp-1' }),
      ev(orderId, 'line.added', {
        ligneId,
        produitId: 'p',
        designation: 'Frites',
        quantite: 2,
        prixBaseMillimes: millimes(4_500),
        modificateursMillimes: millimes(0),
        tauxTaxeId: taxes[0]!.id,
      }),
      ev(orderId, 'line.voided', { ligneId, motif: 'Erreur de saisie' }),
    ]
    await projeterCommande(db, journal, config)

    const cmd = await db.lireUne<{ total_millimes: number }>(
      'SELECT total_millimes FROM orders WHERE id = ?',
      [orderId],
    )
    expect(cmd?.total_millimes).toBe(0)
    // La ligne reste visible, marquée annulée : rien n'est jamais effacé.
    const ligne = await db.lireUne<{ voided_at: string | null }>(
      'SELECT voided_at FROM order_items WHERE id = ?',
      [ligneId],
    )
    expect(ligne?.voided_at).not.toBeNull()
  })

  it('n imputera jamais une commande à un second shift', async () => {
    const orderId = uuidV7()
    const taxes = await depotCatalogue(db).tauxTaxes()
    const journal = await commandePayee(orderId, 10_000, taxes[0]!.id)
    await projeterCommande(db, journal, config, { shiftId: 'shift-matin' })
    // Reprojetée pendant le shift du soir : elle reste au matin.
    await projeterCommande(db, journal, config, { shiftId: 'shift-soir' })
    const cmd = await db.lireUne<{ shift_id: string }>(
      'SELECT shift_id FROM orders WHERE id = ?',
      [orderId],
    )
    expect(cmd?.shift_id).toBe('shift-matin')
  })
})

describe('shift de caisse, de bout en bout', () => {
  it('ouvre, encaisse, clôture et calcule l écart', async () => {
    const caisse = depotCaisse(db)
    const shiftId = uuidV7()
    await caisse.ouvrirShift({
      id: shiftId,
      organizationId: DEMO_ORG,
      restaurantId: DEMO_RESTO,
      deviceId: DEMO_DEVICE,
      employeId: 'emp-1',
      caisseId: null,
      fondDeCaisseMillimes: 50_000,
    })

    const taxes = await depotCatalogue(db).tauxTaxes()
    for (const prix of [14_500, 8_500, 4_200]) {
      const journal = await commandePayee(uuidV7(), prix, taxes[0]!.id)
      await projeterCommande(db, journal, config, { shiftId })
    }

    await caisse.ajouterMouvement({
      id: uuidV7(),
      organizationId: DEMO_ORG,
      restaurantId: DEMO_RESTO,
      shiftId,
      type: 'payout',
      montantMillimes: 3_000,
      motif: 'Achat de pain',
      creePar: 'emp-1',
    })

    const shift = (await caisse.shiftOuvert())!
    const totaux = await caisse.totauxDe(shiftId)
    const resume = resumerShift({
      shift,
      encaissements: await caisse.encaissementsDe(shiftId),
      mouvements: await caisse.mouvementsDe(shiftId),
      nombreCommandes: totaux.nombreCommandes,
      chiffreAffairesMillimes: millimes(totaux.chiffreAffairesMillimes),
    })

    // 50 000 de fond + 27 200 d'espèces − 3 000 de dépense
    expect(resume.especesMillimes).toBe(27_200)
    expect(resume.attenduMillimes).toBe(74_200)
    expect(resume.nombreCommandes).toBe(3)

    await caisse.cloturerShift(shiftId, 74_000, resume.attenduMillimes, 'Écart constaté')
    const clos = await caisse.shiftParId(shiftId)
    expect(clos?.closA).not.toBeNull()
    const ligne = await db.lireUne<{ variance_millimes: number }>(
      'SELECT variance_millimes FROM shifts WHERE id = ?',
      [shiftId],
    )
    // Il manque 200 millimes : l'écart est NÉGATIF.
    expect(ligne?.variance_millimes).toBe(-200)
  })

  it('REFUSE d ouvrir un second shift tant que le premier est ouvert', async () => {
    const caisse = depotCaisse(db)
    const ouvrir = () =>
      caisse.ouvrirShift({
        id: uuidV7(),
        organizationId: DEMO_ORG,
        restaurantId: DEMO_RESTO,
        deviceId: DEMO_DEVICE,
        employeId: 'emp-1',
        caisseId: null,
        fondDeCaisseMillimes: 50_000,
      })
    await ouvrir()
    await expect(ouvrir()).rejects.toThrow(/déjà ouvert/)
  })
})

describe('commandes ouvertes et occupation des tables', () => {
  it('liste les commandes vivantes avec leur table', async () => {
    const tables = await depotCatalogue(db).tables()
    const orderId = uuidV7()
    const taxes = await depotCatalogue(db).tauxTaxes()
    await projeterCommande(
      db,
      [
        ev(orderId, 'order.opened', {
          type: 'dine_in',
          tableId: tables[0]!.id,
          ouvertePar: 'emp-1',
        }),
        ev(orderId, 'line.added', {
          ligneId: uuidV7(),
          produitId: 'p',
          designation: 'Pizza',
          quantite: 2,
          prixBaseMillimes: millimes(14_500),
          modificateursMillimes: millimes(0),
          tauxTaxeId: taxes[0]!.id,
        }),
      ],
      config,
    )

    const caisse = depotCaisse(db)
    const ouvertes = await caisse.commandesOuvertes()
    expect(ouvertes).toHaveLength(1)
    expect(ouvertes[0]!.tableLabel).toBe(tables[0]!.label)
    expect(ouvertes[0]!.nombreArticles).toBe(2)
    expect(await caisse.commandeDeTable(tables[0]!.id)).toBe(orderId)
  })

  it('libère la table dès que la commande est encaissée', async () => {
    const tables = await depotCatalogue(db).tables()
    const taxes = await depotCatalogue(db).tauxTaxes()
    const orderId = uuidV7()
    const journal = [
      ev(orderId, 'order.opened', {
        type: 'dine_in',
        tableId: tables[0]!.id,
        ouvertePar: 'emp-1',
      }),
      ev(orderId, 'line.added', {
        ligneId: uuidV7(),
        produitId: 'p',
        designation: 'Pizza',
        quantite: 1,
        prixBaseMillimes: millimes(14_500),
        modificateursMillimes: millimes(0),
        tauxTaxeId: taxes[0]!.id,
      }),
      ev(orderId, 'order.closed', { totalMillimes: millimes(14_500), closePar: 'emp-1' }),
    ]
    await projeterCommande(db, journal, config)
    expect(await depotCaisse(db).commandeDeTable(tables[0]!.id)).toBeNull()
  })
})

describe('envoi en cuisine', () => {
  it('n envoie chaque ligne QU UNE FOIS', async () => {
    const caisse = depotCaisse(db)
    const taxes = await depotCatalogue(db).tauxTaxes()
    const orderId = uuidV7()
    // La commande doit exister : kitchen_sends la référence, et refuser un
    // envoi orphelin est exactement ce qu'on attend du schéma.
    await projeterCommande(
      db,
      [
        ev(orderId, 'order.opened', { type: 'dine_in', ouvertePar: 'emp-1' }),
        ...['l1', 'l2', 'l3'].map((ligneId) =>
          ev(orderId, 'line.added', {
            ligneId,
            produitId: 'p',
            designation: `Article ${ligneId}`,
            quantite: 1,
            prixBaseMillimes: millimes(1_000),
            modificateursMillimes: millimes(0),
            tauxTaxeId: taxes[0]!.id,
          }),
        ),
      ],
      config,
    )
    await caisse.marquerEnvoyees(orderId, ['l1', 'l2'], 'station-1', 'job-1')
    expect(await caisse.lignesDejaEnvoyees(orderId)).toEqual(new Set(['l1', 'l2']))
    // Deuxième tournée : l1 et l2 ne repartent pas, seul l3 est nouveau.
    await caisse.marquerEnvoyees(orderId, ['l1', 'l2', 'l3'], 'station-1', 'job-2')
    expect((await caisse.lignesDejaEnvoyees(orderId)).size).toBe(3)
    const envois = await db.lire('SELECT * FROM kitchen_sends WHERE order_id = ?', [orderId])
    expect(envois).toHaveLength(3)
  })
})

describe("file d'impression", () => {
  it('conserve un travail tant qu il n est pas confirmé imprimé', async () => {
    const file = depotImpression(db)
    await file.mettreEnFile({
      id: 'job-1',
      restaurantId: DEMO_RESTO,
      kind: 'kot',
      chargeB64: 'GyE=',
      hote: '192.168.1.50',
    })
    expect((await file.compteurs()).enAttente).toBe(1)
    await file.marquerImprime('job-1')
    expect((await file.compteurs()).enAttente).toBe(0)
  })

  it('REMET en file après un échec, sans jamais supprimer le travail', async () => {
    const file = depotImpression(db)
    await file.mettreEnFile({
      id: 'job-1',
      restaurantId: DEMO_RESTO,
      kind: 'ticket',
      chargeB64: 'GyE=',
      hote: '192.168.1.50',
    })
    await file.marquerEnCours('job-1')
    await file.marquerEchec('job-1', 'Connexion refusée')
    const encore = await file.aImprimer()
    expect(encore).toHaveLength(1)
    expect(encore[0]!.tentatives).toBe(1)
    expect(encore[0]!.derniereErreur).toBe('Connexion refusée')
  })

  it('bascule en échec visible après N tentatives — jamais en silence', async () => {
    const file = depotImpression(db)
    await file.mettreEnFile({
      id: 'job-1',
      restaurantId: DEMO_RESTO,
      kind: 'kot',
      chargeB64: 'GyE=',
      hote: '192.168.1.50',
    })
    for (let i = 0; i < TENTATIVES_MAX; i += 1) {
      await file.marquerEnCours('job-1')
      await file.marquerEchec('job-1', 'Imprimante injoignable')
    }
    expect((await file.compteurs()).echecs).toBe(1)
    expect(await file.aImprimer()).toHaveLength(0)
    expect(await file.enEchec()).toHaveLength(1)

    // Le gérant peut relancer explicitement.
    await file.reessayer('job-1')
    expect(await file.aImprimer()).toHaveLength(1)
  })

  it("suit l'adresse ACTUELLE de la station, pas celle de la mise en file", async () => {
    // Le jour où l'imprimante de la cuisine est remplacée, les bons déjà en
    // attente doivent partir vers la NOUVELLE. Figer la destination avec le
    // contenu condamnerait toute la file à une adresse morte.
    const file = depotImpression(db)
    const stations = depotStations(db)
    const cuisine = (await stations.toutes()).find((s) => s.nom === 'Cuisine')!

    await file.mettreEnFile({
      id: 'job-1',
      restaurantId: DEMO_RESTO,
      stationId: cuisine.id,
      kind: 'kot',
      chargeB64: 'GyE=',
      hote: cuisine.hote,
      port: cuisine.port,
    })
    expect((await file.aImprimer())[0]!.hote).toBe('192.168.1.50')

    await stations.definirImprimante(cuisine.id, '10.0.2.2', 9100)
    expect((await file.aImprimer())[0]!.hote).toBe('10.0.2.2')

    // Et l'écran des échecs montre la même adresse que celle réellement
    // tentée : afficher l'ancienne enverrait chercher la panne ailleurs.
    for (let i = 0; i < TENTATIVES_MAX; i += 1) {
      await file.marquerEnCours('job-1')
      await file.marquerEchec('job-1', 'Imprimante injoignable')
    }
    expect((await file.enEchec())[0]!.hote).toBe('10.0.2.2')
  })

  it("envoie un travail SANS station à l'imprimante de la caisse", async () => {
    // Un ticket client, un rapport de clôture ou une ouverture de tiroir
    // n'appartiennent à aucune station. Ils partent vers la première
    // imprimante configurée — et suivent donc, eux aussi, l'adresse du jour.
    // C'est exactement le cas qui laissait les tickets client bloqués sur
    // l'ancienne adresse alors que les bons de cuisine, eux, repartaient.
    const file = depotImpression(db)
    const stations = depotStations(db)
    await file.mettreEnFile({
      id: 'job-ticket',
      restaurantId: DEMO_RESTO,
      kind: 'ticket',
      chargeB64: 'GyE=',
      hote: '192.168.1.50',
      port: 9100,
    })

    const cuisine = (await stations.toutes())[0]!
    await stations.definirImprimante(cuisine.id, '10.0.2.2', 9100)
    expect((await file.aImprimer())[0]!.hote).toBe('10.0.2.2')
  })

  it("retombe sur l'adresse enregistrée si AUCUNE station n'a d'imprimante", async () => {
    const file = depotImpression(db)
    const stations = depotStations(db)
    for (const s of await stations.toutes()) {
      await stations.definirImprimante(s.id, null, 9100)
    }
    await file.mettreEnFile({
      id: 'job-tiroir',
      restaurantId: DEMO_RESTO,
      kind: 'tiroir',
      chargeB64: 'GyE=',
      hote: '192.168.1.99',
      port: 9100,
    })
    expect((await file.aImprimer())[0]!.hote).toBe('192.168.1.99')
  })

  it('relance TOUS les travaux en échec d’un seul geste', async () => {
    // Sans ce geste, « un ticket n'est jamais supprimé » voudrait dire
    // « un ticket ne repart jamais » : six bons morts à la main, un par un.
    const file = depotImpression(db)
    for (const id of ['a', 'b', 'c']) {
      await file.mettreEnFile({
        id,
        restaurantId: DEMO_RESTO,
        kind: 'ticket',
        chargeB64: 'GyE=',
        hote: '192.168.1.50',
      })
      for (let i = 0; i < TENTATIVES_MAX; i += 1) {
        await file.marquerEnCours(id)
        await file.marquerEchec(id, 'Imprimante injoignable')
      }
    }
    expect((await file.compteurs()).echecs).toBe(3)

    expect(await file.reessayerTout()).toBe(3)
    expect((await file.compteurs()).echecs).toBe(0)
    expect(await file.aImprimer()).toHaveLength(3)
  })
})

describe('employés et PIN hors ligne', () => {
  it('charge les employés de démonstration', async () => {
    const employes = await depotEmployes(db).actifs()
    expect(employes).toHaveLength(3)
    expect(employes.map((e) => e.role)).toContain('gerant')
    expect(employes.every((e) => e.aUnPin)).toBe(true)
  })

  it('valide le bon PIN et rejette les autres — sans réseau', async () => {
    const depot = depotEmployes(db)
    const ahmed = (await depot.actifs()).find((e) => e.nom.startsWith('Ahmed'))!
    expect(await depot.verifier(ahmed.id, '1357')).not.toBeNull()
    expect(await depot.verifier(ahmed.id, '1358')).toBeNull()
  })

  it('retrouve un employé par son seul PIN', async () => {
    const trouve = await depotEmployes(db).parPin('2468')
    expect(trouve?.nom).toBe('Salma Trabelsi')
    expect(await depotEmployes(db).parPin('0000')).toBeNull()
  })

  it('ne stocke aucun PIN en clair', async () => {
    const lignes = await db.lire<{ pin_hash: string }>('SELECT pin_hash FROM employees')
    for (const l of lignes) {
      expect(l.pin_hash).toMatch(/^argon2id\$/)
      for (const pin of ['1357', '2468', '9753']) expect(l.pin_hash).not.toContain(pin)
    }
  })

  it('liste les managers habilités à autoriser une escalade', async () => {
    const managers = await depotEmployes(db).managers()
    expect(managers).toHaveLength(1)
    expect(managers[0]!.nom).toBe('Ahmed Ben Salah')
  })
})

describe('rapport de la journée', () => {
  it('agrège chiffre d affaires, modes de paiement et produits', async () => {
    const taxes = await depotCatalogue(db).tauxTaxes()
    for (const prix of [14_500, 8_500, 4_200]) {
      await projeterCommande(db, await commandePayee(uuidV7(), prix, taxes[0]!.id), config)
    }
    const rapport = await depotCaisse(db).rapportJournee(
      '2026-08-25T00:00:00.000Z',
      '2026-08-26T00:00:00.000Z',
    )
    expect(rapport.nombreCommandes).toBe(3)
    expect(rapport.chiffreAffairesMillimes).toBe(27_200)
    expect(rapport.ticketMoyenMillimes).toBe(Math.round(27_200 / 3))
    expect(rapport.parMode[0]!.mode).toBe('cash')
    expect(rapport.parMode[0]!.montantMillimes).toBe(27_200)
    expect(rapport.parProduit[0]!.designation).toBe('Pizza Margherita')
    expect(rapport.parProduit[0]!.quantite).toBe(3)
  })

  it('rend un rapport vide sans planter quand rien n a été vendu', async () => {
    const rapport = await depotCaisse(db).rapportJournee(
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    )
    expect(rapport.nombreCommandes).toBe(0)
    expect(rapport.ticketMoyenMillimes).toBe(0)
    expect(rapport.parProduit).toHaveLength(0)
  })
})
