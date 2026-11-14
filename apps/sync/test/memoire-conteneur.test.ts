/**
 * L'alerte mémoire se rapporte à la LIMITE du conteneur, jamais à un seuil
 * inventé : 900 Mo est confortable sur 8 Go et mortel sur 1 Go.
 */

import { describe, expect, it } from 'vitest'
import { alerteMemoire, limiteMemoireConteneur } from '../src/supervision.js'

const Mo = 1024 * 1024

describe('limite mémoire du conteneur', () => {
  const fichiers = (contenus: Record<string, string>) => (chemin: string) => contenus[chemin] ?? null

  it('lit cgroup v2, puis v1', () => {
    expect(limiteMemoireConteneur({}, fichiers({ '/sys/fs/cgroup/memory.max': '2147483648\n' }))).toBe(2048 * Mo)
    expect(
      limiteMemoireConteneur({}, fichiers({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': '1073741824' })),
    ).toBe(1024 * Mo)
  })

  it('« max » et la valeur géante du v1 ne sont PAS des limites', () => {
    expect(limiteMemoireConteneur({}, fichiers({ '/sys/fs/cgroup/memory.max': 'max' }))).toBeNull()
    expect(
      limiteMemoireConteneur({}, fichiers({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712' })),
    ).toBeNull()
    expect(limiteMemoireConteneur({}, fichiers({}))).toBeNull()
  })

  it('SYNC_MEMOIRE_LIMITE_MO l’emporte, quand l’hébergeur ne dit rien', () => {
    expect(limiteMemoireConteneur({ SYNC_MEMOIRE_LIMITE_MO: '2048' }, fichiers({}))).toBe(2048 * Mo)
    expect(limiteMemoireConteneur({ SYNC_MEMOIRE_LIMITE_MO: 'beaucoup' }, fichiers({}))).toBeNull()
  })
})

describe('alerte mémoire', () => {
  it('rien sous 70 %, attention à 70 %, critique à 85 %', () => {
    expect(alerteMemoire(600 * Mo, 1024 * Mo)).toBeNull()
    expect(alerteMemoire(750 * Mo, 1024 * Mo)?.niveau).toBe('attention')
    const critique = alerteMemoire(900 * Mo, 1024 * Mo)
    expect(critique?.niveau).toBe('critique')
    expect(critique?.cle).toBe('processus.memoire')
    expect(critique?.message).toContain('900 Mo sur 1024 Mo')
  })

  it('sans limite connue, aucune alerte — un seuil inventé sonnerait faux', () => {
    expect(alerteMemoire(5000 * Mo, null)).toBeNull()
  })
})
