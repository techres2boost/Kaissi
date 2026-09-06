/**
 * Ouvrir un accès au back-office depuis l'interface (routes /admin/*).
 *
 * Jusqu'ici, donner un accès au cuisinier ou au comptable demandait DEUX
 * gestes hors de l'application : créer le compte dans le tableau de bord
 * Supabase, puis lancer `pnpm sync:acces` depuis un terminal. Aucun
 * restaurateur ne fera ça.
 *
 * Ce que ces tests protègent, ce n'est pas la commodité — c'est la
 * frontière : le service parle à Postgres avec un rôle privilégié, donc RLS
 * ne le filtre pas. Si la relecture des droits en base était oubliée ou
 * fausse, n'importe quel porteur de jeton s'ouvrirait un accès chez
 * n'importe quel client.
 *
 * Supabase est simulé : ces tests vérifient NOS décisions, pas les siennes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const AUTH = { url: 'https://exemple.supabase.co', cleAnon: 'anon-de-test' }
const CLE_SERVICE = 'service-de-test'

/** Comptes d'authentification simulés : jeton → identifiant. */
const jetons = new Map<string, string>()
/** Adresses déjà prises côté Supabase — pour rejouer le cas « déjà inscrit ». */
const dejaInscrites = new Map<string, string>()
let motsDePasseChanges: { id: string; motDePasse: string }[] = []
let comptesCrees: string[] = []

const fetchSimule: typeof fetch = async (entree, init) => {
  const url = String(entree)
  const json = (corps: unknown, statut = 200) =>
    new Response(JSON.stringify(corps), {
      status: statut,
      headers: { 'content-type': 'application/json' },
    })

  if (url.endsWith('/auth/v1/user')) {
    const entetes = new Headers(init?.headers)
    const jeton = (entetes.get('authorization') ?? '').replace(/^Bearer /, '')
    const id = jetons.get(jeton)
    if (!id) return json({ message: 'invalid token' }, 401)
    return json({ id, email: `${id}@compte.tn` })
  }

  if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') {
    const corps = JSON.parse(String(init.body)) as { email: string }
    const existant = dejaInscrites.get(corps.email)
    if (existant) return json({ msg: 'email address has already been registered' }, 422)
    const id = uuidV7()
    dejaInscrites.set(corps.email, id)
    comptesCrees.push(corps.email)
    // Le compte simulé doit exister EN BASE : la route le rattache ensuite.
    await client.query('insert into auth.users (id) values ($1)', [id])
    await client.query('update auth.users set email = $2 where id = $1', [id, corps.email])
    return json({ id, email: corps.email })
  }

  if (url.includes('/auth/v1/admin/users/') && init?.method === 'PUT') {
    const id = url.split('/').pop()!
    const corps = JSON.parse(String(init.body)) as { password: string }
    motsDePasseChanges.push({ id, motDePasse: corps.password })
    return json({ id })
  }

  return json({ message: 'route non simulée' }, 500)
}

const app = creerServeur({ depot, auth: AUTH, fetchAuth: fetchSimule, cleService: CLE_SERVICE })
const appSansCle = creerServeur({ depot, auth: AUTH, fetchAuth: fetchSimule, cleService: null })

/** Crée un employé RELIÉ à un compte, et rend son jeton simulé. */
async function acteur(role: string): Promise<{ jeton: string; employeId: string }> {
  const compte = uuidV7()
  const employeId = uuidV7()
  const jeton = `jeton-${compte}`
  await client.query('insert into auth.users (id) values ($1)', [compte])
  await client.query(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name)
     values ($1, $2, $3, $4, $5)`,
    [employeId, DEMO_ORG, compte, `${employeId}@admin-test.tn`, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [DEMO_ORG, employeId, DEMO_RESTO, role],
  )
  jetons.set(jeton, compte)
  return { jeton, employeId }
}

function ouvrir(jeton: string | null, corps: unknown, chemin = '/admin/comptes', cible = app) {
  return cible.request(`http://test${chemin}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: JSON.stringify(corps),
  })
}

let gerant: { jeton: string; employeId: string }
let admin: { jeton: string; employeId: string }
let caissier: { jeton: string; employeId: string }

beforeAll(async () => {
  gerant = await acteur('gerant')
  admin = await acteur('admin')
  caissier = await acteur('caissier')
})

afterAll(async () => {
  await client.query(
    "delete from kaissi.memberships where user_id in (select id from kaissi.users where email like '%@admin-test.tn' or email like '%@nouveau.tn')",
  )
  await client.query(
    "delete from kaissi.users where email like '%@admin-test.tn' or email like '%@nouveau.tn'",
  )
  await depot.fermer()
  await client.end()
})

describe('POST /admin/comptes', () => {
  it('répond 501 quand la clé de service manque — sans rien casser d’autre', async () => {
    const reponse = await ouvrir(
      gerant.jeton,
      { restaurantId: DEMO_RESTO, email: 'x@nouveau.tn', motDePasse: 'motdepasse1', role: 'cuisine' },
      '/admin/comptes',
      appSansCle,
    )
    expect(reponse.status).toBe(501)
    const corps = (await reponse.json()) as { erreur: string; message: string }
    expect(corps.erreur).toBe('administration_indisponible')
    // Le message NOMME la variable manquante : « non configuré » tout court
    // envoie relire trois réglages dont deux sont déjà bons.
    expect(corps.message).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('refuse sans jeton de session', async () => {
    const reponse = await ouvrir(null, { restaurantId: DEMO_RESTO })
    expect(reponse.status).toBe(401)
  })

  it('refuse un jeton inconnu', async () => {
    const reponse = await ouvrir('jeton-inventé', {
      restaurantId: DEMO_RESTO,
      email: 'x@nouveau.tn',
      motDePasse: 'motdepasse1',
      role: 'cuisine',
    })
    expect(reponse.status).toBe(401)
  })

  it('refuse un CAISSIER, même authentifié', async () => {
    // Le point qui compte : le jeton est valide, la personne est bien membre
    // de l'établissement. C'est la relecture du RÔLE en base qui décide.
    const reponse = await ouvrir(caissier.jeton, {
      restaurantId: DEMO_RESTO,
      email: 'refus@nouveau.tn',
      motDePasse: 'motdepasse1',
      role: 'cuisine',
    })
    expect(reponse.status).toBe(401)
    expect(comptesCrees).not.toContain('refus@nouveau.tn')
  })

  it('refuse un établissement dont l’appelant n’est pas membre', async () => {
    const autre = uuidV7()
    await client.query(
      // Le `slug` est unique par organisation : le tirer de l'identifiant
      // évite qu'un fichier rejoué sur une base déjà servie n'échoue pour une
      // raison qui n'a rien à voir avec ce qu'il vérifie.
      `insert into kaissi.restaurants (id, organization_id, name, slug, timezone)
       values ($1, $2, 'Ailleurs', $3, 'Africa/Tunis')`,
      [autre, DEMO_ORG, `ailleurs-${autre.slice(-8)}`],
    )
    try {
      const reponse = await ouvrir(gerant.jeton, {
        restaurantId: autre,
        email: 'ailleurs@nouveau.tn',
        motDePasse: 'motdepasse1',
        role: 'cuisine',
      })
      expect(reponse.status).toBe(401)
    } finally {
      await client.query('delete from kaissi.memberships where restaurant_id = $1', [autre])
      await client.query('delete from kaissi.restaurants where id = $1', [autre])
    }
  })

  it('ouvre un accès CUISINE, compte compris', async () => {
    const email = `cuisine-${Date.now()}@nouveau.tn`
    const reponse = await ouvrir(gerant.jeton, {
      restaurantId: DEMO_RESTO,
      email,
      motDePasse: 'motdepasse1',
      nom: 'Nabil le cuisinier',
      role: 'cuisine',
    })
    expect(reponse.status).toBe(200)
    const corps = (await reponse.json()) as { compteCree: boolean; employeId: string }
    expect(corps.compteCree).toBe(true)

    const { rows } = await client.query<{ role: string; full_name: string; auth_user_id: string }>(
      `select m.role, u.full_name, u.auth_user_id
         from kaissi.memberships m join kaissi.users u on u.id = m.user_id
        where u.id = $1 and m.restaurant_id = $2`,
      [corps.employeId, DEMO_RESTO],
    )
    expect(rows[0]).toMatchObject({ role: 'cuisine', full_name: 'Nabil le cuisinier' })
    // L'employé est RELIÉ au compte : sans cela, la personne se connecte et
    // RLS ne lui rend rien — un compte qui « marche » sur un écran vide.
    expect(rows[0]!.auth_user_id).toBeTruthy()
  })

  it('refuse à un gérant de créer un GÉRANT — un gérant exploite, un admin distribue', async () => {
    const reponse = await ouvrir(gerant.jeton, {
      restaurantId: DEMO_RESTO,
      email: 'promu@nouveau.tn',
      motDePasse: 'motdepasse1',
      role: 'gerant',
    })
    expect(reponse.status).toBe(401)
    expect(comptesCrees).not.toContain('promu@nouveau.tn')
  })

  it('… et l’autorise à un ADMINISTRATEUR', async () => {
    const email = `gerant-${Date.now()}@nouveau.tn`
    const reponse = await ouvrir(admin.jeton, {
      restaurantId: DEMO_RESTO,
      email,
      motDePasse: 'motdepasse1',
      role: 'gerant',
    })
    expect(reponse.status).toBe(200)
  })

  it('rattache une adresse DÉJÀ inscrite sans toucher à son mot de passe', async () => {
    const email = `existant-${Date.now()}@nouveau.tn`
    // Premier passage : le compte est créé.
    expect((await ouvrir(gerant.jeton, {
      restaurantId: DEMO_RESTO, email, motDePasse: 'motdepasse1', role: 'cuisine',
    })).status).toBe(200)

    motsDePasseChanges = []
    // Second passage : Supabase répond « déjà inscrit ». On rattache, on
    // n'écrase RIEN — le compte appartient peut-être à quelqu'un d'autre.
    const reponse = await ouvrir(gerant.jeton, {
      restaurantId: DEMO_RESTO, email, motDePasse: 'autremotdepasse', role: 'bar',
    })
    expect(reponse.status).toBe(200)
    const corps = (await reponse.json()) as { compteCree: boolean }
    expect(corps.compteCree).toBe(false)
    expect(motsDePasseChanges).toHaveLength(0)

    const { rows } = await client.query<{ role: string }>(
      `select m.role from kaissi.memberships m join kaissi.users u on u.id = m.user_id
        where lower(u.email) = $1 and m.restaurant_id = $2`,
      [email, DEMO_RESTO],
    )
    // Rejouable : le rôle est mis à jour, pas dupliqué.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.role).toBe('bar')
  })

  it('refuse un mot de passe trop court', async () => {
    const reponse = await ouvrir(gerant.jeton, {
      restaurantId: DEMO_RESTO,
      email: 'court@nouveau.tn',
      motDePasse: 'court',
      role: 'cuisine',
    })
    expect(reponse.status).toBe(401)
  })
})

describe('POST /admin/mot-de-passe', () => {
  it('change le mot de passe d’un employé de l’équipe', async () => {
    const email = `perdu-${Date.now()}@nouveau.tn`
    const creation = await ouvrir(gerant.jeton, {
      restaurantId: DEMO_RESTO, email, motDePasse: 'motdepasse1', role: 'cuisine',
    })
    const { employeId } = (await creation.json()) as { employeId: string }

    motsDePasseChanges = []
    const reponse = await ouvrir(
      gerant.jeton,
      { restaurantId: DEMO_RESTO, employeId, motDePasse: 'nouveaumotdepasse' },
      '/admin/mot-de-passe',
    )
    expect(reponse.status).toBe(200)
    expect(motsDePasseChanges).toHaveLength(1)
    expect(motsDePasseChanges[0]!.motDePasse).toBe('nouveaumotdepasse')
  })

  it('refuse à un gérant de remettre le mot de passe d’un ADMINISTRATEUR', async () => {
    motsDePasseChanges = []
    const reponse = await ouvrir(
      gerant.jeton,
      { restaurantId: DEMO_RESTO, employeId: admin.employeId, motDePasse: 'nouveaumotdepasse' },
      '/admin/mot-de-passe',
    )
    expect(reponse.status).toBe(401)
    expect(motsDePasseChanges).toHaveLength(0)
  })

  it('refuse un employé SANS compte de back-office, et le dit', async () => {
    const sansCompte = uuidV7()
    await client.query(
      `insert into kaissi.users (id, organization_id, email, full_name)
       values ($1, $2, $3, 'Serveur sans compte')`,
      [sansCompte, DEMO_ORG, `${sansCompte}@admin-test.tn`],
    )
    await client.query(
      `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
       values ($1, $2, $3, 'serveur')`,
      [DEMO_ORG, sansCompte, DEMO_RESTO],
    )
    const reponse = await ouvrir(
      gerant.jeton,
      { restaurantId: DEMO_RESTO, employeId: sansCompte, motDePasse: 'nouveaumotdepasse' },
      '/admin/mot-de-passe',
    )
    expect(reponse.status).toBe(401)
    const corps = (await reponse.json()) as { message: string }
    expect(corps.message).toContain('accès')
  })
})
