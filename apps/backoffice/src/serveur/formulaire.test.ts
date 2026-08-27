/**
 * Ces tests gardent la frontière où l'argent entre dans le système.
 *
 * Une saisie mal lue ici ne provoque pas d'erreur : elle enregistre un prix
 * faux, que la tablette vendra sans broncher jusqu'au premier écart de caisse.
 */

import { describe, expect, it } from 'vitest'
import {
  caseCochee,
  choix,
  choixFacultatif,
  ErreurSaisie,
  montantMillimes,
  position,
  pourChampMontant,
  texteFacultatif,
  texteObligatoire,
} from './formulaire.js'

function form(champs: Record<string, string>): FormData {
  const donnees = new FormData()
  for (const [cle, valeur] of Object.entries(champs)) donnees.set(cle, valeur)
  return donnees
}

describe('montants', () => {
  it('le dinar a TROIS décimales, pas deux', () => {
    // Une bibliothèque qui suppose « centimes = ×100 » rendrait 2450.
    expect(montantMillimes(form({ prix: '24,5' }), 'prix', 'Prix')).toBe(24500)
    expect(montantMillimes(form({ prix: '24.500' }), 'prix', 'Prix')).toBe(24500)
    expect(montantMillimes(form({ prix: '24' }), 'prix', 'Prix')).toBe(24000)
    expect(montantMillimes(form({ prix: '0,001' }), 'prix', 'Prix')).toBe(1)
  })

  it('accepte la virgule ET le point — un gérant tape ce qu’il veut', () => {
    const virgule = montantMillimes(form({ p: '3,750' }), 'p', 'Prix')
    const point = montantMillimes(form({ p: '3.750' }), 'p', 'Prix')
    expect(virgule).toBe(point)
  })

  it('arrondit au millime, sans jamais produire de fraction', () => {
    expect(montantMillimes(form({ p: '1,2345' }), 'p', 'Prix')).toBe(1235)
    expect(Number.isInteger(montantMillimes(form({ p: '9,9999' }), 'p', 'Prix'))).toBe(true)
  })

  it('refuse ce qui n’est pas un montant, en nommant le champ', () => {
    expect(() => montantMillimes(form({ prix: '12 dinars' }), 'prix', 'Prix'))
      .toThrow(ErreurSaisie)
    try {
      montantMillimes(form({ prix: 'abc' }), 'prix', 'Prix de base')
    } catch (erreur) {
      expect((erreur as ErreurSaisie).champ).toBe('prix')
      expect((erreur as ErreurSaisie).message).toContain('Prix de base')
    }
  })

  it('refuse un prix négatif, mais autorise un écart de variante négatif', () => {
    expect(() => montantMillimes(form({ p: '-1' }), 'p', 'Prix')).toThrow(/négatif/)
    expect(
      montantMillimes(form({ d: '-2,500' }), 'd', 'Écart', { autoriseNegatif: true }),
    ).toBe(-2500)
  })

  it('exige une valeur : un champ vide n’est pas zéro', () => {
    // Un prix laissé vide qui vaudrait 0 mettrait le produit en vente gratuite.
    expect(() => montantMillimes(form({ p: '' }), 'p', 'Prix')).toThrow(/obligatoire/)
    expect(() => montantMillimes(form({}), 'p', 'Prix')).toThrow(/obligatoire/)
  })

  it('l’aller-retour champ → millimes → champ est stable', () => {
    for (const centimes of [0, 1, 999, 1000, 24500, 1234567]) {
      const affiche = pourChampMontant(centimes)
      expect(montantMillimes(form({ p: affiche }), 'p', 'Prix')).toBe(centimes)
    }
  })
})

describe('textes', () => {
  it('rogne les espaces et refuse le vide', () => {
    expect(texteObligatoire(form({ n: '  Pizza  ' }), 'n', 'Nom')).toBe('Pizza')
    expect(() => texteObligatoire(form({ n: '   ' }), 'n', 'Nom')).toThrow(/obligatoire/)
  })

  it('borne la longueur avant que le CHECK du schéma ne le fasse', () => {
    // Le message de PostgreSQL serait incompréhensible pour un gérant.
    expect(() => texteObligatoire(form({ n: 'x'.repeat(201) }), 'n', 'Nom')).toThrow(/200/)
  })

  it('un texte facultatif vide vaut NULL, pas chaîne vide', () => {
    // Une chaîne vide en base se distingue mal d’une valeur réellement saisie.
    expect(texteFacultatif(form({ d: '' }), 'd')).toBeNull()
    expect(texteFacultatif(form({ d: 'note' }), 'd')).toBe('note')
  })
})

describe('choix', () => {
  const ROLES = ['gerant', 'caissier', 'serveur'] as const

  it('n’accepte que ce qui a réellement été proposé', () => {
    expect(choix(form({ r: 'caissier' }), 'r', 'Rôle', ROLES)).toBe('caissier')
    // Le navigateur n’est pas une source de vérité : un champ trafiqué doit
    // échouer ici, avec un message lisible, plutôt que sur une contrainte SQL.
    expect(() => choix(form({ r: 'admin' }), 'r', 'Rôle', ROLES)).toThrow(/invalide/)
  })

  it('distingue « rien choisi » de « choix invalide »', () => {
    expect(choixFacultatif(form({ c: '' }), 'c', 'Catégorie', ROLES)).toBeNull()
    expect(() => choixFacultatif(form({ c: 'zzz' }), 'c', 'Catégorie', ROLES)).toThrow()
  })
})

describe('cases et positions', () => {
  it('une case absente est décochée — le navigateur ne l’envoie pas', () => {
    expect(caseCochee(form({}), 'dispo')).toBe(false)
    expect(caseCochee(form({ dispo: 'on' }), 'dispo')).toBe(true)
  })

  it('la position reste un entier raisonnable', () => {
    expect(position(form({ p: '' }), 'p')).toBe(0)
    expect(position(form({ p: '12' }), 'p')).toBe(12)
    expect(() => position(form({ p: '1,5' }), 'p')).toThrow()
    expect(() => position(form({ p: '-1' }), 'p')).toThrow()
  })
})
