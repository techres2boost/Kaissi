import { describe, expect, it } from 'vitest'
import { millimes, pointsDeBase, type Millimes } from './monnaie.js'
import { reconstruireCommande } from './commande.js'
import type { ChargesUtiles, EvenementCommande, TypeEvenement } from './evenements.js'
import { ordonnerEvenements } from './evenements.js'
import { nombreArticles, reduireEvenements, totalVerse } from './reduction.js'
import type { ConfigCalcul, TauxTaxe } from './types.js'

const m = (n: number): Millimes => millimes(n)
const bp = (n: number) => pointsDeBase(n)

const RESTO = 'resto-1'
const ORG = 'org-1'
const CMD = 'cmd-1'
const APPAREIL_A = 'device-aaa'
const APPAREIL_B = 'device-bbb'

const TVA_19: TauxTaxe = { id: 'tva-19', nom: 'TVA 19 %', tauxBp: bp(1900), incluse: false }
const TVA_07: TauxTaxe = { id: 'tva-07', nom: 'TVA 7 %', tauxBp: bp(700), incluse: false }
const config: ConfigCalcul = { tauxTaxes: { [TVA_19.id]: TVA_19, [TVA_07.id]: TVA_07 } }

let compteur = 0
function ev<T extends TypeEvenement>(
  type: T,
  payload: ChargesUtiles[T],
  options: {
    deviceId?: string
    serverSeq?: number | null
    seqDevice?: number
    clientTs?: string
    eventId?: string
    acteurId?: string
  } = {},
): EvenementCommande<T> {
  compteur += 1
  return {
    eventId: options.eventId ?? `evt-${compteur.toString().padStart(4, '0')}`,
    orderId: CMD,
    restaurantId: RESTO,
    organizationId: ORG,
    deviceId: options.deviceId ?? APPAREIL_A,
    seqDevice: options.seqDevice ?? compteur,
    clientTs: options.clientTs ?? `2026-08-25T19:0${(compteur % 10).toString()}:00.000Z`,
    serverSeq: options.serverSeq ?? null,
    type,
    payload,
    acteurId: options.acteurId ?? 'serveur-1',
  }
}

const ouverture = () =>
  ev('order.opened', { type: 'dine_in', tableId: 'table-12', ouvertePar: 'serveur-1' })

const ajout = (
  ligneId: string,
  designation: string,
  prix: number,
  quantite: number,
  tauxTaxeId = TVA_19.id,
  deviceId = APPAREIL_A,
) =>
  ev(
    'line.added',
    {
      ligneId,
      produitId: `prod-${ligneId}`,
      designation,
      quantite,
      prixBaseMillimes: m(prix),
      modificateursMillimes: m(0),
      tauxTaxeId,
    },
    { deviceId },
  )

describe('ordre canonique des événements', () => {
  it('place les événements confirmés par le serveur AVANT les locaux', () => {
    const local = ev('order.sent', {}, { serverSeq: null, clientTs: '2026-01-01T00:00:00Z' })
    const distant = ev('order.sent', {}, { serverSeq: 5, clientTs: '2026-12-31T23:59:59Z' })
    const trie = ordonnerEvenements([local, distant])
    expect(trie[0]!.serverSeq).toBe(5)
  })

  it('trie les événements serveur par serverSeq, jamais par horloge', () => {
    // Horloge de l'appareil B en avance d'une heure : elle ne doit pas primer.
    const a = ev('line.voided', { ligneId: 'x' }, { serverSeq: 100, clientTs: '2026-08-25T20:00:00Z' })
    const b = ev('line.voided', { ligneId: 'y' }, { serverSeq: 99, clientTs: '2026-08-25T19:00:00Z' })
    const trie = ordonnerEvenements([a, b])
    expect(trie.map((e) => e.serverSeq)).toEqual([99, 100])
  })

  it('est stable pour les événements locaux (clientTs, deviceId, seqDevice)', () => {
    const a = ev('order.sent', {}, { deviceId: APPAREIL_B, clientTs: '2026-08-25T19:00:00Z' })
    const b = ev('order.sent', {}, { deviceId: APPAREIL_A, clientTs: '2026-08-25T19:00:00Z' })
    expect(ordonnerEvenements([a, b])[0]!.deviceId).toBe(APPAREIL_A)
    expect(ordonnerEvenements([b, a])[0]!.deviceId).toBe(APPAREIL_A)
  })
})

describe('réduction — cas nominal', () => {
  it('reconstruit une commande simple', () => {
    const etat = reduireEvenements([
      ouverture(),
      ajout('l1', 'Pizza Margherita', 14500, 1),
      ajout('l2', 'Coca 33cl', 4200, 2, TVA_07.id),
    ])
    expect(etat.statut).toBe('ouverte')
    expect(etat.tableId).toBe('table-12')
    expect(etat.lignes).toHaveLength(2)
    expect(nombreArticles(etat)).toBe(3)
    expect(etat.deviceProprietaireId).toBe(APPAREIL_A)
  })

  it('EST IDEMPOTENTE : rejouer le même journal donne le même état', () => {
    const journal = [ouverture(), ajout('l1', 'Pizza', 14500, 1)]
    const a = reduireEvenements(journal)
    // Réseau instable : le même lot est renvoyé cinq fois.
    const b = reduireEvenements([...journal, ...journal, ...journal, ...journal, ...journal])
    expect(b.lignes).toEqual(a.lignes)
    expect(b.lignes).toHaveLength(1)
  })

  it('COMMUTE : l ordre des ajouts ne change pas le contenu', () => {
    const o = ouverture()
    const a = ajout('l1', 'Pizza', 14500, 1)
    const b = ajout('l2', 'Coca', 4200, 2, TVA_07.id, APPAREIL_B)
    const direct = reduireEvenements([o, a, b])
    const inverse = reduireEvenements([o, b, a])
    expect(new Set(direct.lignes.map((l) => l.id))).toEqual(
      new Set(inverse.lignes.map((l) => l.id)),
    )
  })
})

describe('le scénario du dossier : deux tablettes hors ligne sur la table 12', () => {
  it('applique les DEUX événements — aucun conflit', () => {
    const o = ouverture()
    const tabletteA = ajout('lA', 'Pizza Margherita', 14500, 1, TVA_19.id, APPAREIL_A)
    const tabletteB = ajout('lB', 'Coca 33cl', 4200, 2, TVA_07.id, APPAREIL_B)
    const etat = reduireEvenements([o, tabletteA, tabletteB])
    expect(etat.lignes).toHaveLength(2)
    expect(nombreArticles(etat)).toBe(3) // 1 pizza + 2 cocas
    expect(etat.exceptions).toHaveLength(0)
  })
})

describe('annulations — rien n est jamais effacé', () => {
  it('une ligne annulée reste visible mais ne compte plus', () => {
    const etat = reduireEvenements([
      ouverture(),
      ajout('l1', 'Pizza', 14500, 1),
      ajout('l2', 'Coca', 4200, 2, TVA_07.id),
      ev('line.voided', { ligneId: 'l2', motif: 'Erreur de saisie', autorisePar: 'manager-1' }),
    ])
    expect(etat.lignes).toHaveLength(2)
    const annulee = etat.lignes.find((l) => l.id === 'l2')!
    expect(annulee.annulee).toBe(true)
    expect(annulee.annuleeMotif).toBe('Erreur de saisie')
    expect(annulee.annuleePar).toBe('manager-1')
    expect(nombreArticles(etat)).toBe(1)
  })

  it('une commande annulée conserve tout son historique', () => {
    const etat = reduireEvenements([
      ouverture(),
      ajout('l1', 'Pizza', 14500, 1),
      ev('order.cancelled', { motif: 'Client parti', autorisePar: 'manager-1' }),
    ])
    expect(etat.statut).toBe('annulee')
    expect(etat.annuleeMotif).toBe('Client parti')
    expect(etat.lignes).toHaveLength(1)
  })
})

describe('double clôture hors ligne — jamais de suppression silencieuse', () => {
  it('retient la PREMIÈRE clôture par serverSeq et signale la seconde', () => {
    const etat = reduireEvenements([
      { ...ouverture(), serverSeq: 1 },
      { ...ajout('l1', 'Pizza', 14500, 1), serverSeq: 2 },
      ev('order.closed', { totalMillimes: m(14500), closePar: 'serveur-1' }, {
        deviceId: APPAREIL_A,
        serverSeq: 10,
        eventId: 'cloture-A',
      }),
      ev('order.closed', { totalMillimes: m(14500), closePar: 'serveur-2' }, {
        deviceId: APPAREIL_B,
        serverSeq: 11,
        eventId: 'cloture-B',
      }),
    ])
    expect(etat.statut).toBe('close')
    expect(etat.closePar).toBe('serveur-1') // la première par serverSeq
    expect(etat.exceptions).toHaveLength(1)
    expect(etat.exceptions[0]!.type).toBe('double_cloture')
    expect(etat.exceptions[0]!.eventId).toBe('cloture-B')
    expect(etat.exceptions[0]!.deviceId).toBe(APPAREIL_B)
  })

  it('signale un ajout arrivé après la clôture', () => {
    const etat = reduireEvenements([
      { ...ouverture(), serverSeq: 1 },
      ev('order.closed', { totalMillimes: m(0), closePar: 'serveur-1' }, { serverSeq: 2 }),
      { ...ajout('l-tardive', 'Café', 2000, 1), serverSeq: 3 },
    ])
    expect(etat.lignes).toHaveLength(0)
    expect(etat.exceptions[0]!.type).toBe('evenement_apres_cloture')
  })
})

describe('champs scalaires — dernier-écrivain-gagne par ordre canonique', () => {
  it('arbitre un transfert de table concurrent', () => {
    const etat = reduireEvenements([
      { ...ouverture(), serverSeq: 1 },
      ev('table.moved', { tableId: 'table-5' }, { deviceId: APPAREIL_A, serverSeq: 10 }),
      ev('table.moved', { tableId: 'table-8' }, { deviceId: APPAREIL_B, serverSeq: 11 }),
    ])
    expect(etat.tableId).toBe('table-8') // serverSeq le plus élevé
  })

  it('remplace une remise globale par la plus récente', () => {
    const etat = reduireEvenements([
      { ...ouverture(), serverSeq: 1 },
      ev('discount.applied', { remise: { type: 'pourcentage', valeurBp: bp(500) } }, { serverSeq: 5 }),
      ev('discount.applied', { remise: { type: 'pourcentage', valeurBp: bp(1000) } }, { serverSeq: 6 }),
    ])
    expect(etat.remiseGlobale).toEqual({ type: 'pourcentage', valeurBp: 1000 })
  })
})

describe('paiements', () => {
  it('accumule les paiements et calcule le versé', () => {
    const etat = reduireEvenements([
      ouverture(),
      ajout('l1', 'Pizza', 14500, 1),
      ev('payment.recorded', {
        paiementId: 'pay-1',
        methodeId: 'espece',
        mode: 'cash',
        montantMillimes: m(10000),
      }),
      ev('payment.recorded', {
        paiementId: 'pay-2',
        methodeId: 'carte',
        mode: 'card',
        montantMillimes: m(7255),
      }),
    ])
    expect(totalVerse(etat)).toBe(17255)
  })

  it('un paiement annulé ne compte plus mais reste tracé', () => {
    const etat = reduireEvenements([
      ouverture(),
      ev('payment.recorded', {
        paiementId: 'pay-1',
        methodeId: 'espece',
        mode: 'cash',
        montantMillimes: m(10000),
      }),
      ev('payment.voided', { paiementId: 'pay-1', motif: 'Erreur', autorisePar: 'manager-1' }),
    ])
    expect(totalVerse(etat)).toBe(0)
    expect(etat.paiements).toHaveLength(1)
    expect(etat.paiements[0]!.annule).toBe(true)
  })

  it('un paiement renvoyé deux fois n est encaissé QU UNE FOIS', () => {
    const paiement = ev('payment.recorded', {
      paiementId: 'pay-1',
      methodeId: 'espece',
      mode: 'cash',
      montantMillimes: m(24500),
    })
    const etat = reduireEvenements([ouverture(), paiement, paiement, paiement])
    expect(etat.paiements).toHaveLength(1)
    expect(totalVerse(etat)).toBe(24500)
  })
})

describe('robustesse du protocole', () => {
  it('ignore SANS PLANTER un type d événement inconnu et le signale', () => {
    const inconnu = {
      ...ouverture(),
      type: 'promo.futuriste' as never,
      payload: {} as never,
    }
    const etat = reduireEvenements([ouverture(), inconnu, ajout('l1', 'Pizza', 14500, 1)])
    expect(etat.lignes).toHaveLength(1)
    expect(etat.exceptions.some((x) => x.type === 'type_inconnu')).toBe(true)
  })

  it('signale un journal qui ne commence pas par une ouverture', () => {
    const etat = reduireEvenements([ajout('l1', 'Pizza', 14500, 1)])
    expect(etat.exceptions[0]!.type).toBe('evenement_sans_ouverture')
    expect(etat.lignes).toHaveLength(1)
  })

  it('PORTE LA TENANCE même sans événement d’ouverture', () => {
    // Cas réel : deux tablettes hors ligne, l'ajout de l'une arrive avant
    // l'ouverture de l'autre. Sans tenance, la commande serait improjetable
    // — donc invisible — jusqu'à l'arrivée de l'ouverture.
    const etat = reduireEvenements([ajout('l1', 'Pizza', 14500, 1)])
    expect(etat.restaurantId).toBe(RESTO)
    expect(etat.organizationId).toBe(ORG)
    expect(etat.id).toBe(CMD)
  })

  it('refuse un journal hétérogène', () => {
    const autre = { ...ouverture(), orderId: 'autre-commande' }
    expect(() => reduireEvenements([ouverture(), autre])).toThrow(/hétérogène/)
  })

  it('refuse un journal vide', () => {
    expect(() => reduireEvenements([])).toThrow(/vide/)
  })
})

describe('reconstruction complète : journal → état → totaux', () => {
  it('produit un ticket cohérent de bout en bout', () => {
    const { etat, totaux, encaissement } = reconstruireCommande(
      [
        ouverture(),
        ajout('l1', 'Pizza Margherita', 14500, 1),
        ajout('l2', 'Coca 33cl', 4200, 2, TVA_07.id),
        ev('discount.applied', { remise: { type: 'pourcentage', valeurBp: bp(1000) } }),
        ev('payment.recorded', {
          paiementId: 'pay-1',
          methodeId: 'espece',
          mode: 'cash',
          montantMillimes: m(30000),
        }),
      ],
      config,
    )
    expect(etat.lignes).toHaveLength(2)
    // Brut 14500 + 8400 = 22900 ; remise 10 % = 2290 → base 20610
    expect(totaux.sousTotalMillimes).toBe(22900)
    expect(totaux.remiseGlobaleMillimes).toBe(2290)
    expect(totaux.baseApresRemisesMillimes).toBe(20610)
    expect(encaissement.rendreMillimes).toBe(30000 - totaux.totalMillimes)
    expect(encaissement.solde).toBe(true)
  })

  it('prend en compte un service posé par événement', () => {
    const { totaux } = reconstruireCommande(
      [
        ouverture(),
        ajout('l1', 'Pizza', 10000, 1),
        ev('service.set', { tauxBp: 1000, taxable: false }),
      ],
      config,
    )
    expect(totaux.serviceMillimes).toBe(1000)
  })
})
