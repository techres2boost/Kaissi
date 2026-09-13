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
