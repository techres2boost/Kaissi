/**
 * Changer la formule d'un client — l'ÉDITEUR seul.
 *
 * Demandé : un bouton au back-office, plutôt qu'une commande dans un
 * terminal. Le risque est évident : un administrateur de restaurant est le
 * CLIENT. S'il pouvait cliquer « Payant », la formule payante serait
 * gratuite. D'où une liste d'éditeurs côté SERVICE, relue à chaque appel.
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

/** Jeton → compte ; l'e-mail simulé est `<id>@compte.tn`. */
const jetons = new Map<string, string>()
const fetchSimule: typeof fetch = async (entree, init) => {
  const url = String(entree)
  if (url.endsWith('/auth/v1/user')) {
    const jeton = (new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '')
    const id = jetons.get(jeton)
    return new Response(
      JSON.stringify(id ? { id, email: `${id}@compte.tn` } : { message: 'invalid token' }),
      { status: id ? 200 : 401, headers: { 'content-type': 'application/json' } },
    )
  }
  return new Response('{}', { status: 500 })
}

const EDITEUR = uuidV7()
const CLIENT_ADMIN = uuidV7()
const app = creerServeur({
  depot,
  auth: { url: 'https://exemple.supabase.co', cleAnon: 'anon' },
  fetchAuth: fetchSimule,
  cleService: 'service-de-test',
  editeurs: [`${EDITEUR}@compte.tn`],
})

let planAvant: string | null = null

beforeAll(async () => {
  jetons.set('jeton-editeur', EDITEUR)
  jetons.set('jeton-client', CLIENT_ADMIN)
  const { rows } = await client.query('select plan from kaissi.subscriptions where organization_id = $1', [
    DEMO_ORG,
  ])
  planAvant = (rows[0]?.plan as string | undefined) ?? null
})

afterAll(async () => {
  if (planAvant) {
    await client.query(
      `update kaissi.subscriptions set plan = $2,
         trial_ends_at = case when $2 = 'essai' then now() + interval '14 days' else null end
       where organization_id = $1`,
      [DEMO_ORG, planAvant],
    )
  }
  await client.end()
  await depot.fermer()
})

function appeler(chemin: string, jeton: string, corps: unknown) {
  return app.request(`http://test${chemin}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
    body: JSON.stringify(corps),
  })
}

async function planActuel(): Promise<string> {
  const { rows } = await client.query('select plan from kaissi.subscriptions where organization_id = $1', [
    DEMO_ORG,
  ])
  return rows[0].plan as string
}

describe('POST /admin/editeur', () => {
  it('dit au back-office qui est éditeur — et qui ne l’est pas', async () => {
    expect(await (await appeler('/admin/editeur', 'jeton-editeur', {})).json()).toEqual({ editeur: true })
    expect(await (await appeler('/admin/editeur', 'jeton-client', {})).json()).toEqual({ editeur: false })
  })
})

describe('POST /admin/abonnement', () => {
  it('l’éditeur passe le client en Payant, puis en Gratuit', async () => {
    const pro = await appeler('/admin/abonnement', 'jeton-editeur', {
      restaurantId: DEMO_RESTO,
      formule: 'pro',
    })
    expect(pro.status).toBe(200)
    expect(await planActuel()).toBe('pro')

    const gratuit = await appeler('/admin/abonnement', 'jeton-editeur', {
      restaurantId: DEMO_RESTO,
      formule: 'gratuit',
    })
    expect(gratuit.status).toBe(200)
    expect(await planActuel()).toBe('gratuit')
  })

  it('un compte qui n’est pas éditeur est REFUSÉ, et rien ne change', async () => {
    await appeler('/admin/abonnement', 'jeton-editeur', { restaurantId: DEMO_RESTO, formule: 'gratuit' })
    const r = await appeler('/admin/abonnement', 'jeton-client', {
      restaurantId: DEMO_RESTO,
      formule: 'pro',
    })
    expect(r.status).toBe(401)
    expect(await planActuel()).toBe('gratuit')
  })

  it('refuse une formule inconnue — l’essai n’est plus proposé', async () => {
    const r = await appeler('/admin/abonnement', 'jeton-editeur', {
      restaurantId: DEMO_RESTO,
      formule: 'essai',
    })
    expect(r.status).toBe(401)
  })
})

describe('l’écran Éditeur — tous les clients', () => {
  it('liste les clients et leur formule — pour l’éditeur seulement', async () => {
    const r = await appeler('/admin/editeur/clients', 'jeton-editeur', {})
    expect(r.status).toBe(200)
    const { clients } = (await r.json()) as {
      clients: { organizationId: string; plan: string; etablissements: { nom: string }[] }[]
    }
    const demo = clients.find((c) => c.organizationId === DEMO_ORG)
    expect(demo, 'l’organisation de démonstration doit figurer').toBeDefined()
    expect(demo!.etablissements.length).toBeGreaterThan(0)

    const refus = await appeler('/admin/editeur/clients', 'jeton-client', {})
    expect(refus.status).toBe(401)
  })

  it('change la formule PAR ORGANISATION, sans être membre d’aucun restaurant', async () => {
    const r = await appeler('/admin/abonnement', 'jeton-editeur', {
      organizationId: DEMO_ORG,
      formule: 'pro',
    })
    expect(r.status).toBe(200)
    expect(await planActuel()).toBe('pro')
  })
})
