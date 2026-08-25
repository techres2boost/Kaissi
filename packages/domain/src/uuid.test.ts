import { describe, expect, it } from 'vitest'
import { estUuid, estUuidV7, horodatageDeUuidV7, uuidV7 } from './uuid.js'

describe('UUIDv7 généré côté client', () => {
  it('produit un UUID canonique de version 7', () => {
    const id = uuidV7()
    expect(estUuid(id)).toBe(true)
    expect(estUuidV7(id)).toBe(true)
    expect(id).toHaveLength(36)
  })

  it('encode la variante RFC 4122', () => {
    for (let i = 0; i < 200; i += 1) {
      const variante = Number.parseInt(uuidV7()[19]!, 16)
      expect(variante & 0b1100).toBe(0b1000)
    }
  })

  it('est TRIABLE par le temps — la propriété qui évite la fragmentation d index', () => {
    const ids = Array.from({ length: 500 }, () => uuidV7())
    expect([...ids].sort()).toEqual(ids)
  })

  it('reste monotone même généré en rafale dans la même milliseconde', () => {
    const ids: string[] = []
    const debut = Date.now()
    while (Date.now() === debut && ids.length < 300) ids.push(uuidV7())
    if (ids.length > 1) expect([...ids].sort()).toEqual(ids)
  })

  it('ne produit pas de collision sur un gros lot', () => {
    const ids = new Set(Array.from({ length: 20000 }, () => uuidV7()))
    expect(ids.size).toBe(20000)
  })

  it('permet de relire l horodatage de création', () => {
    const avant = Date.now()
    const id = uuidV7()
    const apres = Date.now()
    const ts = horodatageDeUuidV7(id)
    expect(ts).toBeGreaterThanOrEqual(avant)
    expect(ts).toBeLessThanOrEqual(apres)
  })

  it('rejette une chaîne qui n est pas un UUIDv7', () => {
    expect(estUuidV7('pas-un-uuid')).toBe(false)
    expect(estUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false) // v4
    expect(() => horodatageDeUuidV7('pas-un-uuid')).toThrow()
  })
})
