/**
 * L'import CSV de clients — l'analyseur, et le dédoublonnage.
 *
 * Un import de carnet d'adresses ne se relit pas : on charge trois cents
 * lignes, on voit « 300 clients ajoutés », et on passe à autre chose. Ce qui
 * s'y glisse ne se découvre qu'au moment de rappeler quelqu'un.
 */

import { describe, expect, it } from 'vitest'
import { analyserCsv, comparerTelephone } from './clients-csv.js'

describe('l’analyseur CSV', () => {
  it('lit un fichier séparé par des virgules', () => {
    const lignes = analyserCsv('nom,telephone\nSalem,20123456\nAmine,55987654\n')
    expect(lignes).toEqual([
      { nom: 'Salem', telephone: '20123456' },
      { nom: 'Amine', telephone: '55987654' },
    ])
  })

  it('lit aussi le point-virgule des tableurs francophones', () => {
    // Excel en français exporte en points-virgules, et l'utilisateur ne sait
    // pas lequel il a. Le deviner sur l'en-tête évite un fichier qui
    // s'importe en une seule colonne, silencieusement.
    const lignes = analyserCsv('nom;telephone;email\nSalem;20123456;s@exemple.tn\n')
    expect(lignes[0]).toEqual({ nom: 'Salem', telephone: '20123456', email: 's@exemple.tn' })
  })

  it('respecte une virgule DANS un champ entre guillemets', () => {
    // « Ben Salah, Ahmed » est exactement la forme que produit un export de
    // logiciel de caisse. Un `split(',')` le couperait en deux colonnes, et
    // le téléphone finirait dans le nom.
    const lignes = analyserCsv('nom,note\n"Ben Salah, Ahmed","Table 12, au fond"\n')
    expect(lignes[0]?.['nom']).toBe('Ben Salah, Ahmed')
    expect(lignes[0]?.['note']).toBe('Table 12, au fond')
  })

  it('rend son guillemet à un champ qui en contient', () => {
    const lignes = analyserCsv('nom\n"Le ""Petit"" Salem"\n')
    expect(lignes[0]?.['nom']).toBe('Le "Petit" Salem')
  })

  it('ignore les accents et la casse des en-têtes', () => {
    // « Téléphone », « TELEPHONE », « telephone » : trois exports, une seule
    // colonne. Sans cela, la colonne est lue chez l'un et perdue chez
    // l'autre — sans message.
    const lignes = analyserCsv('Nom;Téléphone\nSalem;20123456\n')
    expect(lignes[0]?.['telephone']).toBe('20123456')
  })

  it('survit à un BOM et aux fins de ligne Windows', () => {
    const lignes = analyserCsv('﻿nom,telephone\r\nSalem,20123456\r\n')
    expect(lignes[0]).toEqual({ nom: 'Salem', telephone: '20123456' })
  })

  it('saute les lignes vides du bas de fichier', () => {
    expect(analyserCsv('nom\nSalem\n\n\n')).toHaveLength(1)
  })

  it('rend une liste VIDE quand il n’y a que l’en-tête', () => {
    expect(analyserCsv('nom,telephone\n')).toEqual([])
  })
})

describe('deux écritures d’un numéro désignent le même client', () => {
  it('ramène les formes tunisiennes à la même clé', () => {
    const attendu = '20123456'
    for (const forme of [
      '20123456',
      '20 12 34 56',
      '+216 20 123 456',
      '00216 20123456',
      '216-20-123-456',
    ]) {
      expect(comparerTelephone(forme), forme).toBe(attendu)
    }
  })

  it('ne confond pas deux numéros différents', () => {
    expect(comparerTelephone('20123456')).not.toBe(comparerTelephone('20123457'))
  })

  it('laisse un numéro étranger intact', () => {
    // Retirer « 216 » d'un numéro français commençant par 216… n'arrive pas :
    // l'indicatif n'est retiré que sur un numéro assez long pour en avoir un.
    expect(comparerTelephone('+33 6 12 34 56 78')).toBe('33612345678')
  })

  it('rend une clé VIDE pour un client sans téléphone', () => {
    // Un client de passage dont on n'a que le prénom reste légitime — et deux
    // fiches sans numéro ne sont pas des doublons.
    expect(comparerTelephone('')).toBe('')
    expect(comparerTelephone('   ')).toBe('')
  })
})
