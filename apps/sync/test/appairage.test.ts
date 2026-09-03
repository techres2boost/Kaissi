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
import { uuidV7 } from '@kaissi/domain'
import { DEMO_ORG, DEMO_RESTO, EMPLOYE_DEMO, URL_TEST, ev, nettoyer } from './aide.js'

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

/**
 * Le terminal qu'on remet en service ne doit pas devenir un terminal de plus.
 *
 * Défaut constaté sur la base de production : UNE tablette, CINQ appareils —
 * P1 à P5, créés en une demi-heure. Chaque clic sur « Ré-appairer » créait un
 * appareil neuf, parce que rien ne reliait la deuxième mise en service à la
 * première.
 *
 * Ce n'était pas qu'une nuisance d'affichage. Les événements déjà en attente
 * dans l'outbox portaient l'ANCIEN `device_id` ; le nouveau jeton ne les
 * couvrait pas, et le serveur les refusait « appareil_etranger ». Un rejet ne
 * se réessaie jamais tout seul : ces ventes n'arrivaient JAMAIS.
 */
describe('POST /appairage — un terminal garde son identité', () => {
  const INSTALLATION = '01930000-0000-7000-8000-0000000009c1'
  const identifiants = { email: 'gerant@kaissi.tn', motDePasse: 'bonMotDePasse' }

  it('rend le MÊME appareil et le MÊME préfixe à la remise en service', async () => {
    const un = await appairer({ ...identifiants, installationId: INSTALLATION })
    const deux = await appairer({ ...identifiants, installationId: INSTALLATION })

    expect(deux.statut).toBe(200)
    expect(deux.corps.deviceId).toBe(un.corps.deviceId)
    // Le préfixe ne repart pas : sinon la même caisse renumérote ses tickets
    // à partir de 1 et deux tickets différents finissent identiques.
    expect(deux.corps.prefixe).toBe(un.corps.prefixe)
    // Le serveur le DIT, pour que l'écran puisse le dire aussi.
    expect(un.corps.reprise).toBe(false)
    expect(deux.corps.reprise).toBe(true)

    // Une seule ligne d'appareil, pas deux.
    const { rows } = await sql(
      'select count(*)::int as n from kaissi.devices where restaurant_id = $1',
      [DEMO_RESTO],
    )
    expect(rows[0].n).toBe(1)

    // Le jeton, lui, tourne : le précédent ne vaut plus rien.
    expect(deux.corps.jeton).not.toBe(un.corps.jeton)
    const ancien = await app.request('http://test/sync/pull?taillePage=1', {
      headers: { authorization: `Bearer ${un.corps.jeton}` },
    })
    expect(ancien.status).toBe(401)
    const nouveau = await app.request('http://test/sync/pull?taillePage=1', {
      headers: { authorization: `Bearer ${deux.corps.jeton}` },
    })
    expect(nouveau.status).toBe(200)
  })

  it("laisse partir une vente restée en attente à travers une remise en service", async () => {
    // LE symptôme de production, reproduit de bout en bout.
    const un = await appairer({ ...identifiants, installationId: INSTALLATION })
    const orderId = uuidV7()
    const appareil = {
      id: un.corps.deviceId as string,
      jetonClair: un.corps.jeton as string,
      prefixe: un.corps.prefixe as string,
    }

    // La vente est CRÉÉE avant la remise en service : elle attend dans
    // l'outbox, signée par l'appareil du moment.
    const enAttente = [
      ev(appareil, orderId, 'order.opened', {
        type: 'takeaway',
        ouvertePar: EMPLOYE_DEMO,
        numeroTicket: `${appareil.prefixe}-000001`,
      }),
    ]

    const deux = await appairer({ ...identifiants, installationId: INSTALLATION })

    const reponse = await app.request('http://test/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${deux.corps.jeton}`,
      },
      body: JSON.stringify({
        protocolVersion: 1,
        batchId: uuidV7(),
        evenements: enAttente,
      }),
    })
    const corps = (await reponse.json()) as any

    expect(reponse.status).toBe(200)
    // Sans identité stable, cette ligne portait « appareil_etranger » — et la
    // vente ne revenait jamais.
    expect(corps.rejetes).toEqual([])
    expect(corps.acceptes).toHaveLength(1)
  })

  it('sans identifiant d’installation, crée bien un appareil neuf', async () => {
    // Compatibilité : les terminaux antérieurs à la 0021 et le script en
    // ligne de commande n'en envoient pas. On ne casse pas leur appairage.
    const un = await appairer(identifiants)
    const deux = await appairer(identifiants)
    expect(deux.corps.deviceId).not.toBe(un.corps.deviceId)
  })

  it('une révocation reste DÉFINITIVE : la même installation repart à neuf', async () => {
    // Sinon, une tablette volée reviendrait dans le parc dès que quelqu'un
    // connaît les identifiants du gérant — et l'écran « Appareils » du
    // back-office deviendrait un bouton sans effet.
    const un = await appairer({ ...identifiants, installationId: INSTALLATION })
    await sql('update kaissi.devices set revoked_at = now() where id = $1', [un.corps.deviceId])

    const deux = await appairer({ ...identifiants, installationId: INSTALLATION })
    expect(deux.corps.deviceId).not.toBe(un.corps.deviceId)
    expect(deux.corps.reprise).toBe(false)
    // Et le préfixe du révoqué n'est pas recyclé.
    expect(deux.corps.prefixe).not.toBe(un.corps.prefixe)
  })

  it('refuse un identifiant d’installation mal formé, avec son nom', async () => {
    // La colonne est un `uuid` : sans ce contrôle, Postgres renvoyait une
    // erreur de conversion, donc un 500 qui n'apprend rien.
    const { statut, corps } = await appairer({ ...identifiants, installationId: 'bonjour' })
    expect(statut).toBe(400)
    expect(corps.erreur).toBe('requete_invalide')
    expect(corps.message).toContain("identifiant d'installation")
  })
})
