import { describe, expect, it } from 'vitest'
import {
  calculerHashAudit,
  HASH_GENESE,
  serialiserAudit,
  verifierChaine,
  type EntreeAudit,
  type LigneAudit,
} from './audit.js'

function entree(n: number): EntreeAudit {
  return {
    id: `audit-${n}`,
    organizationId: 'org-1',
    restaurantId: 'resto-1',
    acteurUserId: 'user-1',
    deviceId: 'device-1',
    action: 'remise.appliquee',
    entityType: 'order',
    entityId: `cmd-${n}`,
    createdAt: `2026-08-25T19:0${n}:00+00:00`,
  }
}

async function construireChaine(taille: number): Promise<LigneAudit[]> {
  const lignes: LigneAudit[] = []
  let prev = HASH_GENESE
  for (let i = 0; i < taille; i += 1) {
    const e = entree(i)
    const hash = await calculerHashAudit(e, prev)
    lignes.push({ ...e, prevHash: prev, hash })
    prev = hash
  }
  return lignes
}

describe("chaînage par hash du journal d'audit", () => {
  it('sérialise de façon canonique et déterministe', () => {
    const s = serialiserAudit(entree(1), HASH_GENESE)
    expect(s).toBe(
      `${HASH_GENESE}|audit-1|org-1|resto-1|user-1|device-1|remise.appliquee|order|cmd-1|2026-08-25T19:01:00+00:00`,
    )
    expect(serialiserAudit(entree(1), HASH_GENESE)).toBe(s)
  })

  it('rend les valeurs nulles par une chaîne vide (miroir du SQL)', () => {
    const s = serialiserAudit(
      { ...entree(1), restaurantId: null, acteurUserId: null, deviceId: null, entityId: null },
      HASH_GENESE,
    )
    expect(s).toBe(`${HASH_GENESE}|audit-1|org-1||||remise.appliquee|order||2026-08-25T19:01:00+00:00`)
  })

  it('valide une chaîne intègre', async () => {
    const chaine = await construireChaine(20)
    const r = await verifierChaine(chaine)
    expect(r.valide).toBe(true)
    expect(r.indexRupture).toBe(-1)
  })

  it('DÉTECTE une ligne modifiée en base', async () => {
    const chaine = await construireChaine(10)
    const falsifiee = [...chaine]
    falsifiee[4] = { ...falsifiee[4]!, action: 'remise.effacee_discretement' }
    const r = await verifierChaine(falsifiee)
    expect(r.valide).toBe(false)
    expect(r.indexRupture).toBe(4)
    expect(r.message).toMatch(/altérée/)
  })

  it('DÉTECTE une ligne supprimée en base', async () => {
    const chaine = await construireChaine(10)
    const amputee = [...chaine.slice(0, 4), ...chaine.slice(5)]
    const r = await verifierChaine(amputee)
    expect(r.valide).toBe(false)
    expect(r.indexRupture).toBe(4)
    expect(r.message).toMatch(/rompue/)
  })

  it('DÉTECTE une ligne insérée frauduleusement', async () => {
    const chaine = await construireChaine(10)
    const gonflee = [...chaine.slice(0, 5), chaine[9]!, ...chaine.slice(5)]
    const r = await verifierChaine(gonflee)
    expect(r.valide).toBe(false)
  })

  it('valide une chaîne vide', async () => {
    const r = await verifierChaine([])
    expect(r.valide).toBe(true)
  })
})
