/**
 * La validation d'une mutation de catalogue — LE MÊME code des deux côtés.
 *
 * Ce que ce test protège : la caisse et le serveur doivent refuser exactement
 * les mêmes choses. Une règle dupliquée diverge — la caisse accepterait un nom
 * de 250 caractères que Postgres refuse, et l'article partirait dans un rejet
 * que personne ne sait lire.
 */

import { describe, expect, it } from 'vitest'
import {
  NOM_PRODUIT_MAX,
  peutModifierCatalogue,
  validerMutationCatalogue,
  type MutationCatalogue,
} from './mutations-catalogue.js'
import { millimes } from './monnaie.js'

const base: MutationCatalogue = {
  mutationId: '01930000-0000-7000-8000-00000000000a',
  type: 'catalogue.produit.cree',
  organizationId: '01930000-0000-7000-8000-000000000001',
  restaurantId: '01930000-0000-7000-8000-000000000002',
  deviceId: '01930000-0000-7000-8000-000000000003',
  parEmployeId: '01930000-0000-7000-8000-000000000004',
  produitId: '01930000-0000-7000-8000-000000000005',
  nom: 'Plat du jour',
  categorieId: '01930000-0000-7000-8000-000000000006',
  tauxTvaId: '01930000-0000-7000-8000-000000000007',
  prixBaseMillimes: millimes(14_500),
  clientTs: '2026-09-13T10:00:00.000Z',
  protocolVersion: 1,
}

describe('valider une création d’article', () => {
  it('accepte une saisie normale', () => {
    expect(validerMutationCatalogue(base).valide).toBe(true)
  })

  it('refuse un nom vide — y compris fait d’espaces', () => {
    expect(validerMutationCatalogue({ ...base, nom: '   ' }).valide).toBe(false)
  })

  it('refuse un nom plus long que ce que Postgres accepte', () => {
    // La borne est celle de la colonne, pas une valeur de confort : la
    // dépasser produirait un rejet côté serveur, après coup, sur un article
    // que le caissier voit déjà dans sa carte.
    const trop = 'a'.repeat(NOM_PRODUIT_MAX + 1)
    expect(validerMutationCatalogue({ ...base, nom: trop }).valide).toBe(false)
    expect(validerMutationCatalogue({ ...base, nom: 'a'.repeat(NOM_PRODUIT_MAX) }).valide).toBe(true)
  })

  it('refuse un prix DÉCIMAL — le piège des dinars pris pour des millimes', () => {
    /*
     * 14,5 dinars saisis tels quels au lieu de 14500 millimes : le contrôle
     * de signe les laisserait passer, et la pizza se vendrait 14 millimes.
     * C'est la règle 1, et elle ne se voit qu'ici.
     */
    expect(validerMutationCatalogue({ ...base, prixBaseMillimes: 14.5 as never }).valide).toBe(false)
  })

  it('refuse un prix négatif, accepte la gratuité', () => {
    expect(validerMutationCatalogue({ ...base, prixBaseMillimes: millimes(-1) }).valide).toBe(false)
    // 0 est légitime : un accompagnement offert existe à la carte.
    expect(validerMutationCatalogue({ ...base, prixBaseMillimes: millimes(0) }).valide).toBe(true)
  })

  it('refuse un article sans taux de TVA', () => {
    // `tax_rate_id` est NOT NULL côté Postgres : sans lui, l'insertion échoue
    // et le rejet arrive une heure plus tard.
    expect(validerMutationCatalogue({ ...base, tauxTvaId: '' }).valide).toBe(false)
  })

  it('accepte un article SANS catégorie', () => {
    // `category_id` est nullable des deux côtés. Un plat du jour créé à la
    // volée n'a pas toujours sa place décidée.
    expect(validerMutationCatalogue({ ...base, categorieId: null }).valide).toBe(true)
  })
})

describe('qui peut toucher au catalogue', () => {
  it('le gérant et l’administrateur, personne d’autre', () => {
    expect(peutModifierCatalogue('gerant')).toBe(true)
    expect(peutModifierCatalogue('admin')).toBe(true)
    for (const role of ['caissier', 'serveur', 'cuisine', 'bar', '']) {
      expect(peutModifierCatalogue(role), role).toBe(false)
    }
  })

  it('la validation NE dit RIEN des droits', () => {
    /*
     * Les deux questions se posent séparément, sinon on finit par croire
     * qu'un formulaire correct est un formulaire autorisé. La validation
     * passe ici pour un employé qui n'a aucun droit — c'est le SERVEUR, en
     * relisant le rôle en base, qui refusera.
     */
    expect(validerMutationCatalogue(base).valide).toBe(true)
    expect(peutModifierCatalogue('serveur')).toBe(false)
  })
})

// ── Les entités créées depuis la caisse, au-delà de l'article ────────────────

const commun = {
  mutationId: '01930000-0000-7000-8000-00000000000a',
  organizationId: '01930000-0000-7000-8000-000000000001',
  restaurantId: '01930000-0000-7000-8000-000000000002',
  deviceId: '01930000-0000-7000-8000-000000000003',
  parEmployeId: '01930000-0000-7000-8000-000000000004',
  clientTs: '2026-10-15T10:00:00.000Z',
  protocolVersion: 1,
} as const

describe('valider une création de catégorie', () => {
  const cat: MutationCatalogue = {
    ...commun,
    type: 'catalogue.categorie.cree',
    categorieId: '01930000-0000-7000-8000-000000000020',
    nom: 'Entrées',
    couleur: '#C4562B',
    stationId: null,
  }
  it('accepte une saisie normale, avec ou sans couleur et poste', () => {
    expect(validerMutationCatalogue(cat).valide).toBe(true)
    expect(validerMutationCatalogue({ ...cat, couleur: null }).valide).toBe(true)
  })
  it('refuse un nom vide et une couleur mal formée', () => {
    expect(validerMutationCatalogue({ ...cat, nom: '  ' }).valide).toBe(false)
    expect(validerMutationCatalogue({ ...cat, couleur: 'rouge' }).valide).toBe(false)
  })
})

describe('valider une création de réduction', () => {
  const pct: MutationCatalogue = {
    ...commun,
    type: 'catalogue.reduction.cree',
    reductionId: '01930000-0000-7000-8000-000000000030',
    nom: 'Happy hour',
    kind: 'pourcentage',
    valeurBp: 1000 as never,
    montantMillimes: null,
  }
  const montant: MutationCatalogue = {
    ...pct,
    nom: 'Geste',
    kind: 'montant',
    valeurBp: null,
    montantMillimes: millimes(2000),
  }
  it('accepte un pourcentage et un montant', () => {
    expect(validerMutationCatalogue(pct).valide).toBe(true)
    expect(validerMutationCatalogue(montant).valide).toBe(true)
  })
  it('refuse un pourcentage hors 0–100', () => {
    expect(validerMutationCatalogue({ ...pct, valeurBp: 15000 as never }).valide).toBe(false)
  })
  it('refuse de porter les DEUX valeurs à la fois', () => {
    expect(validerMutationCatalogue({ ...pct, montantMillimes: millimes(500) }).valide).toBe(false)
    expect(validerMutationCatalogue({ ...montant, valeurBp: 500 as never }).valide).toBe(false)
  })
})

describe('valider une création de groupe de modificateurs', () => {
  const grp: MutationCatalogue = {
    ...commun,
    type: 'catalogue.modificateur.cree',
    groupeId: '01930000-0000-7000-8000-000000000040',
    nom: 'Cuisson',
    minSelect: 1,
    maxSelect: 1,
    choix: [
      { id: '01930000-0000-7000-8000-000000000041', nom: 'Saignant', prixDeltaMillimes: millimes(0) },
      { id: '01930000-0000-7000-8000-000000000042', nom: 'Supplément', prixDeltaMillimes: millimes(1500) },
    ],
    produitIds: ['01930000-0000-7000-8000-000000000005'],
  }
  it('accepte un groupe avec des choix', () => {
    expect(validerMutationCatalogue(grp).valide).toBe(true)
  })
  it('accepte un choix à prix NÉGATIF (petite portion)', () => {
    expect(
      validerMutationCatalogue({
        ...grp,
        choix: [{ id: grp.choix[0]!.id, nom: 'Petite', prixDeltaMillimes: millimes(-1500) }],
      }).valide,
    ).toBe(true)
  })
  it('refuse un groupe sans aucun choix — il ne proposerait rien', () => {
    expect(validerMutationCatalogue({ ...grp, choix: [] }).valide).toBe(false)
  })
  it('refuse un maximum sous le minimum (0 = sans limite reste permis)', () => {
    expect(validerMutationCatalogue({ ...grp, minSelect: 2, maxSelect: 1 }).valide).toBe(false)
    expect(validerMutationCatalogue({ ...grp, minSelect: 2, maxSelect: 0 }).valide).toBe(true)
  })
})
