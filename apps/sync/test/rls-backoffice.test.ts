/**
 * Ce que RLS autorise vraiment au back-office.
 *
 * Ces tests empruntent le rôle `authenticated` et posent la revendication
 * `sub` exactement comme le fait PostgREST. C'est le seul moyen honnête de
 * vérifier une politique : la lire ne prouve rien, et l'exécuter en
 * superutilisateur non plus — le propriétaire contourne tout.
 *
 * Trois issues sont possibles, et les confondre fait passer un test qui ne
 * teste rien :
 *   - APPLIQUE : la ligne est modifiée ;
 *   - FILTRE   : la clause USING masque la ligne. Aucune erreur, zéro ligne
 *                touchée — c'est le mode d'échec silencieux de RLS ;
 *   - REFUSE   : la clause WITH CHECK ou un privilège de colonne lève.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

type Issue = 'applique' | 'filtre' | 'refuse'

/** Joue une requête dans la peau d'un utilisateur, puis annule tout. */
async function dansLaPeauDe(acteur: string, sql: string, valeurs: unknown[] = []): Promise<Issue> {
  await client.query('begin')
  try {
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: acteur }),
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

let gerant: string
let serveur: string
let admin: string

async function creer(role: string): Promise<string> {
  const id = uuidV7()
  await client.query('insert into auth.users (id) values ($1)', [id])
  await client.query(
    `insert into kaissi.users (id, organization_id, email, full_name, pin_hash)
     values ($1, $2, $3, $4, 'HACHE')`,
    [id, DEMO_ORG, `${id}@rls.tn`, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [DEMO_ORG, id, DEMO_RESTO, role],
  )
  return id
}

beforeEach(async () => {
  // Des acteurs neufs à chaque cas : un test qui modifierait réellement un
  // rôle empoisonnerait les suivants sans qu'on comprenne pourquoi.
  gerant = await creer('gerant')
  serveur = await creer('serveur')
  admin = await creer('admin')
})

afterAll(async () => {
  await client.query("delete from kaissi.users where email like '%@rls.tn'")
  await client.query("delete from auth.users where id in (select id from kaissi.users where email like '%@rls.tn')")
  await client.end()
})

const PIN = 'update kaissi.users set pin_hash = $1 where id = $2'
const ROLE = 'update kaissi.memberships set role = $1 where user_id = $2'

describe('un gérant administre les employés de son établissement', () => {
  it('réinitialise le PIN d’un serveur — sans cela, le back-office est inutile', async () => {
    expect(await dansLaPeauDe(gerant, PIN, ['NEUF', serveur])).toBe('applique')
  })

  it('renomme et suspend un employé', async () => {
    expect(
      await dansLaPeauDe(gerant, 'update kaissi.users set full_name = $1 where id = $2', [
        'Nouveau Nom',
        serveur,
      ]),
    ).toBe('applique')
    expect(
      await dansLaPeauDe(gerant, "update kaissi.users set status = 'suspendu' where id = $1", [
        serveur,
      ]),
    ).toBe('applique')
  })

  it('change le rôle d’un employé', async () => {
    expect(await dansLaPeauDe(gerant, ROLE, ['caissier', serveur])).toBe('applique')
  })
})

describe('ce qu’un gérant ne peut PAS faire', () => {
  it('toucher au PIN d’un administrateur', async () => {
    // Sinon, réinitialiser le code de son propre patron serait à portée de clic.
    expect(await dansLaPeauDe(gerant, PIN, ['PIRATE', admin])).toBe('filtre')
  })

  it('se promouvoir administrateur', async () => {
    // C'était possible avant la migration 0014 : « memberships_gestion »
    // laissait tout gérant écrire n'importe quel rôle, « admin » compris.
    expect(await dansLaPeauDe(gerant, ROLE, ['admin', gerant])).toBe('refuse')
  })

  it('promouvoir quelqu’un d’autre administrateur', async () => {
    expect(await dansLaPeauDe(gerant, ROLE, ['admin', serveur])).toBe('refuse')
  })

  it('changer l’e-mail d’un employé', async () => {
    // Refusé par PRIVILÈGE DE COLONNE, pas seulement par politique : l'e-mail
    // est la clé vers auth.users, le désaligner casserait la connexion sans
    // qu'aucun message ne le dise.
    expect(
      await dansLaPeauDe(gerant, 'update kaissi.users set email = $1 where id = $2', [
        'pirate@rls.tn',
        serveur,
      ]),
    ).toBe('refuse')
  })

  it('déplacer un employé vers une autre organisation', async () => {
    expect(
      await dansLaPeauDe(gerant, 'update kaissi.users set organization_id = $1 where id = $2', [
        uuidV7(),
        serveur,
      ]),
    ).toBe('refuse')
  })
})

describe('un employé sans encadrement', () => {
  it('peut changer son propre PIN', async () => {
    expect(await dansLaPeauDe(serveur, PIN, ['MON-PIN', serveur])).toBe('applique')
  })

  it('ne peut pas toucher à celui de son gérant', async () => {
    expect(await dansLaPeauDe(serveur, PIN, ['PIRATE', gerant])).toBe('filtre')
  })

  it('ne peut pas se promouvoir', async () => {
    expect(await dansLaPeauDe(serveur, ROLE, ['gerant', serveur])).toBe('filtre')
  })
})

describe('un administrateur', () => {
  it('nomme un administrateur — lui seul le peut', async () => {
    expect(await dansLaPeauDe(admin, ROLE, ['admin', serveur])).toBe('applique')
  })
})

describe('cloisonnement entre établissements', () => {
  it('un gérant ne voit pas les employés d’une autre organisation', async () => {
    const autreOrg = uuidV7()
    const etranger = uuidV7()
    await client.query(
      `insert into kaissi.organizations (id, name, slug) values ($1, 'Autre', $2)`,
      [autreOrg, `autre-${autreOrg.slice(0, 8)}`],
    )
    await client.query('insert into auth.users (id) values ($1)', [etranger])
    await client.query(
      `insert into kaissi.users (id, organization_id, email, full_name)
       values ($1, $2, $3, 'Étranger')`,
      [etranger, autreOrg, `${etranger}@rls.tn`],
    )

    // Ni lecture, ni écriture : la politique ne rend simplement rien.
    expect(await dansLaPeauDe(gerant, PIN, ['X', etranger])).toBe('filtre')
    expect(
      await dansLaPeauDe(gerant, 'select 1 from kaissi.users where id = $1', [etranger]),
    ).toBe('filtre')

    await client.query('delete from kaissi.users where id = $1', [etranger])
    await client.query('delete from auth.users where id = $1', [etranger])
    await client.query('delete from kaissi.organizations where id = $1', [autreOrg])
  })
})
