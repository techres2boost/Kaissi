/**
 * Appairage par identifiants — la fin du jeton recopié à la main.
 *
 * Un gérant ne lance pas une commande dans un terminal pour mettre sa caisse
 * en service. Il saisit ses identifiants sur la tablette, et elle reçoit son
 * jeton. Le modèle d'identités ne change pas pour autant : c'est toujours le
 * jeton d'appareil, révocable, qui authentifie la caisse ensuite.
 *
 * Supabase Auth est remplacé par un double : ce test vérifie NOTRE logique
 * d'autorisation, pas celle de Supabase.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { empreinteDe } from '../src/jeton.js'
import { DEMO_ORG, DEMO_RESTO, URL_TEST, nettoyer } from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const AUTH = { url: 'https://faux.supabase.co', cleAnon: 'anon-de-test' }

// Deux identités bien distinctes, comme en production : l'identifiant du
// COMPTE Supabase (auth.users) n'est pas celui de l'EMPLOYÉ (kaissi.users).
const AUTH_GERANT = '01930000-0000-7000-8000-0000000009a1'
const AUTH_CAISSIER = '01930000-0000-7000-8000-0000000009a2'
const EMP_GERANT = '01930000-0000-7000-8000-0000000009b1'
const EMP_CAISSIER = '01930000-0000-7000-8000-0000000009b2'

/** Double de Supabase Auth : deux comptes connus, tout le reste refusé. */
const fauxAuth: typeof fetch = async (entree, init) => {
  const corps = JSON.parse(String((init as RequestInit).body)) as {
    email: string
    password: string
  }
  const connus: Record<string, string> = {
    'gerant@kaissi.tn': AUTH_GERANT,
    'caissier@kaissi.tn': AUTH_CAISSIER,
  }
  const id = connus[corps.email]
  if (!id || corps.password !== 'bonMotDePasse') {
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
  }
  return new Response(JSON.stringify({ user: { id, email: corps.email } }), { status: 200 })
}

const app = creerServeur({ depot, auth: AUTH, fetchAuth: fauxAuth })

async function appairer(corps: unknown) {
  const reponse = await app.request('http://test/appairage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  })
  return { statut: reponse.status, corps: (await reponse.json()) as any }
}

async function sql(texte: string, valeurs: unknown[] = []) {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    return await client.query(texte, valeurs)
  } finally {
    await client.end()
  }
}

async function purger() {
  await sql('delete from kaissi.memberships where user_id = any($1)', [
    [EMP_GERANT, EMP_CAISSIER],
  ])
  await sql('delete from kaissi.users where id = any($1)', [[EMP_GERANT, EMP_CAISSIER]])
  await sql('delete from auth.users where id = any($1)', [[AUTH_GERANT, AUTH_CAISSIER]])
}

beforeEach(async () => {
  await nettoyer()
  await purger()
  await sql('insert into auth.users (id) values ($1), ($2)', [AUTH_GERANT, AUTH_CAISSIER])
  await sql(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name)
     values ($1,$2,$3,$4,$5), ($6,$2,$7,$8,$9)`,
    [
      EMP_GERANT, DEMO_ORG, AUTH_GERANT, 'gerant@kaissi.tn', 'Ahmed',
      EMP_CAISSIER, AUTH_CAISSIER, 'caissier@kaissi.tn', 'Salma',
    ],
  )
  await sql(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1,$2,$3,'gerant'), ($1,$4,$3,'caissier')`,
    [DEMO_ORG, EMP_GERANT, DEMO_RESTO, EMP_CAISSIER],
  )
})

afterAll(async () => {
  await purger()
  await depot.fermer()
})

describe('POST /appairage', () => {
  it('délivre un jeton utilisable, sans aucune ligne de commande', async () => {
    const { statut, corps } = await appairer({
      email: 'gerant@kaissi.tn',
      motDePasse: 'bonMotDePasse',
      libelle: 'Caisse 1',
    })

    expect(statut).toBe(200)
    expect(corps.jeton).toMatch(/^kdev_/)
    expect(corps.restaurantId).toBe(DEMO_RESTO)
    expect(corps.nomEtablissement).toBeTruthy()

    // Le jeton fonctionne VRAIMENT : c'est la seule preuve qui compte.
    const pull = await app.request('http://test/sync/pull?taillePage=1', {
      headers: { authorization: `Bearer ${corps.jeton}` },
    })
    expect(pull.status).toBe(200)

    // La base ne garde que l'empreinte — jamais le jeton.
    const { rows } = await sql('select token_hash from kaissi.devices where id = $1', [
      corps.deviceId,
    ])
    expect(rows[0].token_hash).toBe(empreinteDe(corps.jeton))
    expect(rows[0].token_hash).not.toContain(corps.jeton)
  })

  it('attribue un préfixe libre, sans jamais réutiliser celui d’un révoqué', async () => {
    // La contrainte d'unicité ne relâche pas le préfixe d'un appareil
    // révoqué, et c'est voulu : deux tickets d'archive ne doivent pas
    // porter le même numéro. Compter les appareils donnerait une collision
    // dès la première révocation.
    const un = await appairer({ email: 'gerant@kaissi.tn', motDePasse: 'bonMotDePasse' })
    expect(un.corps.prefixe).toBe('P1')

    await sql('update kaissi.devices set revoked_at = now() where id = $1', [un.corps.deviceId])

    const deux = await appairer({ email: 'gerant@kaissi.tn', motDePasse: 'bonMotDePasse' })
    expect(deux.corps.prefixe).toBe('P2')

    const trois = await appairer({ email: 'gerant@kaissi.tn', motDePasse: 'bonMotDePasse' })
    expect(trois.corps.prefixe).toBe('P3')
  })

  it('refuse un caissier : enrôler un terminal est une décision de gérant', async () => {
    const { statut, corps } = await appairer({
      email: 'caissier@kaissi.tn',
      motDePasse: 'bonMotDePasse',
    })
    expect(statut).toBe(403)
    expect(corps.erreur).toBe('aucun_etablissement')
  })

  it('ne dit pas si un e-mail existe', async () => {
    // Un écran d'appairage ne doit pas devenir un moyen d'énumérer les
    // comptes du client.
    const inconnu = await appairer({ email: 'personne@kaissi.tn', motDePasse: 'bonMotDePasse' })
    const mauvais = await appairer({ email: 'gerant@kaissi.tn', motDePasse: 'faux' })
    expect(inconnu.statut).toBe(401)
    expect(mauvais.statut).toBe(401)
    expect(inconnu.corps.message).toBe(mauvais.corps.message)
  })

  it("refuse un établissement dont le compte n'est pas gérant", async () => {
    const { statut, corps } = await appairer({
      email: 'gerant@kaissi.tn',
      motDePasse: 'bonMotDePasse',
      restaurantId: '01930000-0000-7000-8000-00000000ffff',
    })
    expect(statut).toBe(403)
    expect(corps.erreur).toBe('etablissement_refuse')
  })

  it('répond proprement quand le serveur n’est pas configuré pour cela', async () => {
    // Un déploiement sans SUPABASE_URL doit continuer à servir les
    // terminaux déjà appairés, pas planter au démarrage.
    const sansAuth = creerServeur({ depot, auth: null })
    const r = await sansAuth.request('http://test/appairage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.tn', motDePasse: 'x' }),
    })
    expect(r.status).toBe(501)
    expect(((await r.json()) as any).erreur).toBe('appairage_indisponible')
  })
})
