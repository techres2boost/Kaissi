/**
 * Créer un article DEPUIS la caisse (migration 0034), de bout en bout.
 *
 * ── Ce que ces tests protègent, et pourquoi ça valait une exception ───────
 *
 * La 0003 posait « un APPAREIL ne modifie JAMAIS le référentiel ». On en
 * ouvre exactement un point : l'INSERTION dans `products`. Tout le reste
 * reste fermé, et ces tests le vérifient plutôt que de le promettre.
 *
 * Trois propriétés tiennent l'ensemble :
 *
 *   1. le RÔLE décide, et il est relu EN BASE. L'appareil déclare qui
 *      demande ; le serveur ne le croit pas. Un caissier dont la tablette
 *      enverrait la bonne requête reste refusé ;
 *   2. l'article accepté REDESCEND par `change_log`, sans voie nouvelle —
 *      exactement comme un changement de prix ;
 *   3. l'idempotence (règle 5) : la même mutation renvoyée deux fois crée UN
 *      article. C'est le cas normal d'un réseau qui coupe après l'envoi.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  millimes,
  uuidV7,
  type MutationCatalogue,
  type MutationProduitCree,
} from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ev,
  GERANT_DEMO,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

let appareil: AppareilTest

/**
 * Purge CHIRURGICALE — seulement ce que CE fichier a créé.
 *
 * La base de test est partagée entre les fichiers. Une purge par
 * `entity_type` effacerait les entrées `change_log` du jeu de
 * DÉMONSTRATION, dont `modificateurs.test.ts` et la pagination de
 * `sync.test.ts` dépendent : deux tests tombaient, loin d'ici, pour une
 * raison invisible depuis leur propre fichier. On ne cible donc que les
 * identifiants portant un nom « TEST % ».
 */
async function purger() {
  const testIds = `
    select id from kaissi.products where name like 'TEST %'
    union all select id from kaissi.categories where name like 'TEST %'
    union all select id from kaissi.discounts where name like 'TEST %'
    union all select id from kaissi.modifier_groups where name like 'TEST %'
    union all select m.id from kaissi.modifiers m
             join kaissi.modifier_groups g on g.id = m.modifier_group_id
            where g.name like 'TEST %'`
  await client.query(`delete from kaissi.change_log where entity_id in (${testIds})`)
  await client.query(
    "delete from kaissi.product_modifiers where modifier_group_id in (select id from kaissi.modifier_groups where name like 'TEST %')",
  )
  await client.query(
    "delete from kaissi.modifiers where modifier_group_id in (select id from kaissi.modifier_groups where name like 'TEST %')",
  )
  await client.query("delete from kaissi.modifier_groups where name like 'TEST %'")
  await client.query("delete from kaissi.products where name like 'TEST %'")
  await client.query("delete from kaissi.categories where name like 'TEST %'")
  await client.query("delete from kaissi.discounts where name like 'TEST %'")
  await client.query("delete from kaissi.sync_mutations where kind = 'catalogue'")
}

beforeEach(async () => {
  await nettoyer()
  await purger()
  appareil = await creerAppareil('CAT')
})

afterAll(async () => {
  await purger()
  await depot.fermer()
  await client.end()
})

/** Une mutation bien formée, dont on ne change qu'un champ à la fois. */
function mutation(surcharges: Partial<MutationProduitCree> = {}): MutationProduitCree {
  return {
    mutationId: uuidV7(),
    type: 'catalogue.produit.cree',
    organizationId: DEMO_ORG,
    restaurantId: DEMO_RESTO,
    deviceId: appareil.id,
    parEmployeId: GERANT_DEMO,
    produitId: uuidV7(),
    nom: 'TEST Ojja merguez',
    categorieId: null,
    tauxTvaId: TVA_19,
    prixBaseMillimes: millimes(13_500),
    clientTs: new Date().toISOString(),
    protocolVersion: 1,
    ...surcharges,
  }
}

async function envoyer(mutations: readonly MutationCatalogue[]) {
  const reponse = await app.request('/sync/catalogue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${appareil.jetonClair}`,
    },
    body: JSON.stringify({ protocolVersion: 1, mutations }),
  })
  return {
    statut: reponse.status,
    corps: (await reponse.json()) as {
      acceptes: string[]
      rejetes: { eventId: string; code: string; message: string }[]
    },
  }
}

describe('un gérant crée un article depuis la caisse', () => {
  it('l’article existe en base, avec son prix en MILLIMES', async () => {
    const m = mutation()
    const { corps } = await envoyer([m])

    expect(corps.rejetes).toEqual([])
    expect(corps.acceptes).toEqual([m.mutationId])

    const { rows } = await client.query<{
      name: string
      base_price_millimes: string
      restaurant_id: string
      is_available: boolean
    }>(
      'select name, base_price_millimes, restaurant_id, is_available from kaissi.products where id = $1',
      [m.produitId],
    )
    expect(rows).toHaveLength(1)
    // 13,500 TND = 13500 millimes. Un « ×100 » écrit à la main quelque part
    // sur le chemin vendrait le plat à 1,350 TND, et cela ne se verrait qu'au
    // dépouillement de caisse.
    expect(Number(rows[0]!.base_price_millimes)).toBe(13_500)
    expect(rows[0]!.restaurant_id).toBe(DEMO_RESTO)
    // Vendable tout de suite : le gérant l'a créé pour ce service-ci.
    expect(rows[0]!.is_available).toBe(true)
  })

  it('il REDESCEND par change_log — aucune voie nouvelle', async () => {
    /*
     * C'est le point qui rend l'exception tenable. Le déclencheur
     * `products_change_log` existe depuis la 0005 : un article créé par une
     * caisse se propage aux AUTRES caisses exactement comme un prix modifié
     * au back-office. Sans cette ligne, l'article n'existerait que sur la
     * tablette qui l'a créé et sur le serveur — jamais chez les voisines.
     */
    const m = mutation()
    await envoyer([m])

    const { rows } = await client.query<{ op: string; entity_id: string }>(
      `select op, entity_id from kaissi.change_log
       where entity_type = 'products' and entity_id = $1`,
      [m.produitId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.op).toBe('insert')
  })

  it('la MÊME mutation deux fois ne crée qu’UN article', async () => {
    // Le cas normal d'un réseau qui coupe juste après l'envoi : la caisse n'a
    // pas reçu l'accusé, elle renvoie. Sans idempotence, le gérant
    // retrouverait deux « Ojja » dans sa carte à chaque coupure.
    const m = mutation()
    const premier = await envoyer([m])
    const second = await envoyer([m])

    expect(premier.corps.acceptes).toEqual([m.mutationId])
    // Accepté AUSSI la seconde fois : sinon l'outbox ne se viderait jamais.
    expect(second.corps.acceptes).toEqual([m.mutationId])
    expect(second.corps.rejetes).toEqual([])

    const { rows } = await client.query('select id from kaissi.products where id = $1', [
      m.produitId,
    ])
    expect(rows).toHaveLength(1)
  })
})

describe('le rôle est relu EN BASE, jamais cru sur parole', () => {
  it('REFUSE un caissier, même avec une requête parfaite', async () => {
    /*
     * C'est LA garde. Le PIN trace, il ne protège pas — et une tablette
     * volée porte un jeton d'appareil valide. Seul ce contrôle-ci empêche
     * qu'on ajoute « Pizza à 0,100 TND » à la carte d'un restaurant.
     */
    const m = mutation({ parEmployeId: EMPLOYE_DEMO })
    const { corps } = await envoyer([m])

    expect(corps.acceptes).toEqual([])
    expect(corps.rejetes).toHaveLength(1)
    expect(corps.rejetes[0]!.code).toBe('droits_insuffisants')
    // Le message est LU par le gérant dans l'écran de synchronisation : il
    // doit nommer le rôle, pas dire « refusé ».
    expect(corps.rejetes[0]!.message).toContain('caissier')

    const { rows } = await client.query('select id from kaissi.products where id = $1', [
      m.produitId,
    ])
    expect(rows).toHaveLength(0)
  })

  it('REFUSE un employé qui n’appartient plus à l’établissement', async () => {
    const m = mutation({ parEmployeId: uuidV7() })
    const { corps } = await envoyer([m])

    expect(corps.rejetes[0]!.code).toBe('droits_insuffisants')
    expect(corps.rejetes[0]!.message).toContain('n’appartient plus')
  })

  it('consigne le rejet — il remonte au gérant, il ne s’évapore pas', async () => {
    const m = mutation({ parEmployeId: EMPLOYE_DEMO })
    await envoyer([m])

    const { rows } = await client.query<{ status: string; reject_code: string; kind: string }>(
      'select status, reject_code, kind from kaissi.sync_mutations where event_id = $1',
      [m.mutationId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('rejete')
    expect(rows[0]!.reject_code).toBe('droits_insuffisants')
    // La colonne `kind` (0034) : sans elle, un rejet de catalogue et un rejet
    // de vente se ressemblent trait pour trait là où le support va chercher.
    expect(rows[0]!.kind).toBe('catalogue')
  })
})

describe('la validation de forme est CELLE du domaine', () => {
  it('refuse un prix négatif et un nom vide, sans rien écrire', async () => {
    const a = mutation({ prixBaseMillimes: millimes(-1) })
    const b = mutation({ nom: '   ' })
    const { corps } = await envoyer([a, b])

    expect(corps.acceptes).toEqual([])
    expect(corps.rejetes.map((r) => r.code)).toEqual([
      'requete_invalide',
      'requete_invalide',
    ])
  })

  it('accepte et refuse DANS LE MÊME LOT, sans tout perdre', async () => {
    /*
     * Un lot mixte est le cas réel d'une caisse restée hors ligne : trois
     * plats du jour créés par le gérant, un quatrième par le serveur de
     * salle. Rejeter le lot entier ferait disparaître les trois bons.
     */
    const bon = mutation()
    const mauvais = mutation({ parEmployeId: EMPLOYE_DEMO })
    const { corps } = await envoyer([bon, mauvais])

    expect(corps.acceptes).toEqual([bon.mutationId])
    expect(corps.rejetes.map((r) => r.eventId)).toEqual([mauvais.mutationId])

    const { rows } = await client.query('select id from kaissi.products where id = any($1::uuid[])', [
      [bon.produitId, mauvais.produitId],
    ])
    expect(rows).toHaveLength(1)
  })
})

describe('ce que l’exception NE ouvre PAS', () => {
  it('un appareil ne peut PAS modifier un article existant', async () => {
    /*
     * La politique `products_creation_caisse` est `for insert` sans `using` :
     * aucune ligne existante ne lui est atteignable. Et le privilège `update`
     * n'a pas été accordé — deux serrures, dont une qui tient même si la
     * politique était réécrite.
     *
     * Ce test parle SQL directement, sous le rôle de l'appareil, parce que
     * c'est la seule façon de prouver la serrure elle-même : le service, lui,
     * n'expose aucune route de modification.
     */
    const m = mutation()
    await envoyer([m])

    const sous = new Client({ connectionString: URL_TEST })
    await sous.connect()
    try {
      await sous.query('begin')
      await sous.query('set local role kaissi_device')
      await sous.query('select set_config($1, $2, true)', ['kaissi.device_id', appareil.id])
      await sous.query('select set_config($1, $2, true)', ['kaissi.restaurant_id', DEMO_RESTO])
      await sous.query('select set_config($1, $2, true)', ['kaissi.organization_id', DEMO_ORG])

      await expect(
        sous.query('update kaissi.products set base_price_millimes = 1 where id = $1', [
          m.produitId,
        ]),
      ).rejects.toThrow()
    } finally {
      await sous.query('rollback').catch(() => undefined)
      await sous.end()
    }

    const { rows } = await client.query<{ base_price_millimes: string }>(
      'select base_price_millimes from kaissi.products where id = $1',
      [m.produitId],
    )
    expect(Number(rows[0]!.base_price_millimes)).toBe(13_500)
  })
})

describe('un article VENDU avant que sa création ne remonte', () => {
  /*
   * L'ordre de l'outbox est une décision : les ventes d'abord, le catalogue
   * en dernier. Un plat du jour créé et vendu hors ligne arrive donc au
   * serveur APRÈS sa propre vente.
   *
   * Avant l'arbitrage des références, cette vente faisait échouer la
   * projection (clé étrangère sur `product_id`), le push répondait 500, et le
   * cycle s'arrêtait AVANT d'envoyer la création — qui seule l'aurait
   * débloquée. Une étreinte fatale : plus rien ne remontait jamais.
   */
  it('la vente passe, puis retrouve son produit quand la création arrive', async () => {
    const m = mutation()
    const orderId = uuidV7()
    const ligneId = uuidV7()

    const push = await app.request('/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${appareil.jetonClair}`,
      },
      body: JSON.stringify({
        batchId: uuidV7(),
        protocolVersion: 1,
        evenements: [
          ev(appareil, orderId, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO }),
          ev(appareil, orderId, 'line.added', {
            ligneId,
            produitId: m.produitId,
            designation: m.nom,
            quantite: 2,
            prixBaseMillimes: m.prixBaseMillimes,
            modificateursMillimes: millimes(0),
            tauxTaxeId: TVA_19,
          }),
          ev(appareil, orderId, 'order.closed', { totalMillimes: millimes(27_000), closePar: EMPLOYE_DEMO }),
        ],
      }),
    })
    expect(push.status).toBe(200)

    const avant = await client.query<{ product_id: string | null }>(
      'select product_id from kaissi.order_items where id = $1',
      [ligneId],
    )
    expect(avant.rows[0]!.product_id, 'le produit n’existe pas encore côté serveur').toBeNull()

    const { corps } = await envoyer([m])
    expect(corps.acceptes).toEqual([m.mutationId])

    /*
     * Sans la reprojection, la ligne resterait sans produit POUR TOUJOURS :
     * une commande close ne reçoit plus d'événement. Ni décrément de stock,
     * ni coût dans la marge.
     */
    const apres = await client.query<{ product_id: string | null }>(
      'select product_id from kaissi.order_items where id = $1',
      [ligneId],
    )
    expect(apres.rows[0]!.product_id).toBe(m.produitId)

    const { rows } = await client.query<{ exceptions: { colonne?: string }[] }>(
      'select exceptions from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows[0]!.exceptions.map((e) => e.colonne)).not.toContain('order_items.product_id')
  })
})

// ── Les autres entités du catalogue, créées depuis la caisse (0044) ─────────

/** Le socle commun à toute mutation — seul le type et ses champs changent. */
function commun() {
  return {
    mutationId: uuidV7(),
    organizationId: DEMO_ORG,
    restaurantId: DEMO_RESTO,
    deviceId: appareil.id,
    parEmployeId: GERANT_DEMO,
    clientTs: new Date().toISOString(),
    protocolVersion: 1,
  } as const
}

describe('un gérant crée une CATÉGORIE depuis la caisse', () => {
  it('la catégorie existe, avec sa couleur et son poste', async () => {
    const categorieId = uuidV7()
    const { corps } = await envoyer([
      {
        ...commun(),
        type: 'catalogue.categorie.cree',
        categorieId,
        nom: 'TEST Entrées',
        couleur: '#C4562B',
        stationId: null,
      },
    ])
    expect(corps.rejetes).toEqual([])

    const { rows } = await client.query<{ name: string; color: string; restaurant_id: string }>(
      'select name, color, restaurant_id from kaissi.categories where id = $1',
      [categorieId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('TEST Entrées')
    expect(rows[0]!.color).toBe('#C4562B')
    expect(rows[0]!.restaurant_id).toBe(DEMO_RESTO)
  })

  it('redescend par change_log — aucune voie de synchronisation nouvelle', async () => {
    const categorieId = uuidV7()
    await envoyer([
      { ...commun(), type: 'catalogue.categorie.cree', categorieId, nom: 'TEST Desserts', couleur: null, stationId: null },
    ])
    const { rows } = await client.query(
      "select 1 from kaissi.change_log where entity_type = 'categories' and entity_id = $1",
      [categorieId],
    )
    expect(rows).toHaveLength(1)
  })
})

describe('un gérant crée une RÉDUCTION depuis la caisse', () => {
  it('un pourcentage est écrit en points de base ENTIERS', async () => {
    const reductionId = uuidV7()
    const { corps } = await envoyer([
      {
        ...commun(),
        type: 'catalogue.reduction.cree',
        reductionId,
        nom: 'TEST Happy hour',
        kind: 'pourcentage',
        valeurBp: 1500 as never,
        montantMillimes: null,
      },
    ])
    expect(corps.rejetes).toEqual([])

    const { rows } = await client.query<{ kind: string; value_bp: number; amount_millimes: string | null }>(
      'select kind, value_bp, amount_millimes from kaissi.discounts where id = $1',
      [reductionId],
    )
    expect(rows[0]!.kind).toBe('pourcentage')
    expect(rows[0]!.value_bp).toBe(1500)
    expect(rows[0]!.amount_millimes).toBeNull()
  })

  it('un montant fixe est écrit en MILLIMES, et jamais les deux valeurs', async () => {
    const reductionId = uuidV7()
    await envoyer([
      {
        ...commun(),
        type: 'catalogue.reduction.cree',
        reductionId,
        nom: 'TEST Geste',
        kind: 'montant',
        valeurBp: null,
        montantMillimes: millimes(2000),
      },
    ])
    const { rows } = await client.query<{ value_bp: number | null; amount_millimes: string }>(
      'select value_bp, amount_millimes from kaissi.discounts where id = $1',
      [reductionId],
    )
    expect(rows[0]!.value_bp).toBeNull()
    expect(Number(rows[0]!.amount_millimes)).toBe(2000)
  })
})

describe('un gérant crée un GROUPE DE MODIFICATEURS depuis la caisse', () => {
  it('le groupe, ses choix et son rattachement au produit', async () => {
    const groupeId = uuidV7()
    const choixA = uuidV7()
    const choixB = uuidV7()
    /*
     * Un produit À NOUS, et pas la pizza de démonstration : rattacher un
     * groupe à une ligne partagée changerait ce que `modificateurs.test.ts`
     * lit, et le ferait tomber depuis un autre fichier.
     */
    const produit = mutation({ nom: 'TEST Plat à options' })
    await envoyer([produit])

    const { corps } = await envoyer([
      {
        ...commun(),
        type: 'catalogue.modificateur.cree',
        groupeId,
        nom: 'TEST Cuisson',
        minSelect: 1,
        maxSelect: 1,
        choix: [
          { id: choixA, nom: 'Saignant', prixDeltaMillimes: millimes(0) },
          { id: choixB, nom: 'Supplément', prixDeltaMillimes: millimes(1500) },
        ],
        produitIds: [produit.produitId],
      },
    ])
    expect(corps.rejetes).toEqual([])

    const groupe = await client.query<{ min_select: number; max_select: number; is_required: boolean }>(
      'select min_select, max_select, is_required from kaissi.modifier_groups where id = $1',
      [groupeId],
    )
    expect(groupe.rows[0]!.min_select).toBe(1)
    // `is_required` se DÉDUIT du minimum : deux réglages pour une seule idée
    // finissent par se contredire.
    expect(groupe.rows[0]!.is_required).toBe(true)

    const choix = await client.query<{ name: string; price_delta_millimes: string }>(
      'select name, price_delta_millimes from kaissi.modifiers where modifier_group_id = $1 order by position',
      [groupeId],
    )
    expect(choix.rows.map((r) => r.name)).toEqual(['Saignant', 'Supplément'])
    expect(Number(choix.rows[1]!.price_delta_millimes)).toBe(1500)

    const lien = await client.query(
      'select 1 from kaissi.product_modifiers where product_id = $1 and modifier_group_id = $2',
      [produit.produitId, groupeId],
    )
    expect(lien.rows, 'le groupe doit être rattaché à l’article').toHaveLength(1)
  })

  it('REFUSE un groupe sans choix — il ne proposerait rien en caisse', async () => {
    const { corps } = await envoyer([
      {
        ...commun(),
        type: 'catalogue.modificateur.cree',
        groupeId: uuidV7(),
        nom: 'TEST Vide',
        minSelect: 0,
        maxSelect: 0,
        choix: [],
        produitIds: [],
      },
    ])
    expect(corps.rejetes[0]!.code).toBe('requete_invalide')
  })
})

describe('les droits valent pour TOUT le catalogue, pas seulement l’article', () => {
  it('un SERVEUR ne crée ni catégorie, ni réduction, ni modificateur', async () => {
    const refus = await envoyer([
      { ...commun(), parEmployeId: EMPLOYE_DEMO, type: 'catalogue.categorie.cree', categorieId: uuidV7(), nom: 'TEST Refus', couleur: null, stationId: null },
      { ...commun(), parEmployeId: EMPLOYE_DEMO, type: 'catalogue.reduction.cree', reductionId: uuidV7(), nom: 'TEST Refus', kind: 'montant', valeurBp: null, montantMillimes: millimes(1000) },
      {
        ...commun(),
        parEmployeId: EMPLOYE_DEMO,
        type: 'catalogue.modificateur.cree',
        groupeId: uuidV7(),
        nom: 'TEST Refus',
        minSelect: 0,
        maxSelect: 1,
        choix: [{ id: uuidV7(), nom: 'Un', prixDeltaMillimes: millimes(0) }],
        produitIds: [],
      },
    ])
    expect(refus.corps.acceptes).toEqual([])
    expect(refus.corps.rejetes.map((r) => r.code)).toEqual([
      'droits_insuffisants',
      'droits_insuffisants',
      'droits_insuffisants',
    ])

    const restes = await client.query("select 1 from kaissi.categories where name = 'TEST Refus'")
    expect(restes.rows, 'rien ne doit avoir été écrit').toHaveLength(0)
  })
})
