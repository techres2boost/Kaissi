import { describe, expect, it } from 'vitest'
import {
  DUREE_MAX_POINTAGE_MIN,
  dureeMinutes,
  etatPointage,
  formaterDuree,
  heuresParEmploye,
  type Pointage,
} from './pointeuse.js'

const p = (id: string, employeId: string, arriveeA: string, sortieA: string | null): Pointage => ({
  id,
  employeId,
  arriveeA,
  sortieA,
})
const MAINTENANT = new Date('2026-10-21T20:00:00Z')

describe('pointeuse', () => {
  it('compte les minutes entières d’un pointage clos', () => {
    expect(dureeMinutes('2026-10-21T10:02:00Z', '2026-10-21T15:31:59Z')).toBe(329)
    expect(formaterDuree(329)).toBe('5 h 29')
  })

  it('une sortie AVANT l’arrivée (horloge reculée) compte zéro, et est signalée', () => {
    const r = p('a', 'karim', '2026-10-21T10:00:00Z', '2026-10-21T09:00:00Z')
    expect(dureeMinutes(r.arriveeA, r.sortieA!)).toBe(0)
    expect(etatPointage(r, MAINTENANT)).toBe('incoherent')
  })

  it('la sortie oubliée n’est PAS additionnée jusqu’à maintenant — elle est à vérifier', () => {
    const oublie = p('a', 'karim', '2026-10-20T10:00:00Z', null)
    expect(etatPointage(oublie, MAINTENANT)).toBe('sortie_oubliee')
    const [k] = heuresParEmploye([oublie], MAINTENANT)
    expect(k).toMatchObject({ minutes: 0, aVerifier: 1, enCours: 0 })
  })

  it('un pointage de moins de 16 h encore ouvert est « en cours »', () => {
    const r = p('a', 'karim', '2026-10-21T12:00:00Z', null)
    expect(etatPointage(r, MAINTENANT)).toBe('en_cours')
    expect(DUREE_MAX_POINTAGE_MIN).toBe(960)
  })

  it('additionne par employé, coupures comprises', () => {
    const heures = heuresParEmploye(
      [
        p('1', 'karim', '2026-10-21T10:00:00Z', '2026-10-21T14:00:00Z'),
        p('2', 'karim', '2026-10-21T18:00:00Z', '2026-10-21T19:30:00Z'),
        p('3', 'salma', '2026-10-21T09:00:00Z', '2026-10-21T12:00:00Z'),
        p('4', 'salma', '2026-10-21T13:00:00Z', null),
      ],
      MAINTENANT,
    )
    expect(heures).toEqual([
      { employeId: 'karim', minutes: 330, pointages: 2, enCours: 0, aVerifier: 0 },
      { employeId: 'salma', minutes: 180, pointages: 2, enCours: 1, aVerifier: 0 },
    ])
  })
})
