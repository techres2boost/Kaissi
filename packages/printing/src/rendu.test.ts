import { describe, expect, it } from 'vitest'
import {
  millimes,
  pointsDeBase,
  resumerShift,
  type Millimes,
  type TicketClient,
  type TicketCuisine,
  type TicketShift,
} from '@kaissi/domain'
import {
  apercuTexte,
  depuisBase64,
  rendreOuvertureTiroir,
  rendreTicketClient,
  rendreTicketCuisine,
  rendreTicketShift,
  versBase64,
} from './rendu.js'

const m = (n: number): Millimes => millimes(n)

const etablissement = {
  nom: 'Snack Lac 1',
  adresse: 'Rue du Lac Turkana, Les Berges du Lac, Tunis',
  telephone: '+216 71 000 000',
  identifiantFiscal: null,
}

const ticket: TicketClient = {
  type: 'ticket',
  etablissement,
  numeroTicket: 'P1-000431',
  numeroFiscal: null,
  dateHeure: '25/08/2026 19:48',
  employe: 'Salma',
  table: '12',
  typeCommande: 'Sur place',
  couverts: 2,
  lignes: [
    {
      quantite: 1,
      designation: 'Pizza Margherita',
      details: ['Fromage 1,500'],
      note: 'Sans oignon',
      totalMillimes: m(16_000),
      remiseMillimes: m(0),
    },
    {
      quantite: 2,
      designation: 'Coca-Cola 33cl',
      details: [],
      note: null,
      totalMillimes: m(8_400),
      remiseMillimes: m(0),
    },
  ],
  sousTotalMillimes: m(24_400),
  remisesMillimes: m(0),
  serviceMillimes: m(0),
  timbreMillimes: m(0),
  ventilation: [
    { nom: 'TVA 19 %', tauxBp: 1900, incluse: true, baseMillimes: m(13_445), taxeMillimes: m(2_555) },
    { nom: 'TVA 7 %', tauxBp: 700, incluse: true, baseMillimes: m(7_850), taxeMillimes: m(550) },
  ],
  totalMillimes: m(24_400),
  paiements: [{ libelle: 'Espèces', montantMillimes: m(24_400) }],
  renduMillimes: m(600),
  piedDePage: ['Merci de votre visite !'],
}

describe('ticket client', () => {
  it('imprime toutes les informations attendues par le client', () => {
    const texte = apercuTexte(rendreTicketClient(ticket))
    expect(texte).toContain('Snack Lac 1')
    expect(texte).toContain('P1-000431')
    expect(texte).toContain('Table 12')
    expect(texte).toContain('Pizza Margherita')
    expect(texte).toContain('Coca-Cola 33cl')
    expect(texte).toContain('TOTAL')
    expect(texte).toContain('24,400')
    expect(texte).toContain('Merci de votre visite !')
  })

  it('affiche les modificateurs et la note en retrait', () => {
    const texte = apercuTexte(rendreTicketClient(ticket))
    expect(texte).toContain('+ Fromage')
    expect(texte).toContain('> Sans oignon')
  })

  it('imprime la ventilation de TVA PAR TAUX', () => {
    const texte = apercuTexte(rendreTicketClient(ticket))
    expect(texte).toContain('TVA 19 %')
    expect(texte).toContain('TVA 7 %')
    expect(texte).toContain('2,555')
    expect(texte).toContain('0,550')
  })

  it('affiche le rendu de monnaie', () => {
    expect(apercuTexte(rendreTicketClient(ticket))).toMatch(/Rendu\s+0,600/)
  })

  it('n affiche PAS le rendu quand il n y en a pas', () => {
    const exact = { ...ticket, renduMillimes: m(0) }
    expect(apercuTexte(rendreTicketClient(exact))).not.toContain('Rendu')
  })

  it('respecte la largeur du papier, 42 comme 32 colonnes', () => {
    for (const largeur of [42, 32] as const) {
      // L'aperçu doit simuler LA MÊME largeur que le rendu, sinon il centre
      // sur 42 colonnes un ticket imprimé sur 32.
      const texte = apercuTexte(rendreTicketClient(ticket, { largeur }), largeur)
      for (const ligne of texte.split('\n')) {
        expect(ligne.length).toBeLessThanOrEqual(largeur)
      }
    }
  })

  it('coupe le papier à la fin', () => {
    const charge = rendreTicketClient(ticket)
    expect([...charge.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00])
  })

  it('ouvre le tiroir quand on le demande — et pas autrement', () => {
    const avec = rendreTicketClient(ticket, { ouvrirTiroir: true })
    const sans = rendreTicketClient(ticket)
    const impulsion = [0x1b, 0x70, 0x00, 0x19, 0xfa].join(',')
    expect([...avec].join(',')).toContain(impulsion)
    expect([...sans].join(',')).not.toContain(impulsion)
  })

  it('replie une désignation trop longue sans couper les mots', () => {
    const long: TicketClient = {
      ...ticket,
      lignes: [
        {
          quantite: 1,
          designation: 'Escalope panée frites sauce champignons maison',
          details: [],
          note: null,
          totalMillimes: m(16_000),
          remiseMillimes: m(0),
        },
      ],
    }
    const texte = apercuTexte(rendreTicketClient(long, { largeur: 32 }), 32)
    expect(texte).toContain('Escalope')
    expect(texte).toContain('champignons')
    for (const l of texte.split('\n')) expect(l.length).toBeLessThanOrEqual(32)
  })

  it('affiche remises, service et timbre quand ils existent', () => {
    const complet: TicketClient = {
      ...ticket,
      remisesMillimes: m(2_440),
      serviceMillimes: m(1_000),
      timbreMillimes: m(600),
    }
    const texte = apercuTexte(rendreTicketClient(complet))
    expect(texte).toContain('Remises')
    expect(texte).toContain('-2,440')
    expect(texte).toContain('Service')
    expect(texte).toContain('Timbre fiscal')
  })
})

describe('bon de cuisine', () => {
  const kot: TicketCuisine = {
    type: 'kot',
    station: 'Cuisine',
    numeroTicket: 'P1-000431',
    dateHeure: '25/08/2026 19:05',
    table: '12',
    typeCommande: 'Sur place',
    couverts: 2,
    employe: 'Karim',
    rappel: false,
    lignes: [
      { quantite: 1, designation: 'Pizza Margherita', details: ['Fromage'], note: 'Sans oignon' },
      { quantite: 2, designation: 'Escalope panée', details: [], note: null },
    ],
  }

  it('affiche la station, la table et les articles', () => {
    const texte = apercuTexte(rendreTicketCuisine(kot))
    expect(texte).toContain('CUISINE')
    expect(texte).toContain('TABLE 12')
    expect(texte).toContain('Pizza Margherita')
    expect(texte).toContain('2 x Escalope')
  })

  it("ne montre AUCUN prix — la cuisine n'a rien à en faire", () => {
    const texte = apercuTexte(rendreTicketCuisine(kot))
    expect(texte).not.toMatch(/\d+,\d{3}/)
    expect(texte).not.toContain('TND')
    expect(texte).not.toContain('TOTAL')
  })

  it('signale très visiblement une tournée supplémentaire', () => {
    expect(apercuTexte(rendreTicketCuisine({ ...kot, rappel: true }))).toContain('*** RAPPEL ***')
    expect(apercuTexte(rendreTicketCuisine(kot))).not.toContain('RAPPEL')
  })

  it('met la note en évidence — c est elle qui change la préparation', () => {
    expect(apercuTexte(rendreTicketCuisine(kot))).toContain('>> Sans oignon')
  })

  it('affiche « À EMPORTER » quand il n y a pas de table', () => {
    const emporter = { ...kot, table: null, typeCommande: 'À emporter' }
    expect(apercuTexte(rendreTicketCuisine(emporter))).toContain('À EMPORTER')
  })
})

describe('rapport de shift', () => {
  const resume = resumerShift({
    shift: {
      id: 's1',
      restaurantId: 'r',
      organizationId: 'o',
      deviceId: 'd',
      employeId: 'e',
      ouvertA: '2026-08-25T08:00:00.000Z',
      fondDeCaisseMillimes: m(50_000),
      closA: '2026-08-25T23:00:00.000Z',
      compteMillimes: m(74_000),
      noteCloture: null,
    },
    encaissements: [
      { paiementId: 'p1', mode: 'cash', montantMillimes: m(27_200), annule: false },
      { paiementId: 'p2', mode: 'card', montantMillimes: m(100_000), annule: false },
    ],
    mouvements: [
      {
        id: 'mv1',
        type: 'payout',
        montantMillimes: m(3_000),
        motif: 'Pain',
        creeA: '',
        creePar: null,
      },
    ],
    nombreCommandes: 47,
    chiffreAffairesMillimes: m(127_200),
  })

  const rapport: TicketShift = {
    type: 'shift',
    etablissement,
    employe: 'Salma Trabelsi',
    ouvertA: '25/08/2026 08:00',
    closA: '25/08/2026 23:00',
    resume,
  }

  it('imprime les chiffres que le patron regarde', () => {
    const texte = apercuTexte(rendreTicketShift(rapport))
    expect(texte).toContain('RAPPORT DE CAISSE')
    expect(texte).toContain('Salma Trabelsi')
    expect(texte).toContain('47')
    expect(texte).toContain('127,200')
    expect(texte).toContain('ATTENDU EN CAISSE')
  })

  it('affiche l écart avec son SIGNE — un manque ne se confond pas avec un excédent', () => {
    const texte = apercuTexte(rendreTicketShift(rapport))
    expect(resume.ecartMillimes).toBe(-200)
    expect(texte).toContain('ÉCART')
    expect(texte).toContain('-0,200')
  })

  it('préfixe un excédent d un plus explicite', () => {
    const excedent = resumerShift({
      shift: {
        id: 's1', restaurantId: 'r', organizationId: 'o', deviceId: 'd', employeId: 'e',
        ouvertA: '', fondDeCaisseMillimes: m(50_000),
        closA: 'x', compteMillimes: m(80_000), noteCloture: null,
      },
      encaissements: [{ paiementId: 'p', mode: 'cash', montantMillimes: m(27_200), annule: false }],
      mouvements: [],
      nombreCommandes: 1,
      chiffreAffairesMillimes: m(27_200),
    })
    const texte = apercuTexte(rendreTicketShift({ ...rapport, resume: excedent }))
    expect(texte).toContain('+2,800')
  })

  it("n affiche pas d'écart tant que le shift est ouvert", () => {
    const ouvert = resumerShift({
      shift: {
        id: 's1', restaurantId: 'r', organizationId: 'o', deviceId: 'd', employeId: 'e',
        ouvertA: '', fondDeCaisseMillimes: m(50_000),
        closA: null, compteMillimes: null, noteCloture: null,
      },
      encaissements: [],
      mouvements: [],
      nombreCommandes: 0,
      chiffreAffairesMillimes: m(0),
    })
    const texte = apercuTexte(rendreTicketShift({ ...rapport, closA: null, resume: ouvert }))
    expect(texte).not.toContain('ÉCART')
    expect(texte).toContain('en cours')
  })
})

describe('mise en file', () => {
  it('fait un aller-retour base64 sans perdre un octet', () => {
    const charge = rendreTicketClient(ticket)
    expect([...depuisBase64(versBase64(charge))]).toEqual([...charge])
  })

  it('rend une impulsion de tiroir seule', () => {
    const charge = rendreOuvertureTiroir()
    expect([...charge]).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa])
  })
})
