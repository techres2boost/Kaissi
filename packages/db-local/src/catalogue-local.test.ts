/**
 * Créer du catalogue DEPUIS la caisse — ce qui est écrit localement.
 *
 * La règle que ces tests figent : chaque création écrit DEUX choses dans la
 * même transaction — l'entité (utilisable à la seconde, même hors ligne) et
 * son entrée d'outbox (qui la fera remonter). L'une sans l'autre est une
 * panne silencieuse : une entité qui n'existe pour personne d'autre, ou une
 * demande pour quelque chose que le caissier n'a pas vu naître.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  millimes,
  uuidV7,
  type MutationCatalogue,
  type MutationModificateurCree,
} from '@kaissi/domain'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import { migrer } from './migrateur.js'
import { depotCatalogue } from './depots/catalogue.js'

const ORG = '01930000-0000-7000-8000-000000000001'
const RESTO = '01930000-0000-7000-8000-000000000002'

let db: AdaptateurSqlite
let catalogue: ReturnType<typeof depotCatalogue>

beforeEach(async () => {
  db = adaptateurNode(':memory:')
  await migrer(db)
  catalogue = depotCatalogue(db)
})

function commun() {
  return {
    mutationId: uuidV7(),
    organizationId: ORG,
    restaurantId: RESTO,
    deviceId: uuidV7(),
    parEmployeId: uuidV7(),
    clientTs: new Date().toISOString(),
    protocolVersion: 1,
  } as const
}

/** L'outbox a-t-elle reçu la demande, avec sa charge utile intacte ? */
async function enOutbox(mutationId: string): Promise<MutationCatalogue | null> {
  const l = await db.lireUne<{ payload: string; kind: string }>(
    'SELECT payload, kind FROM outbox WHERE event_id = ?',
    [mutationId],
  )
  if (!l) return null
  expect(l.kind, 'la demande doit partir par la file CATALOGUE').toBe('catalogue')
  return JSON.parse(l.payload) as MutationCatalogue
}

describe('créer une catégorie', () => {
  it('écrit la catégorie ET son outbox, dans la même transaction', async () => {
    const m: MutationCatalogue = {
      ...commun(),
      type: 'catalogue.categorie.cree',
      categorieId: uuidV7(),
      nom: '  Entrées  ',
      couleur: '#C4562B',
      stationId: null,
    }
    await catalogue.creerCatalogueLocal(m)

    const l = await db.lireUne<{ name: string; color: string; station_id: string | null }>(
      'SELECT name, color, station_id FROM categories WHERE id = ?',
      [m.categorieId],
    )
    // Le nom est ÉLAGUÉ — comme côté serveur, sinon « Entrées » et
    // « Entrées  » feraient deux catégories que personne ne distingue.
    expect(l?.name).toBe('Entrées')
    expect(l?.color).toBe('#C4562B')
    expect(await enOutbox(m.mutationId)).toMatchObject({ type: 'catalogue.categorie.cree' })
  })
})

describe('créer une réduction', () => {
  it('garde les points de base ENTIERS et n’écrit qu’une des deux valeurs', async () => {
    const m: MutationCatalogue = {
      ...commun(),
      type: 'catalogue.reduction.cree',
      reductionId: uuidV7(),
      nom: 'Happy hour',
      kind: 'pourcentage',
      valeurBp: 1000 as never,
      montantMillimes: null,
    }
    await catalogue.creerCatalogueLocal(m)

    const l = await db.lireUne<{ kind: string; value_bp: number; amount_millimes: number | null }>(
      'SELECT kind, value_bp, amount_millimes FROM discounts WHERE id = ?',
      [m.reductionId],
    )
    expect(l?.kind).toBe('pourcentage')
    expect(l?.value_bp).toBe(1000)
    expect(l?.amount_millimes).toBeNull()
    expect(await enOutbox(m.mutationId)).not.toBeNull()
  })
})

describe('créer un groupe de modificateurs', () => {
  const groupe = (produitIds: string[] = []): MutationModificateurCree => ({
    ...commun(),
    type: 'catalogue.modificateur.cree',
    groupeId: uuidV7(),
    nom: 'Cuisson',
    minSelect: 1,
    maxSelect: 1,
    choix: [
      { id: uuidV7(), nom: 'Saignant', prixDeltaMillimes: millimes(0) },
      { id: uuidV7(), nom: 'Petite portion', prixDeltaMillimes: millimes(-1500) },
    ],
    produitIds,
  })

  it('écrit le groupe, ses choix DANS L’ORDRE, et déduit « obligatoire » du minimum', async () => {
    const m = groupe()
    await catalogue.creerCatalogueLocal(m)

    const g = await db.lireUne<{ min_select: number; is_required: number }>(
      'SELECT min_select, is_required FROM modifier_groups WHERE id = ?',
      [m.groupeId],
    )
    expect(g?.min_select).toBe(1)
    expect(g?.is_required).toBe(1)

    const choix = await db.lire<{ name: string; price_delta_millimes: number }>(
      'SELECT name, price_delta_millimes FROM modifiers WHERE modifier_group_id = ? ORDER BY position',
      [m.groupeId],
    )
    expect(choix.map((c) => c.name)).toEqual(['Saignant', 'Petite portion'])
    // Un supplément NÉGATIF est légitime : la petite portion coûte moins.
    expect(choix[1]!.price_delta_millimes).toBe(-1500)
  })

  it('rattache le groupe aux produits demandés', async () => {
    const produitId = uuidV7()
    const m = groupe([produitId])
    await catalogue.creerCatalogueLocal(m)

    const lien = await db.lireUne<{ n: number }>(
      'SELECT count(*) AS n FROM product_modifiers WHERE product_id = ? AND modifier_group_id = ?',
      [produitId, m.groupeId],
    )
    expect(lien?.n).toBe(1)
  })
})

describe('idempotence locale', () => {
  it('rejouer la MÊME mutation ne double rien — ni l’entité, ni l’outbox', async () => {
    const m: MutationCatalogue = {
      ...commun(),
      type: 'catalogue.categorie.cree',
      categorieId: uuidV7(),
      nom: 'Boissons',
      couleur: null,
      stationId: null,
    }
    await catalogue.creerCatalogueLocal(m)
    await catalogue.creerCatalogueLocal(m)

    const cat = await db.lireUne<{ n: number }>('SELECT count(*) AS n FROM categories WHERE id = ?', [
      m.categorieId,
    ])
    const out = await db.lireUne<{ n: number }>('SELECT count(*) AS n FROM outbox WHERE event_id = ?', [
      m.mutationId,
    ])
    expect(cat?.n).toBe(1)
    expect(out?.n).toBe(1)
  })
})
