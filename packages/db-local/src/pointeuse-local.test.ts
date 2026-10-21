import { beforeEach, describe, expect, it } from 'vitest'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import { migrer } from './migrateur.js'
import { depotPointeuse } from './depots/pointeuse.js'

let db: AdaptateurSqlite

beforeEach(async () => {
  db = adaptateurNode(':memory:')
  await migrer(db)
})

const arrivee = (id: string) => ({
  id,
  organizationId: 'org',
  restaurantId: 'resto',
  deviceId: 'caisse-1',
  employeId: 'karim',
  arriveeA: '2026-10-21T10:00:00.000Z',
})

describe('pointeuse locale', () => {
  it('pointe l’arrivée, puis la sortie, et la ligne repart vers le serveur', async () => {
    const pointeuse = depotPointeuse(db)
    await pointeuse.pointerArrivee(arrivee('p1'))
    expect((await pointeuse.ouvertDe('karim'))?.id).toBe('p1')

    await pointeuse.marquerPousses(await pointeuse.aPousser())
    expect(await pointeuse.aPousser()).toEqual([])

    await pointeuse.pointerSortie('p1', '2026-10-21T15:00:00.000Z')
    expect(await pointeuse.ouvertDe('karim')).toBeNull()
    expect((await pointeuse.aPousser())[0]?.sortieA).toBe('2026-10-21T15:00:00.000Z')
  })

  it('une sortie pointée PENDANT l’envoi de l’arrivée n’est pas marquée partie', async () => {
    const pointeuse = depotPointeuse(db)
    await pointeuse.pointerArrivee(arrivee('p1'))
    const envoye = await pointeuse.aPousser()
    // La sortie arrive avant l'accusé de l'arrivée.
    await pointeuse.pointerSortie('p1', '2026-10-21T15:00:00.000Z')
    await pointeuse.marquerPousses(envoye)
    const reste = await pointeuse.aPousser()
    expect(reste).toHaveLength(1)
    expect(reste[0]?.sortieA).toBe('2026-10-21T15:00:00.000Z')
  })
})
