/**
 * Le collecteur d'erreurs de la caisse : petit, dédupliqué, et il survit à
 * un rechargement — c'est le moment où l'erreur compte le plus.
 */

import { describe, expect, it } from 'vitest'
import { CollecteurErreurs } from './collecteur-erreurs.js'

function stockage() {
  const m = new Map<string, string>()
  return { getItem: (c: string) => m.get(c) ?? null, setItem: (c: string, v: string) => void m.set(c, v), m }
}

describe('collecteur d’erreurs', () => {
  it('la même erreur mille fois est UNE entrée avec un compte — nombres effacés de la signature', () => {
    const c = new CollecteurErreurs(stockage(), 'v1')
    for (let i = 0; i < 1000; i += 1) c.noter(new TypeError(`Impossible de lire la ligne ${i}`))
    const lot = c.aEnvoyer(20)
    expect(lot).toHaveLength(1)
    expect(lot[0]).toMatchObject({ nombre: 1000, type: 'erreur', version: 'v1' })
  })

  it('survit à un rechargement (nouveau collecteur, même stockage)', () => {
    const s = stockage()
    new CollecteurErreurs(s, 'v1').noter(new Error('au démarrage'))
    expect(new CollecteurErreurs(s, 'v1').aEnvoyer(20).map((e) => e.message)).toEqual(['Error: au démarrage'])
  })

  it('au plus vingt entrées : les plus anciennes cèdent la place', () => {
    const c = new CollecteurErreurs(stockage(), 'v1')
    for (let i = 0; i < 25; i += 1) c.noter(new Error(`erreur ${'abcdefghijklmnopqrstuvwxyz'[i]}`))
    const lot = c.aEnvoyer(100)
    expect(lot).toHaveLength(20)
    expect(lot[lot.length - 1]!.message).toBe('Error: erreur y')
  })

  it('accuser retranche ce qui est parti — une erreur revenue pendant l’envoi reste', () => {
    const c = new CollecteurErreurs(stockage(), 'v1')
    c.noter(new Error('boucle'))
    c.noter(new Error('boucle'))
    const envoye = c.aEnvoyer(20)
    c.noter(new Error('boucle'))
    c.accuser(envoye)
    expect(c.aEnvoyer(20).map((e) => e.nombre)).toEqual([1])
    c.accuser(c.aEnvoyer(20))
    expect(c.aEnvoyer(20)).toEqual([])
  })

  it('ignore le bruit connu, et tient sans stockage', () => {
    const c = new CollecteurErreurs(null, 'v1')
    c.noter('ResizeObserver loop completed with undelivered notifications.')
    c.noter('')
    expect(c.aEnvoyer(20)).toEqual([])
    c.noter('chaîne levée', { type: 'promesse' })
    expect(c.aEnvoyer(20)[0]).toMatchObject({ type: 'promesse', message: 'chaîne levée' })
  })

  it('un stockage qui refuse d’écrire ne fait pas tomber la caisse', () => {
    const plein = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
    const c = new CollecteurErreurs(plein, 'v1')
    expect(() => c.noter(new Error('x'))).not.toThrow()
  })
})
