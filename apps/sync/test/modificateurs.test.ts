/**
 * Les MODIFICATEURS descendent-ils jusqu'à la caisse ?
 *
 * ── La panne que ce fichier fige ──────────────────────────────────────────
 *
 * `modifier_groups` et `modifiers` descendent depuis la migration 0005.
 * `product_modifiers` — la table qui dit QUEL groupe s'applique à QUEL produit
 * — est absente de sa liste de déclencheurs. Elle n'a donc jamais rien
 * journalisé.
 *
 * Or la caisse lit ses modificateurs en JOIGNANT cette table. Sans elle, la
 * jointure ne rend rien : sur un terminal appairé, aucun produit n'a jamais
 * proposé le moindre supplément. Personne ne l'avait signalé parce que le jeu
 * de DÉMONSTRATION pose ces lignes localement — la caisse de démonstration
 * montrait « Fromage +1,500 », celle d'un vrai client, rien.
 *
 * ── Pourquoi ce test va jusqu'à SQLite ────────────────────────────────────
 *
 * Vérifier que `change_log` contient une entrée aurait laissé passer la moitié
 * du chemin. Ce qui compte, c'est ce que la caisse AFFICHE — donc on tire la
 * page par `/sync/pull`, on l'applique avec `appliquerMiroir` sur une vraie
 * base locale, et on interroge avec `depotCatalogue.modificateurs()`, la
 * requête que le POS exécute.
 *
 * C'est le seul test du dépôt qui traverse les deux bases. Il le fait parce
 * que la panne vivait exactement entre les deux.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
/*
 * Import RELATIF, et surtout pas une dépendance déclarée.
 *
 * `apps/sync` ne dépend pas de `@kaissi/db-local`, et ne doit pas commencer :
 * le service de synchronisation n'a aucune raison de connaître la base locale
 * d'une tablette, et l'inscrire dans `package.json` permettrait à du code de
 * PRODUCTION de l'importer par mégarde.
 *
 * C'est le même procédé que `rapports-agreges.test.ts`, qui atteint les
 * fonctions pures du back-office de la même façon, et pour la même raison :
 * faire tourner le VRAI code plutôt qu'une troisième copie.
 */
import {
  appliquerMiroir,
  depotCatalogue,
  installerGraine,
  migrer,
  type AdaptateurSqlite,
  type ChangementMiroir,
} from '../../../packages/db-local/src/index.js'
/*
 * L'adaptateur Node n'est PAS dans l'index public de `db-local`, et c'est
 * volontaire : la caisse tourne sur Capacitor, pas sur Node. On l'atteint donc
 * par son chemin, comme le fait `miroir.test.ts`.
 */
import { adaptateurNode } from '../../../packages/db-local/src/adaptateurs/node.js'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

/** Pizza Margherita, et le groupe « Suppléments » du jeu de démonstration. */
const PIZZA = '01930000-0000-7000-8000-000000000200'
const OJJA = '01930000-0000-7000-8000-000000000202'
const GRP_SUPP = '01930000-0000-7000-8000-000000000051'
const GRP_CUISSON = '01930000-0000-7000-8000-000000000050'

let appareil: AppareilTest

beforeAll(async () => {
  await nettoyer()
  appareil = await creerAppareil('MD')
})

afterAll(async () => {
  // La table est partagée : on la remet telle que la 0007 l'a laissée.
  await client.query('delete from kaissi.product_modifiers where product_id = $1', [PIZZA])
  await client.query(
    `insert into kaissi.product_modifiers
       (organization_id, restaurant_id, product_id, modifier_group_id, position)
     values ($1, $2, $3, $4, 1)
     on conflict (product_id, modifier_group_id) do nothing`,
    [DEMO_ORG, DEMO_RESTO, PIZZA, GRP_SUPP],
  )
  await nettoyer()
  await client.end()
  await depot.fermer()
})

/**
 * Tire TOUT le catalogue et l'applique sur une base locale neuve.
 *
 * Neuve et SANS graine : la graine pose déjà les liaisons localement, et un
 * test qui partirait d'elle prouverait seulement qu'elle existe — c'est
 * exactement l'illusion qui a masqué la panne pendant des mois.
 */
async function caisseApresSynchronisation(): Promise<AdaptateurSqlite> {
  const db = adaptateurNode(':memory:')
  await migrer(db)
  // La graine fournit les produits, les groupes et les modificateurs ; on
  // VIDE ensuite les liaisons pour que seule la descente puisse les remettre.
  await installerGraine(db)
  await db.executer('DELETE FROM product_modifiers')

  let depuis = 0
  for (let page = 0; page < 40; page += 1) {
    const reponse = await app.request(
      `http://test/sync/pull?protocolVersion=1&depuisEvenements=0&depuisCatalogue=${depuis}`,
      { headers: { authorization: `Bearer ${appareil.jetonClair}` } },
    )
    expect(reponse.status).toBe(200)
    const corps = (await reponse.json()) as {
      catalogue: ChangementMiroir[]
      curseurCatalogue: number
      encore: boolean
    }
    await appliquerMiroir(db, corps.catalogue)
    depuis = corps.curseurCatalogue
    // `encore` compare aux curseurs de TÊTE : c'est lui qui dit s'il reste
    // des pages, et non une page vide — un catalogue peut rendre zéro ligne
    // et pourtant ne pas être à jour.
    if (!corps.encore) break
  }
  return db
}

/** Rattache un groupe à un produit, comme le fait le back-office. */
async function rattacher(produit: string, groupes: string[]): Promise<void> {
  await client.query('delete from kaissi.product_modifiers where product_id = $1', [produit])
  for (const [i, groupe] of groupes.entries()) {
    await client.query(
      `insert into kaissi.product_modifiers
         (organization_id, restaurant_id, product_id, modifier_group_id, position)
       values ($1, $2, $3, $4, $5)`,
      [DEMO_ORG, DEMO_RESTO, produit, groupe, i + 1],
    )
  }
}

describe('les modificateurs atteignent la caisse', () => {
  it('un produit rattaché propose ses suppléments APRÈS synchronisation', async () => {
    await rattacher(PIZZA, [GRP_SUPP])

    const db = await caisseApresSynchronisation()
    const mods = await depotCatalogue(db).modificateurs(PIZZA)

    expect(
      mods.length,
      'sans la descente de product_modifiers, cette liste est VIDE — ' +
        'et aucun produit ne propose de supplément sur un terminal appairé',
    ).toBeGreaterThan(0)
    expect(mods.map((m) => m.nom)).toContain('Fromage')
    expect(mods.find((m) => m.nom === 'Fromage')?.prixDeltaMillimes).toBe(1500)
    expect(mods.every((m) => m.groupeId === GRP_SUPP)).toBe(true)
  })

  it('DÉTACHER un groupe le retire aussi de la caisse', async () => {
    /*
     * Le sens du retour, qu'une descente ligne à ligne aurait manqué : sans
     * remplacement d'ensemble, le groupe détaché au back-office resterait
     * proposé sur la caisse pour toujours, et le gérant ne comprendrait pas
     * pourquoi le supplément est encore là.
     */
    await rattacher(PIZZA, [GRP_SUPP, GRP_CUISSON])
    expect((await depotCatalogue(await caisseApresSynchronisation()).modificateurs(PIZZA)).length)
      .toBeGreaterThan(4)

    await rattacher(PIZZA, [GRP_CUISSON])
    const mods = await depotCatalogue(await caisseApresSynchronisation()).modificateurs(PIZZA)

    expect(mods.every((m) => m.groupeId === GRP_CUISSON)).toBe(true)
    expect(mods.map((m) => m.nom)).not.toContain('Fromage')
  })

  it('tout détacher laisse le produit SANS modificateur', async () => {
    await rattacher(PIZZA, [])
    const mods = await depotCatalogue(await caisseApresSynchronisation()).modificateurs(PIZZA)
    expect(mods).toEqual([])
  })

  it('le rattachement d’un produit ne touche pas les AUTRES', async () => {
    // L'Ojja porte « Cuisson » depuis la graine. Rattacher la Pizza ne doit
    // rien lui faire : un effacement trop large viderait la carte entière.
    await rattacher(PIZZA, [GRP_SUPP])
    const db = await caisseApresSynchronisation()
    const ojja = await depotCatalogue(db).modificateurs(OJJA)
    expect(ojja.length).toBeGreaterThan(0)
    expect(ojja.every((m) => m.groupeId === GRP_CUISSON)).toBe(true)
  })

  it('la charge utile porte l’ENSEMBLE, jamais une ligne seule', async () => {
    /*
     * La forme du journal, vérifiée directement : `entity_id` est le PRODUIT,
     * et `groupes` la liste complète. C'est ce contrat que `TABLES_MIROIR`
     * suppose — le casser silencieusement ferait appliquer n'importe quoi.
     */
    await rattacher(PIZZA, [GRP_SUPP, GRP_CUISSON])
    const { rows } = await client.query(
      `select entity_id, op, payload from kaissi.change_log
        where entity_type = 'product_modifiers' and entity_id = $1
        order by seq desc limit 1`,
      [PIZZA],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_id).toBe(PIZZA)
    // Toujours `update` : une entrée décrit un ÉTAT, pas une opération.
    expect(rows[0].op).toBe('update')
    const groupes = rows[0].payload.groupes as { modifier_group_id: string }[]
    expect(groupes).toHaveLength(2)
    expect(groupes.map((g) => g.modifier_group_id).sort()).toEqual(
      [GRP_SUPP, GRP_CUISSON].sort(),
    )
  })
})
