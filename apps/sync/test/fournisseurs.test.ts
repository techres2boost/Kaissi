/**
 * Les FICHES FOURNISSEURS (migration 0041) — et ce qu'elles ne cassent pas.
 *
 * ── Ce que ce fichier éprouve ─────────────────────────────────────────────
 *
 * La migration 0026 avait choisi un TEXTE libre plutôt qu'une table, et avait
 * écrit pourquoi : « une table imposerait de créer un fournisseur avant de
 * saisir une réception ». La 0041 ajoute la table SANS revenir là-dessus — et
 * c'est exactement ce que ces tests vérifient : une réception au nom inconnu
 * s'enregistre toujours, le rattachement reste facultatif, et l'historique
 * déjà saisi n'a pas bougé.
 *
 * Plus le cloisonnement, qui n'est jamais gratuit : les fiches d'un client ne
 * se lisent pas depuis un autre, et un rôle de préparation ne les écrit pas.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DEMO_ORG, DEMO_RESTO, TVA_19, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

type Issue = 'applique' | 'filtre' | 'refuse'
const comptes = new Map<string, string>()

async function dansLaPeauDe(acteur: string, sql: string, valeurs: unknown[] = []): Promise<Issue> {
  await client.query('begin')
  try {
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: comptes.get(acteur) ?? acteur }),
    ])
    await client.query('set local role authenticated')
    const resultat = await client.query(sql, valeurs)
    return resultat.rowCount === 0 ? 'filtre' : 'applique'
  } catch {
    return 'refuse'
  } finally {
    await client.query('rollback')
  }
}

async function membre(role: string, organisation = DEMO_ORG, restaurant = DEMO_RESTO) {
  const compte = uuidV7()
  const id = uuidV7()
  await client.query('insert into auth.users (id) values ($1)', [compte])
  await client.query(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name, pin_hash)
     values ($1, $2, $3, $4, $5, 'HACHE')`,
    [id, organisation, compte, `${id}@fournisseurs.tn`, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [organisation, id, restaurant, role],
  )
  comptes.set(id, compte)
  return id
}

let gerant: string
let cuisine: string
let fiche: string
/** Un produit à nous, pour poser des mouvements sans toucher au décor. */
let produit: string
const aNettoyer: string[] = []

beforeAll(async () => {
  gerant = await membre('gerant')
  cuisine = await membre('cuisine')

  fiche = uuidV7()
  await client.query(
    `insert into kaissi.suppliers (id, organization_id, restaurant_id, name, contact, phone)
     values ($1, $2, $3, 'Sfax Primeurs', 'Monsieur Slim', '+216 74 000 000')`,
    [fiche, DEMO_ORG, DEMO_RESTO],
  )

  produit = uuidV7()
  await client.query(
    `insert into kaissi.products
       (id, organization_id, restaurant_id, name, base_price_millimes, tax_rate_id)
     values ($1, $2, $3, 'Cageot de test', 1000, $4)`,
    [produit, DEMO_ORG, DEMO_RESTO, TVA_19],
  )
})

afterAll(async () => {
  for (const id of aNettoyer) {
    await client.query('delete from kaissi.stock_movements where id = $1', [id])
  }
  await client.query('delete from kaissi.stock_movements where product_id = $1', [produit])
  await client.query('delete from kaissi.products where id = $1', [produit])
  await client.query('delete from kaissi.suppliers where restaurant_id = $1', [DEMO_RESTO])
  for (const id of comptes.keys()) {
    await client.query('delete from kaissi.memberships where user_id = $1', [id])
    await client.query('delete from kaissi.users where id = $1', [id])
  }
  await client.end()
})

/** Pose une réception, avec ou sans rattachement. Rend la ligne écrite. */
async function receptionner(nom: string | null, ficheId: string | null) {
  const id = uuidV7()
  aNettoyer.push(id)
  await client.query(
    `insert into kaissi.stock_movements
       (id, organization_id, restaurant_id, product_id, qty_delta, reason, supplier, supplier_id)
     values ($1, $2, $3, $4, 12, 'reception', $5, $6)`,
    [id, DEMO_ORG, DEMO_RESTO, produit, nom, ficheId],
  )
  const { rows } = await client.query(
    'select supplier, supplier_id from kaissi.stock_movements where id = $1',
    [id],
  )
  return { id, ...rows[0] }
}

describe('une réception reste saisissable sans aucune fiche', () => {
  it('un nom INCONNU s’enregistre, et n’est pas rattaché', async () => {
    /*
     * Le cœur de la promesse de 2026 : personne ne crée une fiche au moment
     * où il décharge des cageots. Si ce test échouait, c'est qu'une
     * contrainte `not null` ou une clé étrangère obligatoire se serait
     * glissée — et la saisie de stock serait devenue un formulaire de plus.
     */
    const ligne = await receptionner('Un maraîcher de passage', null)
    expect(ligne.supplier).toBe('Un maraîcher de passage')
    expect(ligne.supplier_id).toBeNull()
  })

  it('un mouvement SANS aucun fournisseur reste possible', async () => {
    const ligne = await receptionner(null, null)
    expect(ligne.supplier).toBeNull()
    expect(ligne.supplier_id).toBeNull()
  })

  it('le nom LIBRE est conservé même quand la fiche est rattachée', async () => {
    /*
     * Les deux colonnes coexistent, et c'est `supplier` qui fait foi pour
     * l'affichage. Écraser le texte par le nom de la fiche réécrirait
     * l'histoire : ce qui a été tapé ce jour-là est ce qui doit rester.
     */
    const ligne = await receptionner('Sfax Primeurs', fiche)
    expect(ligne.supplier).toBe('Sfax Primeurs')
    expect(ligne.supplier_id).toBe(fiche)
  })
})

describe('la fiche s’archive, elle ne se perd pas', () => {
  it('archiver libère le nom pour une NOUVELLE fiche', async () => {
    /*
     * L'index unique est PARTIEL sur `archived_at is null`. Sans cela, un
     * fournisseur archivé bloquerait son propre nom pour toujours, et il
     * faudrait le rouvrir sous « Sfax Primeurs 2 ».
     */
    const archive = uuidV7()
    await client.query(
      `insert into kaissi.suppliers (id, organization_id, restaurant_id, name, archived_at)
       values ($1, $2, $3, 'Ancien Grossiste', now())`,
      [archive, DEMO_ORG, DEMO_RESTO],
    )
    const neuf = uuidV7()
    await client.query(
      `insert into kaissi.suppliers (id, organization_id, restaurant_id, name)
       values ($1, $2, $3, 'Ancien Grossiste')`,
      [neuf, DEMO_ORG, DEMO_RESTO],
    )
    const { rows } = await client.query(
      'select count(*)::int as n from kaissi.suppliers where restaurant_id = $1 and name = $2',
      [DEMO_RESTO, 'Ancien Grossiste'],
    )
    expect(rows[0].n).toBe(2)
  })

  it('deux fiches ACTIVES du même nom sont refusées', async () => {
    await expect(
      client.query(
        `insert into kaissi.suppliers (id, organization_id, restaurant_id, name)
         values ($1, $2, $3, '  SFAX PRIMEURS  ')`,
        [uuidV7(), DEMO_ORG, DEMO_RESTO],
      ),
      /*
       * La CASSE et les espaces de bord ne font pas un autre fournisseur :
       * l'index compare `lower(btrim(name))`, exactement comme l'écran quand
       * il rattache une réception (`ilike` sur un nom déjà élagué par
       * `texteObligatoire`). Les deux normalisations doivent coïncider, sinon
       * un nom passerait la saisie et se ferait refuser par la base.
       */
    ).rejects.toThrow(/suppliers_nom_actif_idx/)
  })

  it('une fiche supprimée laisse l’historique LISIBLE', async () => {
    /*
     * `on delete set null`, et la colonne texte porte toujours le nom. Un
     * `restrict` aurait fait échouer la suppression d'un établissement —
     * `suppliers` et `stock_movements` tombent tous deux en cascade.
     */
    const jetable = uuidV7()
    await client.query(
      `insert into kaissi.suppliers (id, organization_id, restaurant_id, name)
       values ($1, $2, $3, 'Grossiste Éphémère')`,
      [jetable, DEMO_ORG, DEMO_RESTO],
    )
    const ligne = await receptionner('Grossiste Éphémère', jetable)
    await client.query('delete from kaissi.suppliers where id = $1', [jetable])
    const { rows } = await client.query(
      'select supplier, supplier_id from kaissi.stock_movements where id = $1',
      [ligne.id],
    )
    expect(rows[0].supplier).toBe('Grossiste Éphémère')
    expect(rows[0].supplier_id).toBeNull()
  })
})

describe('RLS — qui lit et qui écrit une fiche', () => {
  it('un gérant crée une fiche', async () => {
    expect(
      await dansLaPeauDe(
        gerant,
        `insert into kaissi.suppliers (id, organization_id, restaurant_id, name)
         values ($1, $2, $3, 'Boucherie du Centre') returning 1`,
        [uuidV7(), DEMO_ORG, DEMO_RESTO],
      ),
    ).toBe('applique')
  })

  it('un rôle de PRÉPARATION lit, mais n’écrit pas', async () => {
    /*
     * `protege_referentiel` : lecture pour tout membre, écriture pour
     * l'encadrement. Un cuisinier a besoin de savoir d'où vient la
     * marchandise ; il ne décide pas des fournisseurs.
     */
    expect(
      await dansLaPeauDe(cuisine, 'select 1 from kaissi.suppliers where id = $1', [fiche]),
    ).toBe('applique')
    expect(
      await dansLaPeauDe(
        cuisine,
        `update kaissi.suppliers set name = 'Détourné' where id = $1 returning 1`,
        [fiche],
      ),
    ).not.toBe('applique')
  })

  it('les fiches d’un AUTRE établissement ne se lisent pas', async () => {
    const orgId = uuidV7()
    const restoId = uuidV7()
    await client.query('insert into kaissi.organizations (id, name, slug) values ($1, $2, $3)', [
      orgId,
      'Voisin',
      `voisin-${orgId.slice(-8)}`,
    ])
    await client.query(
      `insert into kaissi.restaurants (id, organization_id, name, slug)
       values ($1, $2, 'Chez le voisin', 'chez-le-voisin')`,
      [restoId, orgId],
    )
    await client.query(
      `insert into kaissi.suppliers (id, organization_id, restaurant_id, name)
       values ($1, $2, $3, 'Fournisseur du voisin')`,
      [uuidV7(), orgId, restoId],
    )
    try {
      expect(
        await dansLaPeauDe(gerant, 'select 1 from kaissi.suppliers where restaurant_id = $1', [
          restoId,
        ]),
      ).toBe('filtre')
    } finally {
      await client.query('delete from kaissi.suppliers where restaurant_id = $1', [restoId])
      await client.query('delete from kaissi.restaurants where id = $1', [restoId])
      await client.query('delete from kaissi.organizations where id = $1', [orgId])
    }
  })
})

describe('les fiches ne descendent PAS à la caisse', () => {
  it('créer une fiche n’écrit rien dans change_log', async () => {
    /*
     * Une tablette n'enregistre aucune réception et ne consulte aucun
     * fournisseur. Journaliser ces lignes ferait grossir sa base pour rien —
     * et surtout, ce serait une voie de synchronisation de plus à maintenir.
     *
     * Le test compare le curseur AVANT et APRÈS : il ne suppose pas que le
     * journal est vide, ce qu'il n'est jamais sur une base partagée.
     */
    const { rows: avant } = await client.query(
      'select coalesce(max(seq), 0)::bigint as seq from kaissi.change_log where restaurant_id = $1',
      [DEMO_RESTO],
    )
    await client.query(
      `insert into kaissi.suppliers (id, organization_id, restaurant_id, name)
       values ($1, $2, $3, 'Silencieux')`,
      [uuidV7(), DEMO_ORG, DEMO_RESTO],
    )
    const { rows: apres } = await client.query(
      'select coalesce(max(seq), 0)::bigint as seq from kaissi.change_log where restaurant_id = $1',
      [DEMO_RESTO],
    )
    expect(String(apres[0].seq)).toBe(String(avant[0].seq))
  })
})
