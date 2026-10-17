/**
 * Régression iPhone : « CreateConnection: Connection kaissi already exists »,
 * à chaque changement de langue et à la fin d'une inscription.
 *
 * ── Pourquoi ce double est fidèle ───────────────────────────────────────
 * Il porte les deux registres du greffon (@capacitor-community/sqlite 7) :
 *
 *   • `NatifDouble` — `CapacitorSQLite.swift` : `createConnection` refuse un
 *     nom déjà présent dans `dbDict` (« Connection … already exists ») ;
 *     `checkConnectionsConsistency` ferme TOUT si le JavaScript n'annonce
 *     aucune connexion, et rend vrai si les deux listes concordent.
 *   • `GestionnaireDouble` — `SQLiteConnection` (dist/esm) : un
 *     `_connectionDict` en mémoire JavaScript, qu'un rechargement de la page
 *     remet à zéro. `isConnection` ne lit que lui.
 *
 * « Recharger la page », c'est donc : un NOUVEAU gestionnaire, le MÊME natif.
 */

import { describe, expect, it } from 'vitest'
import { obtenirConnexionCapacitor, type GestionnaireConnexions } from './capacitor.js'

class NatifDouble {
  readonly ouvertes = new Set<string>()
  creer(base: string) {
    const cle = `RW_${base}`
    if (this.ouvertes.has(cle)) throw new Error(`CreateConnection: Connection ${base} already exists`)
    this.ouvertes.add(cle)
  }
  coherence(connues: string[]): boolean {
    if (connues.length === 0 || this.ouvertes.size < connues.length) {
      this.ouvertes.clear()
      return false
    }
    for (const cle of [...this.ouvertes]) if (!connues.includes(cle)) this.ouvertes.delete(cle)
    const ok = connues.every((c) => this.ouvertes.has(c))
    if (!ok) this.ouvertes.clear()
    return ok
  }
}

class GestionnaireDouble implements GestionnaireConnexions<string> {
  private dict = new Map<string, string>()
  constructor(private readonly natif: NatifDouble) {}
  async checkConnectionsConsistency() {
    const result = this.natif.coherence([...this.dict.keys()])
    if (!result) this.dict = new Map()
    return { result }
  }
  async isConnection(base: string) {
    return { result: this.dict.has(`RW_${base}`) }
  }
  async retrieveConnection(base: string) {
    const c = this.dict.get(`RW_${base}`)
    if (!c) throw new Error(`Connection ${base} does not exist`)
    return c
  }
  async createConnection(base: string) {
    this.natif.creer(base)
    const c = `connexion:${base}`
    this.dict.set(`RW_${base}`, c)
    return c
  }
}

/** L'ancienne ouverture : ne consultait que le registre JavaScript. */
async function ancienneOuverture(g: GestionnaireConnexions<string>, base: string) {
  return (await g.isConnection(base, false)).result
    ? g.retrieveConnection(base, false)
    : g.createConnection(base, false, 'no-encryption', 1, false)
}

describe('ouvrir la base après un rechargement de la page', () => {
  it('le double reproduit la panne de l’iPhone', async () => {
    const natif = new NatifDouble()
    await ancienneOuverture(new GestionnaireDouble(natif), 'kaissi')
    // Changement de langue : la page recharge, le natif reste.
    await expect(ancienneOuverture(new GestionnaireDouble(natif), 'kaissi')).rejects.toThrow(
      'Connection kaissi already exists',
    )
  })

  it('rouvre la base, rechargement après rechargement', async () => {
    const natif = new NatifDouble()
    for (let i = 0; i < 3; i++) {
      await expect(obtenirConnexionCapacitor(new GestionnaireDouble(natif), 'kaissi')).resolves.toBe(
        'connexion:kaissi',
      )
    }
    expect(natif.ouvertes.size).toBe(1)
  })

  it('dans la même page, rend la connexion déjà ouverte', async () => {
    const natif = new NatifDouble()
    const g = new GestionnaireDouble(natif)
    const a = await obtenirConnexionCapacitor(g, 'kaissi')
    const b = await obtenirConnexionCapacitor(g, 'kaissi')
    expect(b).toBe(a)
    expect(natif.ouvertes.size).toBe(1)
  })
})
