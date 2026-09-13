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
import { millimes, uuidV7, type MutationCatalogue } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
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

async function purger() {
  await client.query("delete from kaissi.change_log where entity_type = 'products'")
  await client.query("delete from kaissi.products where name like 'TEST %'")
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
function mutation(surcharges: Partial<MutationCatalogue> = {}): MutationCatalogue {
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
