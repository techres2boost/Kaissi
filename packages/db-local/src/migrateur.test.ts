import { beforeEach, describe, expect, it } from 'vitest'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import {
  ErreurMigration,
  journalMigrations,
  migrer,
  versionCourante,
} from './migrateur.js'
import { MIGRATIONS, VERSION_SCHEMA_LOCAL, verifierRegistre } from './migrations/index.js'
import { installerGraine, DEMO_RESTO } from './graine.js'
import { depotCatalogue } from './depots/catalogue.js'
import { depotJournal } from './depots/journal.js'
import { depotEtat } from './depots/etat.js'

let db: AdaptateurSqlite

beforeEach(() => {
  db = adaptateurNode(':memory:')
})

describe('registre des migrations', () => {
  it('a des versions contiguës et croissantes', () => {
    expect(() => verifierRegistre()).not.toThrow()
    expect(VERSION_SCHEMA_LOCAL).toBe(MIGRATIONS.length)
  })

  it('refuse un registre à trou — le piège du parc hétérogène', () => {
    expect(() =>
      verifierRegistre([
        { version: 1, nom: 'a', sql: 'SELECT 1' },
        { version: 3, nom: 'c', sql: 'SELECT 1' },
      ]),
    ).toThrow(/contiguës/)
  })

  it('refuse une migration au SQL vide', () => {
    expect(() => verifierRegistre([{ version: 1, nom: 'a', sql: '  ' }])).toThrow(/vide/)
  })
})

describe('migrateur local', () => {
  it('part de la version 0 sur une base neuve', async () => {
    expect(await versionCourante(db)).toBe(0)
  })

  it('applique toutes les migrations et crée le schéma', async () => {
    const r = await migrer(db)
    expect(r.versionAvant).toBe(0)
    expect(r.versionApres).toBe(VERSION_SCHEMA_LOCAL)
    expect(r.appliquees).toHaveLength(MIGRATIONS.length)

    const tables = await db.lire<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    const noms = tables.map((t) => t.name)
    for (const attendue of [
      'products', 'categories', 'tax_rates', 'order_events', 'orders',
      'order_items', 'payments', 'shifts', 'outbox', 'sync_state', 'print_queue',
    ]) {
      expect(noms).toContain(attendue)
    }
  })

  it('EST IDEMPOTENT : un second appel ne réapplique rien', async () => {
    await migrer(db)
    const second = await migrer(db)
    expect(second.appliquees).toHaveLength(0)
    expect(second.versionApres).toBe(VERSION_SCHEMA_LOCAL)
  })

  it('consigne chaque migration appliquée', async () => {
    await migrer(db)
    const journal = await journalMigrations(db)
    expect(journal).toHaveLength(MIGRATIONS.length)
    expect(journal[0]!.nom).toBe('schema_initial')
    expect(journal[0]!.dureeMs).toBeGreaterThanOrEqual(0)
  })

  it('n applique QUE les migrations manquantes', async () => {
    await migrer(db, [MIGRATIONS[0]!])
    const suite = [
      MIGRATIONS[0]!,
      { version: 2, nom: 'ajout_colonne', sql: 'ALTER TABLE products ADD COLUMN allergenes TEXT' },
    ]
    const r = await migrer(db, suite)
    expect(r.versionAvant).toBe(1)
    expect(r.versionApres).toBe(2)
    expect(r.appliquees.map((a) => a.version)).toEqual([2])
  })

  it('ANNULE toute la migration en cas d échec — jamais de schéma à moitié posé', async () => {
    const cassee = [
      MIGRATIONS[0]!,
      {
        version: 2,
        nom: 'cassee',
        sql: `
          CREATE TABLE bonne_table (id TEXT PRIMARY KEY) STRICT;
          CREATE TABLE ceci_n_est_pas_du_sql (( ;
        `,
      },
    ]
    await expect(migrer(db, cassee)).rejects.toThrow(ErreurMigration)
    // La base reste en version 1 et la table partielle n'existe pas.
    expect(await versionCourante(db)).toBe(1)
    const tables = await db.lire<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='bonne_table'",
    )
    expect(tables).toHaveLength(0)
  })

  it('REFUSE de démarrer sur une base plus récente que l application', async () => {
    await migrer(db, [
      MIGRATIONS[0]!,
      { version: 2, nom: 'future', sql: 'CREATE TABLE futur (id TEXT PRIMARY KEY) STRICT' },
    ])
    // L'utilisateur réinstalle une version ancienne de l'application.
    await expect(migrer(db, [MIGRATIONS[0]!])).rejects.toThrow(/Mettez à jour/)
  })

  it('active les clés étrangères', async () => {
    await migrer(db)
    const p = await db.lire<{ foreign_keys: number }>('PRAGMA foreign_keys')
    expect(p[0]?.foreign_keys).toBe(1)
  })
})

describe('immuabilité locale de order_events', () => {
  beforeEach(async () => {
    await migrer(db)
    await db.executer(
      `INSERT INTO order_events
         (event_id, order_id, organization_id, restaurant_id, device_id,
          seq_device, type, payload, client_ts)
       VALUES ('e1', 'o1', 'org', 'resto', 'dev', 1, 'order.opened', '{}', '2026-08-25T19:00:00Z')`,
    )
  })

  it('interdit la modification d un événement', async () => {
    await expect(
      db.executer("UPDATE order_events SET type = 'order.cancelled' WHERE event_id = 'e1'"),
    ).rejects.toThrow(/insertion seule/)
  })

  it('interdit la suppression d un événement', async () => {
    await expect(
      db.executer("DELETE FROM order_events WHERE event_id = 'e1'"),
    ).rejects.toThrow(/insertion seule/)
  })

  it('autorise le marquage du server_seq à la réception du push', async () => {
    // C'est la SEULE modification permise : le serveur attribue son curseur.
    await db.executer("UPDATE order_events SET server_seq = 42 WHERE event_id = 'e1'")
    const l = await db.lireUne<{ server_seq: number }>(
      "SELECT server_seq FROM order_events WHERE event_id = 'e1'",
    )
    expect(l?.server_seq).toBe(42)
  })
})

describe('graine locale — le critère de sortie de la Phase 0', () => {
  beforeEach(async () => {
    await migrer(db)
  })

  it('installe un catalogue complet sans le moindre accès réseau', async () => {
    expect(await installerGraine(db)).toBe(true)
    const catalogue = depotCatalogue(db)
    expect(await catalogue.nombreProduits()).toBe(17)
    expect(await catalogue.categories()).toHaveLength(4)
    expect(await catalogue.tauxTaxes()).toHaveLength(3)
    expect(await catalogue.tables()).toHaveLength(12)
    expect(await catalogue.methodesPaiement()).toHaveLength(3)
  })

  it('EST IDEMPOTENTE : un second appel ne double pas le catalogue', async () => {
    await installerGraine(db)
    expect(await installerGraine(db)).toBe(false)
    expect(await depotCatalogue(db).nombreProduits()).toBe(17)
  })

  it('renseigne l identité locale de l appareil', async () => {
    await installerGraine(db)
    const etat = depotEtat(db)
    expect(await etat.lire('restaurant_id')).toBe(DEMO_RESTO)
    expect(await etat.lire('ticket_prefix')).toBe('P1')
  })

  it('expose des prix en MILLIMES entiers, jamais des flottants', async () => {
    await installerGraine(db)
    const produits = await depotCatalogue(db).produits()
    for (const p of produits) {
      expect(Number.isSafeInteger(p.prixBaseMillimes)).toBe(true)
    }
    const pizza = produits.find((p) => p.nom === 'Pizza Margherita')!
    expect(pizza.prixBaseMillimes).toBe(14500) // 14,500 TND
  })

  it('rend les variantes et modificateurs d un produit', async () => {
    await installerGraine(db)
    const catalogue = depotCatalogue(db)
    const pizza = (await catalogue.produits()).find((p) => p.nom === 'Pizza Margherita')!
    expect(await catalogue.variantes(pizza.id)).toHaveLength(2)
    const mods = await catalogue.modificateurs(pizza.id)
    expect(mods.map((m) => m.nom)).toContain('Fromage')
  })

  it('accepte un delta de prix NÉGATIF sur une variante', async () => {
    await installerGraine(db)
    const catalogue = depotCatalogue(db)
    const frites = (await catalogue.produits()).find((p) => p.nom === 'Frites')!
    const petite = (await catalogue.variantes(frites.id)).find((v) => v.nom === 'Petite')!
    expect(petite.prixDeltaMillimes).toBe(-1500)
  })
})

describe('journal local et outbox', () => {
  beforeEach(async () => {
    await migrer(db)
    await installerGraine(db)
  })

  const evenement = (eventId: string, seq: number) => ({
    eventId,
    orderId: 'cmd-1',
    restaurantId: DEMO_RESTO,
    organizationId: '01930000-0000-7000-8000-000000000001',
    deviceId: '01930000-0000-7000-8000-000000000003',
    seqDevice: seq,
    clientTs: '2026-08-25T19:04:00.000Z',
    serverSeq: null,
    type: 'order.opened' as const,
    payload: { type: 'dine_in' as const, ouvertePar: 'srv-1' },
    acteurId: null,
  })

  it('alloue des séquences locales monotones', async () => {
    const journal = depotJournal(db)
    const a = await journal.prochaineSeq()
    const b = await journal.prochaineSeq()
    expect(b).toBe(a + 1)
  })

  it('écrit l événement ET son entrée d outbox atomiquement', async () => {
    const journal = depotJournal(db)
    await journal.ajouter(evenement('evt-1', 1))
    expect(await journal.journalDe('cmd-1')).toHaveLength(1)
    expect((await journal.lotAPousser()).map((o) => o.eventId)).toEqual(['evt-1'])
  })

  it('EST IDEMPOTENT : le même événement renvoyé cinq fois n entre qu une fois', async () => {
    const journal = depotJournal(db)
    for (let i = 0; i < 5; i += 1) await journal.ajouter(evenement('evt-1', 1))
    expect(await journal.journalDe('cmd-1')).toHaveLength(1)
    expect(await journal.lotAPousser()).toHaveLength(1)
  })

  it('ne vide l outbox que sur ACCUSÉ DE RÉCEPTION', async () => {
    const journal = depotJournal(db)
    await journal.ajouter(evenement('evt-1', 1))
    await journal.ajouter(evenement('evt-2', 2))
    expect((await journal.enAttente()).enAttente).toBe(2)
    await journal.accuserReception(['evt-1'])
    expect((await journal.enAttente()).enAttente).toBe(1)
    // L'événement reste dans le journal local : seule l'outbox se vide.
    expect(await journal.journalDe('cmd-1')).toHaveLength(2)
  })

  it('CONSERVE un rejet et le rend visible au gérant', async () => {
    const journal = depotJournal(db)
    await journal.ajouter(evenement('evt-1', 1))
    await journal.marquerRejet('evt-1', 'commande_close', 'La commande est déjà clôturée.')
    const compteurs = await journal.enAttente()
    expect(compteurs.enAttente).toBe(0)
    expect(compteurs.rejetes).toBe(1)
    // Un rejet ne repart pas tout seul dans le lot suivant.
    expect(await journal.lotAPousser()).toHaveLength(0)
  })

  it('numérote les tickets avec le préfixe de l appareil', async () => {
    const journal = depotJournal(db)
    expect(await journal.prochainNumeroTicket()).toBe('P1-000001')
    expect(await journal.prochainNumeroTicket()).toBe('P1-000002')
  })
})
