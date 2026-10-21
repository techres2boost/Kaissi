import { describe, expect, it } from 'vitest'
import { millimes, pointsDeBase, sommer, type Millimes } from './monnaie.js'
import type { ChargesUtiles, EvenementCommande, TypeEvenement } from './evenements.js'
import { reduireEvenements, type EtatCommande } from './reduction.js'
import { calculerTotaux } from './totaux.js'
import { transitionAutorisee } from './machine-etat.js'
import {
  calculerRemboursement,
  ErreurRemboursement,
  partsRemboursables,
  resteRemboursable,
  totalRembourse,
} from './remboursement.js'
import { resumerShift } from './shift.js'
import { construireTicketClient } from './ticket.js'
import type { ConfigCalcul, Remise, TauxTaxe } from './types.js'

const m = (n: number): Millimes => millimes(n)
const bp = (n: number) => pointsDeBase(n)

const TVA_19: TauxTaxe = { id: 'tva-19', nom: 'TVA 19 %', tauxBp: bp(1900), incluse: false }
const TVA_07_INCL: TauxTaxe = { id: 'tva-07', nom: 'TVA 7 %', tauxBp: bp(700), incluse: true }
const base: ConfigCalcul = { tauxTaxes: { [TVA_19.id]: TVA_19, [TVA_07_INCL.id]: TVA_07_INCL } }

let compteur = 0
function ev<T extends TypeEvenement>(type: T, payload: ChargesUtiles[T]): EvenementCommande<T> {
  compteur += 1
  return {
    eventId: `evt-${compteur.toString().padStart(5, '0')}`,
    orderId: 'cmd-1',
    restaurantId: 'resto-1',
    organizationId: 'org-1',
    deviceId: 'device-a',
    seqDevice: compteur,
    clientTs: new Date(Date.UTC(2026, 9, 16, 12, 0, compteur)).toISOString(),
    serverSeq: null,
    type,
    payload,
    acteurId: 'caissier-1',
  }
}

interface LigneEssai {
  id: string
  prix: number
  qte: number
  taux?: string
  remise?: Remise
}

/** Un ticket ENCAISSÉ, prêt à être remboursé. */
function ticketEncaisse(
  lignes: readonly LigneEssai[],
  options: { remiseGlobale?: Remise; config?: ConfigCalcul } = {},
): { journal: EvenementCommande[]; etat: EtatCommande; config: ConfigCalcul } {
  const config = options.config ?? base
  const journal: EvenementCommande[] = [
    ev('order.opened', { type: 'dine_in', ouvertePar: 'caissier-1' }),
  ]
  for (const l of lignes) {
    journal.push(
      ev('line.added', {
        ligneId: l.id,
        produitId: `p-${l.id}`,
        designation: `Article ${l.id}`,
        quantite: l.qte,
        prixBaseMillimes: m(l.prix),
        modificateursMillimes: m(0),
        tauxTaxeId: l.taux ?? TVA_19.id,
      }),
    )
    if (l.remise) journal.push(ev('discount.applied', { ligneId: l.id, remise: l.remise }))
  }
  if (options.remiseGlobale) journal.push(ev('discount.applied', { remise: options.remiseGlobale }))
  const avant = reduireEvenements(journal)
  const total = calculerTotaux({
    lignes: avant.lignes,
    remiseGlobale: avant.remiseGlobale ?? undefined,
    config,
  }).totalMillimes
  journal.push(
    ev('payment.recorded', {
      paiementId: 'pay-1',
      methodeId: 'methode-especes',
      mode: 'cash',
      montantMillimes: total,
    }),
  )
  journal.push(ev('order.closed', { totalMillimes: total, closePar: 'caissier-1' }))
  return { journal, etat: reduireEvenements(journal), config }
}

const totauxDe = (etat: EtatCommande, config: ConfigCalcul) =>
  calculerTotaux({ lignes: etat.lignes, remiseGlobale: etat.remiseGlobale ?? undefined, config })

const rembourser = (
  journal: EvenementCommande[],
  ligneIds: string[],
  montant: number,
  options: {
    id?: string
    mode?: 'cash' | 'card'
    shiftId?: string
    quantites?: Record<string, number>
  } = {},
) =>
  ev('refund.recorded', {
    remboursementId: options.id ?? `ref-${compteur + 1}`,
    paiementId: 'pay-1',
    mode: options.mode ?? 'cash',
    montantMillimes: m(montant),
    ligneIds,
    ...(options.quantites ? { quantites: options.quantites } : {}),
    motif: 'Plat non conforme',
    shiftId: options.shiftId ?? 'shift-1',
  })

describe('remboursement — ce que coûte une ligne', () => {
  it('une remise globale FIXE est rendue à sa part, pas au prix de la ligne', () => {
    // 10 + 10, remise de 5 TND : chaque ligne a coûté 7,500 HT, + 19 %.
    const { etat, config } = ticketEncaisse(
      [
        { id: 'a', prix: 10_000, qte: 1 },
        { id: 'b', prix: 10_000, qte: 1 },
      ],
      { remiseGlobale: { type: 'montant', valeurMillimes: m(5_000) } },
    )
    const totaux = totauxDe(etat, config)
    const r = calculerRemboursement(etat, totaux, ['b'])
    // La règle « total avant − total après » aurait rendu 11,900 : la
    // remise de 5 TND se serait reportée entière sur la ligne restante.
    expect(r.montantMillimes).toBe(m(8_925))
    expect(r.ticketSolde).toBe(false)
  })

  it('rendre TOUTES les lignes rend EXACTEMENT le total, au millime', () => {
    const config: ConfigCalcul = {
      ...base,
      service: { tauxBp: bp(1000), taxable: true, tauxTaxeId: TVA_19.id },
      timbreFiscalMillimes: m(600),
    }
    const { etat } = ticketEncaisse(
      [
        { id: 'a', prix: 3_333, qte: 3 },
        { id: 'b', prix: 14_500, qte: 1, taux: TVA_07_INCL.id },
        { id: 'c', prix: 1, qte: 7, remise: { type: 'pourcentage', valeurBp: bp(3300) } },
        { id: 'd', prix: 4_200, qte: 2, taux: TVA_07_INCL.id },
      ],
      { remiseGlobale: { type: 'pourcentage', valeurBp: bp(1250) }, config },
    )
    const totaux = totauxDe(etat, config)
    const r = calculerRemboursement(etat, totaux, ['a', 'b', 'c', 'd'])
    expect(r.ticketSolde).toBe(true)
    expect(r.montantMillimes).toBe(totaux.totalMillimes)
  })

  it('en plusieurs fois aussi : la somme des remboursements partiels vaut le total', () => {
    // Plusieurs tickets « tordus », générés de façon déterministe : le
    // résultat ne doit JAMAIS perdre ni inventer un millime.
    let graine = 7
    const alea = (n: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648
      return graine % n
    }
    for (let essai = 0; essai < 60; essai += 1) {
      const config: ConfigCalcul = {
        ...base,
        service: alea(2) ? { tauxBp: bp(alea(1500)), taxable: alea(2) === 1, tauxTaxeId: TVA_19.id } : undefined,
        timbreFiscalMillimes: m(alea(2) ? 600 : 0),
      }
      const lignes = Array.from({ length: 1 + alea(6) }, (_, i) => ({
        id: `l${i}`,
        prix: 1 + alea(25_000),
        qte: 1 + alea(4),
        taux: alea(2) ? TVA_19.id : TVA_07_INCL.id,
      }))
      const remiseGlobale: Remise | undefined = alea(2)
        ? { type: 'montant', valeurMillimes: m(alea(5_000)) }
        : { type: 'pourcentage', valeurBp: bp(alea(5000)) }
      const t = ticketEncaisse(lignes, { remiseGlobale, config })
      const totaux = totauxDe(t.etat, config)

      // On rend les lignes une par une, en rejouant le journal à chaque fois.
      let journal = t.journal
      let rendu = 0
      for (const l of lignes) {
        const etat = reduireEvenements(journal)
        const r = calculerRemboursement(etat, totaux, [l.id])
        rendu += r.montantMillimes
        journal = [...journal, rembourser(journal, [l.id], r.montantMillimes)]
      }
      expect(rendu, `essai ${essai}`).toBe(totaux.totalMillimes)
      expect(resteRemboursable(reduireEvenements(journal), totaux)).toBe(0)
    }
  })

  it('le TIMBRE ne part qu avec la dernière ligne', () => {
    const config: ConfigCalcul = { ...base, timbreFiscalMillimes: m(600) }
    const { journal, etat } = ticketEncaisse(
      [
        { id: 'a', prix: 10_000, qte: 1 },
        { id: 'b', prix: 5_000, qte: 1 },
      ],
      { config },
    )
    const totaux = totauxDe(etat, config)
    const premier = calculerRemboursement(etat, totaux, ['a'])
    expect(premier.timbreMillimes).toBe(0)
    const apres = reduireEvenements([...journal, rembourser(journal, ['a'], premier.montantMillimes)])
    const second = calculerRemboursement(apres, totaux, ['b'])
    expect(second.timbreMillimes).toBe(600)
    expect(second.ticketSolde).toBe(true)
  })

  it('une ligne ANNULÉE avant l encaissement ne se rembourse pas : elle n a rien coûté', () => {
    const { journal } = ticketEncaisse([{ id: 'a', prix: 10_000, qte: 1 }])
    // On rejoue en annulant une ligne b avant la clôture.
    const avecAnnulee = [
      ...journal.slice(0, 2),
      ev('line.added', {
        ligneId: 'b',
        produitId: 'p-b',
        designation: 'Article b',
        quantite: 1,
        prixBaseMillimes: m(4_000),
        modificateursMillimes: m(0),
        tauxTaxeId: TVA_19.id,
      }),
      ev('line.voided', { ligneId: 'b', motif: 'Erreur' }),
      ...journal.slice(2),
    ]
    const etat = reduireEvenements(avecAnnulee)
    const parts = partsRemboursables(etat, totauxDe(etat, base))
    expect(parts.map((p) => p.ligneId)).toEqual(['a'])
  })
})

describe('remboursement — une partie d’une ligne (1 pizza sur 3)', () => {
  it('une unité vaut le tiers, l’écart d’arrondi part avec la DERNIÈRE', () => {
    // 3 × 12,183 HT + 19 % : la part de la ligne ne se divise pas par trois.
    const { journal, etat, config } = ticketEncaisse([{ id: 'a', prix: 12_183, qte: 3 }])
    const totaux = totauxDe(etat, config)
    const part = partsRemboursables(etat, totaux)[0]!
    const unite = Math.floor(part.montantMillimes / 3)
    expect(part.montantMillimes % 3).not.toBe(0)

    const r1 = calculerRemboursement(etat, totaux, ['a'], { a: 1 })
    expect(r1.montantMillimes).toBe(unite)
    expect(r1.quantites).toEqual({ a: 1 })
    expect(r1.ticketSolde).toBe(false)

    const j2 = [...journal, rembourser(journal, ['a'], r1.montantMillimes, { quantites: { a: 1 } })]
    const e2 = reduireEvenements(j2)
    expect(partsRemboursables(e2, totaux)[0]!.quantiteRemboursee).toBe(1)
    expect(partsRemboursables(e2, totaux)[0]!.dejaRemboursee).toBe(false)

    // Les deux dernières : le reste EXACT de la ligne.
    const r2 = calculerRemboursement(e2, totaux, ['a'], { a: 2 })
    expect(r2.ticketSolde).toBe(true)
    expect(r1.montantMillimes + r2.montantMillimes).toBe(part.montantMillimes)
    expect(r1.montantMillimes + r2.montantMillimes).toBe(totaux.totalMillimes)
  })

  it('rendre unité par unité, sur des tickets tordus, rend EXACTEMENT le total', () => {
    let graine = 11
    const alea = (n: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648
      return graine % n
    }
    for (let essai = 0; essai < 60; essai += 1) {
      const config: ConfigCalcul = {
        ...base,
        service: alea(2) ? { tauxBp: bp(alea(1500)), taxable: alea(2) === 1, tauxTaxeId: TVA_19.id } : undefined,
        timbreFiscalMillimes: m(alea(2) ? 600 : 0),
      }
      const lignes = Array.from({ length: 1 + alea(4) }, (_, i) => ({
        id: `l${i}`,
        prix: 1 + alea(25_000),
        qte: 1 + alea(5),
        taux: alea(2) ? TVA_19.id : TVA_07_INCL.id,
      }))
      const t = ticketEncaisse(lignes, {
        remiseGlobale: { type: 'pourcentage', valeurBp: bp(alea(5000)) },
        config,
      })
      const totaux = totauxDe(t.etat, config)
      let journal = t.journal
      let rendu = 0
      for (const l of lignes) {
        for (let u = 0; u < l.qte; u += 1) {
          const etat = reduireEvenements(journal)
          const r = calculerRemboursement(etat, totaux, [l.id], { [l.id]: 1 })
          rendu += r.montantMillimes
          journal = [...journal, rembourser(journal, [l.id], r.montantMillimes, { quantites: r.quantites })]
        }
      }
      expect(rendu, `essai ${essai}`).toBe(totaux.totalMillimes)
      expect(reduireEvenements(journal).exceptions).toEqual([])
    }
  })

  it('refuse zéro unité, plus que ce qui reste, et une fraction', () => {
    const { etat, config } = ticketEncaisse([{ id: 'a', prix: 5_000, qte: 3 }])
    const totaux = totauxDe(etat, config)
    expect(() => calculerRemboursement(etat, totaux, ['a'], { a: 0 })).toThrow(ErreurRemboursement)
    expect(() => calculerRemboursement(etat, totaux, ['a'], { a: 4 })).toThrow(ErreurRemboursement)
    expect(() => calculerRemboursement(etat, totaux, ['a'], { a: 1.5 })).toThrow(ErreurRemboursement)
  })

  it('une ligne d’une seule unité se rend en entier, sans découpe', () => {
    const { etat, config } = ticketEncaisse([{ id: 'a', prix: 5_000, qte: 1 }])
    const totaux = totauxDe(etat, config)
    const part = partsRemboursables(etat, totaux)[0]!
    expect(part.divisible).toBe(false)
    expect(calculerRemboursement(etat, totaux, ['a'], { a: 1 }).montantMillimes).toBe(part.montantMillimes)
  })

  it('un événement ANCIEN, sans quantités, rend la ligne entière', () => {
    const { journal, etat, config } = ticketEncaisse([{ id: 'a', prix: 5_000, qte: 3 }])
    const totaux = totauxDe(etat, config)
    const r = calculerRemboursement(etat, totaux, ['a'])
    const apres = reduireEvenements([...journal, rembourser(journal, ['a'], r.montantMillimes)])
    expect(apres.remboursements[0]!.quantites).toEqual({ a: 3 })
    expect(partsRemboursables(apres, totaux)[0]!.dejaRemboursee).toBe(true)
  })

  it('deux caisses qui rendent chacune 2 pizzas sur 3 : c’est SIGNALÉ', () => {
    const { journal, etat, config } = ticketEncaisse([{ id: 'a', prix: 5_000, qte: 3 }])
    const totaux = totauxDe(etat, config)
    const r = calculerRemboursement(etat, totaux, ['a'], { a: 2 })
    const apres = reduireEvenements([
      ...journal,
      rembourser(journal, ['a'], r.montantMillimes, { id: 'ref-x', quantites: { a: 2 } }),
      rembourser(journal, ['a'], r.montantMillimes, { id: 'ref-y', quantites: { a: 2 } }),
    ])
    expect(apres.remboursements).toHaveLength(2)
    expect(apres.exceptions.map((e) => e.type)).toContain('double_remboursement')
  })
})

describe('remboursement — refus', () => {
  it('refuse une sélection vide, une ligne inconnue, une ligne déjà rendue', () => {
    const { journal, etat } = ticketEncaisse([
      { id: 'a', prix: 10_000, qte: 1 },
      { id: 'b', prix: 5_000, qte: 1 },
    ])
    const totaux = totauxDe(etat, base)
    expect(() => calculerRemboursement(etat, totaux, [])).toThrow(ErreurRemboursement)
    expect(() => calculerRemboursement(etat, totaux, ['zz'])).toThrow(/absente/)
    const apres = reduireEvenements([...journal, rembourser(journal, ['a'], 11_900)])
    expect(() => calculerRemboursement(apres, totaux, ['a'])).toThrow(/déjà été remboursé/)
  })

  it('refuse une commande qui n est pas encaissée', () => {
    const ouverte = reduireEvenements([
      ev('order.opened', { type: 'dine_in', ouvertePar: 'caissier-1' }),
      ev('line.added', {
        ligneId: 'a',
        produitId: 'p',
        designation: 'A',
        quantite: 1,
        prixBaseMillimes: m(1_000),
        modificateursMillimes: m(0),
        tauxTaxeId: TVA_19.id,
      }),
    ])
    expect(() => calculerRemboursement(ouverte, totauxDe(ouverte, base), ['a'])).toThrow(
      /encaissé/,
    )
  })

  it('la machine d état n accepte un remboursement QUE sur un ticket encaissé', () => {
    expect(transitionAutorisee('close', 'refund.recorded').autorisee).toBe(true)
    expect(transitionAutorisee('ouverte', 'refund.recorded').autorisee).toBe(false)
    expect(transitionAutorisee('envoyee', 'refund.recorded').autorisee).toBe(false)
    expect(transitionAutorisee('annulee', 'refund.recorded').autorisee).toBe(false)
  })
})

describe('remboursement — le journal', () => {
  it('n efface rien : le ticket reste encaissé, le remboursement s y AJOUTE', () => {
    const { journal } = ticketEncaisse([{ id: 'a', prix: 10_000, qte: 1 }])
    const etat = reduireEvenements([...journal, rembourser(journal, ['a'], 11_900)])
    expect(etat.statut).toBe('close')
    expect(etat.lignes).toHaveLength(1)
    expect(etat.paiements).toHaveLength(1)
    expect(etat.remboursements).toHaveLength(1)
    expect(etat.remboursements[0]!.shiftId).toBe('shift-1')
    expect(totalRembourse(etat)).toBe(11_900)
    expect(etat.exceptions).toEqual([])
  })

  it('est idempotent : le même remboursement reçu trois fois ne compte qu une fois', () => {
    const { journal } = ticketEncaisse([{ id: 'a', prix: 10_000, qte: 1 }])
    const r = rembourser(journal, ['a'], 11_900, { id: 'ref-unique' })
    const etat = reduireEvenements([...journal, r, r, r])
    expect(etat.remboursements).toHaveLength(1)
  })

  it('deux caisses hors ligne qui rendent la MÊME ligne : les deux comptent, et c est SIGNALÉ', () => {
    const { journal } = ticketEncaisse([{ id: 'a', prix: 10_000, qte: 1 }])
    const etat = reduireEvenements([
      ...journal,
      rembourser(journal, ['a'], 11_900, { id: 'ref-caisse-1' }),
      rembourser(journal, ['a'], 11_900, { id: 'ref-caisse-2' }),
    ])
    // L'argent est sorti deux fois : l'ignorer ferait mentir le tiroir.
    expect(totalRembourse(etat)).toBe(23_800)
    expect(etat.exceptions.map((e) => e.type)).toContain('double_remboursement')
  })

  it('un remboursement sur une commande non encaissée est conservé ET signalé', () => {
    const etat = reduireEvenements([
      ev('order.opened', { type: 'dine_in', ouvertePar: 'caissier-1' }),
      ev('refund.recorded', {
        remboursementId: 'r',
        paiementId: 'pay-x',
        mode: 'cash',
        montantMillimes: m(1_000),
        ligneIds: [],
        motif: 'Test',
      }),
    ])
    expect(etat.remboursements).toHaveLength(1)
    expect(etat.exceptions.map((e) => e.type)).toContain('remboursement_hors_encaissement')
  })
})

describe('remboursement — le tiroir et le ticket', () => {
  const shift = {
    id: 'shift-1',
    restaurantId: 'resto-1',
    organizationId: 'org-1',
    deviceId: 'device-a',
    employeId: 'caissier-1',
    ouvertA: '2026-10-16T08:00:00Z',
    fondDeCaisseMillimes: m(50_000),
    closA: null,
    compteMillimes: null,
    noteCloture: null,
  }

  it('rendu en ESPÈCES : il sort du tiroir attendu', () => {
    const r = resumerShift({
      shift,
      encaissements: [{ paiementId: 'p', mode: 'cash', montantMillimes: m(20_000), annule: false }],
      mouvements: [],
      nombreCommandes: 1,
      chiffreAffairesMillimes: m(20_000),
      remboursements: [{ mode: 'cash', montantMillimes: m(8_000) }],
    })
    expect(r.remboursementsEspecesMillimes).toBe(8_000)
    expect(r.attenduMillimes).toBe(62_000)
  })

  it('rendu sur CARTE : le tiroir n est pas concerné', () => {
    const r = resumerShift({
      shift,
      encaissements: [],
      mouvements: [],
      nombreCommandes: 0,
      chiffreAffairesMillimes: m(0),
      remboursements: [{ mode: 'card', montantMillimes: m(8_000) }],
    })
    expect(r.remboursementsEspecesMillimes).toBe(0)
    expect(r.attenduMillimes).toBe(50_000)
  })

  it('le ticket réédité porte ce qui a été rendu', () => {
    const { journal, config } = ticketEncaisse([{ id: 'a', prix: 10_000, qte: 1 }])
    const etat = reduireEvenements([...journal, rembourser(journal, ['a'], 11_900)])
    const ticket = construireTicketClient(etat, totauxDe(etat, config), {
      etablissement: { nom: 'Snack', adresse: null, telephone: null, identifiantFiscal: null },
      employe: null,
      libelleTable: null,
      numeroFiscal: null,
      libellesPaiement: {},
    })
    expect(ticket.remboursements).toEqual([{ motif: 'Plat non conforme', montantMillimes: 11_900 }])
    expect(sommer(ticket.remboursements.map((r) => r.montantMillimes))).toBe(ticket.totalMillimes)
  })
})
