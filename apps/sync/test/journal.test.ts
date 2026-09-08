/**
 * Le journal structuré, et surtout ce qu'il refuse d'écrire.
 *
 * Un journal finit chez un hébergeur, dans un agrégateur, parfois collé dans
 * un ticket de support. Un jeton d'appareil qui s'y glisse une seule fois est
 * un jeton à révoquer — et personne ne saura lequel, ni depuis quand.
 *
 * Ces tests protègent donc le masquage avant tout le reste.
 */

import { describe, expect, it } from 'vitest'
import { nettoyer } from '../src/journal.js'

describe('ce qui ne sort JAMAIS d’un journal', () => {
  it('masque un jeton, quel que soit le nom du champ', () => {
    const nettoye = nettoyer({
      jeton: 'kdev_secret',
      token: 'abc',
      deviceToken: 'def',
      authorization: 'Bearer xyz',
      apiKey: 'sb_secret_…',
    }) as Record<string, unknown>
    for (const valeur of Object.values(nettoye)) {
      expect(valeur).toBe('«masqué»')
    }
  })

  it('masque un mot de passe et un hachage de PIN', () => {
    const nettoye = nettoyer({
      motDePasse: 'hunter2',
      password: 'hunter2',
      pin_hash: 'argon2id$…',
      pin: '2468',
    }) as Record<string, unknown>
    expect(Object.values(nettoye).every((v) => v === '«masqué»')).toBe(true)
  })

  it('masque EN PROFONDEUR, pas seulement au premier niveau', () => {
    // Le cas réel : une erreur `pg` qui porte la configuration de connexion,
    // mot de passe compris, trois niveaux plus bas.
    const nettoye = nettoyer({
      requete: { appareil: { libelle: 'Caisse 1', jeton: 'kdev_secret' } },
    }) as { requete: { appareil: { libelle: string; jeton: string } } }
    expect(nettoye.requete.appareil.jeton).toBe('«masqué»')
    // …sans masquer ce qui est utile au diagnostic.
    expect(nettoye.requete.appareil.libelle).toBe('Caisse 1')
  })

  it('laisse passer ce qui sert à chercher', () => {
    const nettoye = nettoyer({
      restaurantId: '01930000-0000-7000-8000-000000000002',
      commandes: 12,
    }) as Record<string, unknown>
    expect(nettoye['restaurantId']).toBe('01930000-0000-7000-8000-000000000002')
    expect(nettoye['commandes']).toBe(12)
  })
})

describe('ce qui pourrait faire tomber le service', () => {
  it('ne boucle pas sur un objet CYCLIQUE', () => {
    /*
     * Une erreur du pilote `pg` porte sa connexion, qui se porte elle-même.
     * Sans borne de profondeur, la journalisation d'une panne ferait tomber
     * le service — et une trace qui tue le processus est pire que la panne
     * qu'elle décrit.
     */
    const boucle: Record<string, unknown> = { nom: 'connexion' }
    boucle['soi'] = boucle
    expect(() => nettoyer(boucle)).not.toThrow()
    expect(JSON.stringify(nettoyer(boucle))).toContain('trop profond')
  })

  it('tronque un tableau immense au lieu de tout écrire', () => {
    // Journaliser dix mille identifiants d'événements produit une ligne
    // illisible et une facture de journalisation.
    const nettoye = nettoyer(Array.from({ length: 500 }, (_, i) => i)) as unknown[]
    expect(nettoye.length).toBeLessThanOrEqual(21)
    expect(String(nettoye[nettoye.length - 1])).toContain('de plus')
  })

  it('conserve message ET pile d’une Error', () => {
    // `JSON.stringify(new Error('x'))` rend `{}` : sans traitement, une
    // erreur journalisée serait une ligne vide.
    const nettoye = nettoyer(new Error('base injoignable')) as {
      message: string
      pile?: string
    }
    expect(nettoye.message).toBe('base injoignable')
    expect(nettoye.pile).toContain('journal.test')
  })
})
