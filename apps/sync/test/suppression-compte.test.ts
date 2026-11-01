/**
 * Supprimer SON PROPRE compte — routes `/compte/*`.
 *
 * ── Pourquoi cette fonction existe ────────────────────────────────────────
 *
 * Deux raisons, et la plus visible n'est pas la plus importante. La règle
 * 5.1.1(v) d'Apple exige qu'une application permettant de CRÉER un compte
 * permette de le supprimer DEPUIS l'application — une adresse e-mail à qui
 * écrire ne suffit pas, et c'est exactement ce que faisait Kaissi. Et le
 * droit à l'effacement, lui, ne dépend d'aucun magasin d'applications.
 *
 * ── Ce que ces tests protègent vraiment ───────────────────────────────────
 *
 * Trois choses qu'une suppression de façade raterait, et qu'on ne verrait
 * qu'en lisant la base des mois plus tard :
 *
 *   1. **La fiche employé doit être anonymisée.** Depuis la migration 0017,
 *      `kaissi.users` n'est plus un miroir de `auth.users` : la contrainte
 *      `users_id_fkey` a été retirée et `auth_user_id` est un lien
 *      FACULTATIF en `on delete set null`. Supprimer le compte Supabase
 *      laisserait donc le nom, l'adresse, le téléphone et le hachage du PIN
 *      parfaitement intacts. C'est LE piège de ce chantier.
 *   2. **Les ventes doivent rester.** Ce sont des écritures comptables
 *      (règle 6) : elles ne se suppriment pas. Elles perdent le nom, pas la
 *      ligne — c'est ce qui fait tenir ensemble le droit à l'effacement et
 *      l'immuabilité du journal.
 *   3. **On ne part pas en laissant un établissement sans administrateur.**
 *      Personne ne pourrait plus y ouvrir d'accès, et c'est irréparable
 *      sans intervention de l'éditeur.
 *
 * Supabase est simulé : ces tests vérifient NOS décisions, pas les siennes.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { creerAppareil, DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const AUTH = { url: 'https://exemple.supabase.co', cleAnon: 'anon-de-test' }
const CLE_SERVICE = 'service-de-test'
const MOT_DE_PASSE = 'un-mot-de-passe-honnete'

/** Comptes d'authentification simulés : adresse → identifiant. */
const comptes = new Map<string, string>()
/** Les identifiants dont Supabase a réellement reçu l'ordre de suppression. */
let supprimesChezSupabase: string[] = []

const fetchSimule: typeof fetch = async (entree, init) => {
  const url = String(entree)
  const json = (corps: unknown, statut = 200) =>
    new Response(JSON.stringify(corps), {
      status: statut,
      headers: { 'content-type': 'application/json' },
    })

  if (url.includes('/auth/v1/token')) {
    const corps = JSON.parse(String(init?.body)) as { email: string; password: string }
    const id = comptes.get(corps.email)
    if (!id || corps.password !== MOT_DE_PASSE) return json({ msg: 'invalid' }, 400)
    return json({ user: { id, email: corps.email } })
  }

  if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') {
    supprimesChezSupabase.push(url.split('/').pop()!)
    return json({})
  }

  return json({ message: 'route non simulée' }, 500)
}

const app = creerServeur({ depot, auth: AUTH, fetchAuth: fetchSimule, cleService: CLE_SERVICE })

function poste(chemin: string, corps: unknown) {
  return app.request(`http://test${chemin}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Une adresse distincte par appel : les limites de débit de
      // `/appairage` s'appliquent ici aussi, et quinze scénarios qui
      // partagent une IP finiraient par se faire éconduire.
      'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify(corps),
  })
}

/**
 * Un compte complet : identité Supabase simulée, fiche employé, et une
 * appartenance par établissement demandé.
 */
async function compte(
  role: string,
  restaurants: string[] = [DEMO_RESTO],
): Promise<{ email: string; authId: string; employeId: string }> {
  const authId = uuidV7()
  const employeId = uuidV7()
  const email = `${employeId}@suppression-test.tn`
  comptes.set(email, authId)
  await client.query('insert into auth.users (id) values ($1)', [authId])
  await client.query(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name, phone, pin_hash)
     values ($1, $2, $3, $4, $5, '+21698000000', 'argon2id$peu-importe')`,
    [employeId, DEMO_ORG, authId, email, `Personne ${role}`],
  )
  for (const restaurantId of restaurants) {
    await client.query(
      `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
       values ($1, $2, $3, $4)`,
      [DEMO_ORG, employeId, restaurantId, role],
    )
  }
  return { email, authId, employeId }
}

/** Un second établissement, pour les scénarios à plusieurs. */
async function autreEtablissement(): Promise<string> {
  const id = uuidV7()
  await client.query(
    `insert into kaissi.restaurants (id, organization_id, name, slug, timezone)
     values ($1, $2, $3, $4, 'Africa/Tunis')`,
    [id, DEMO_ORG, `Resto ${id.slice(-8)}`, `resto-${id}`],
  )
  return id
}

beforeEach(() => {
  supprimesChezSupabase = []
})

afterAll(async () => {
  await depot.fermer()
  await client.end()
})

describe('aperçu — ce que la suppression emporterait', () => {
  it('rend les établissements, le rôle, et ne bloque pas un gérant', async () => {
    const moi = await compte('gerant')
    const reponse = await poste('/compte/apercu-suppression', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
    })
    expect(reponse.status).toBe(200)
    const corps = (await reponse.json()) as {
      etablissements: { nom: string; role: string; seulAdmin: boolean }[]
      bloquants: string[]
    }
    expect(corps.etablissements).toHaveLength(1)
    expect(corps.etablissements[0]!.role).toBe('gerant')
    expect(corps.etablissements[0]!.seulAdmin).toBe(false)
    expect(corps.bloquants).toEqual([])
  })

  it('NOMME l’établissement dont on est le seul administrateur', async () => {
    const seul = await autreEtablissement()
    const moi = await compte('admin', [seul])
    const reponse = await poste('/compte/apercu-suppression', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
    })
    const corps = (await reponse.json()) as { bloquants: string[] }
    expect(corps.bloquants).toHaveLength(1)
    expect(corps.bloquants[0]).toMatch(/^Resto /)
  })

  it('ne bloque PAS quand un autre administrateur reste', async () => {
    const partage = await autreEtablissement()
    await compte('admin', [partage])
    const moi = await compte('admin', [partage])
    const reponse = await poste('/compte/apercu-suppression', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
    })
    const corps = (await reponse.json()) as { bloquants: string[] }
    expect(corps.bloquants).toEqual([])
  })

  it('refuse un mot de passe faux, sans dire si l’adresse existe', async () => {
    const moi = await compte('gerant')
    const reponse = await poste('/compte/apercu-suppression', {
      email: moi.email,
      motDePasse: 'pas-le-bon-mot-de-passe',
    })
    expect(reponse.status).toBe(401)
    const corps = (await reponse.json()) as { message: string }
    expect(corps.message).toContain('E-mail ou mot de passe incorrect')
  })
})

describe('suppression', () => {
  it('efface l’identité, garde la fiche, et supprime le compte Supabase', async () => {
    const moi = await compte('gerant')

    const reponse = await poste('/compte/supprimer', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
      confirmation: moi.email,
    })
    expect(reponse.status).toBe(200)

    // 1. Le compte d'authentification a bien reçu l'ordre.
    expect(supprimesChezSupabase).toEqual([moi.authId])

    // 2. La fiche employé est ANONYMISÉE — c'est le piège de la 0017 : sans
    //    cette étape, le nom, l'adresse, le téléphone et le PIN seraient
    //    restés en base après une « suppression de compte ».
    const { rows } = await client.query<{
      auth_user_id: string | null
      email: string | null
      full_name: string
      phone: string | null
      pin_hash: string | null
      status: string
      archived_at: string | null
    }>(
      `select auth_user_id, email, full_name, phone, pin_hash, status, archived_at
         from kaissi.users where id = $1`,
      [moi.employeId],
    )
    expect(rows).toHaveLength(1)
    const fiche = rows[0]!
    expect(fiche.auth_user_id).toBeNull()
    expect(fiche.email).toBeNull()
    expect(fiche.phone).toBeNull()
    expect(fiche.pin_hash).toBeNull()
    expect(fiche.full_name).not.toContain('Personne')
    expect(fiche.status).toBe('parti')
    expect(fiche.archived_at).not.toBeNull()

    // 3. Les appartenances sont parties : le compte n'ouvre plus rien.
    const { rows: appartenances } = await client.query(
      'select 1 from kaissi.memberships where user_id = $1',
      [moi.employeId],
    )
    expect(appartenances).toHaveLength(0)
  })

  it('GARDE les ventes encaissées — ce sont des écritures comptables', async () => {
    const moi = await compte('gerant')
    const appareil = await creerAppareil(`V${Math.floor(Math.random() * 900) + 100}`)
    const orderId = uuidV7()
    await client.query(
      `insert into kaissi.orders
         (id, organization_id, restaurant_id, device_id, ticket_number, status,
          opened_by, closed_by, total_millimes, opened_at)
       values ($1, $2, $3, $4, $5, 'close', $6, $6, $7, now())`,
      [
        orderId,
        DEMO_ORG,
        DEMO_RESTO,
        appareil.id,
        `S-${orderId.slice(0, 8)}`,
        moi.employeId,
        millimes(12_500),
      ],
    )

    const apercu = await poste('/compte/apercu-suppression', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
    })
    expect(((await apercu.json()) as { ventes: number }).ventes).toBe(1)

    const reponse = await poste('/compte/supprimer', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
      confirmation: moi.email,
    })
    expect(reponse.status).toBe(200)
    expect(((await reponse.json()) as { message: string }).message).toContain('1 vente')

    // La vente est là, intacte, et son montant n'a pas bougé.
    const { rows } = await client.query<{ total_millimes: string; opened_by: string | null }>(
      'select total_millimes, opened_by from kaissi.orders where id = $1',
      [orderId],
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.total_millimes)).toBe(12_500)
    // L'acteur reste le MÊME identifiant : la fiche a été anonymisée, pas
    // supprimée. C'est ce qui relie encore entre eux les actes d'une même
    // personne devenue anonyme, sans la nommer.
    expect(rows[0]!.opened_by).toBe(moi.employeId)
  })

  it('REFUSE si l’on est le dernier administrateur, et dit quoi faire', async () => {
    const seul = await autreEtablissement()
    const moi = await compte('admin', [seul])

    const reponse = await poste('/compte/supprimer', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
      confirmation: moi.email,
    })
    expect(reponse.status).toBe(409)
    const corps = (await reponse.json()) as { erreur: string; message: string }
    expect(corps.erreur).toBe('suppression_refusee')
    expect(corps.message).toContain('seul administrateur')
    expect(corps.message).toContain('Nommez un autre administrateur')

    // Rien n'a bougé : ni Supabase, ni la fiche.
    expect(supprimesChezSupabase).toEqual([])
    const { rows } = await client.query<{ auth_user_id: string | null }>(
      'select auth_user_id from kaissi.users where id = $1',
      [moi.employeId],
    )
    expect(rows[0]!.auth_user_id).toBe(moi.authId)
  })

  it('REFUSE si l’adresse de confirmation ne correspond pas', async () => {
    const moi = await compte('gerant')
    const reponse = await poste('/compte/supprimer', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
      confirmation: 'quelqu-un-d-autre@exemple.tn',
    })
    expect(reponse.status).toBe(401)
    expect(supprimesChezSupabase).toEqual([])
  })

  it('est REJOUABLE : la seconde tentative ne casse rien', async () => {
    const moi = await compte('gerant')
    const premier = await poste('/compte/supprimer', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
      confirmation: moi.email,
    })
    expect(premier.status).toBe(200)

    /*
     * Le compte d'authentification n'existe plus : la connexion échoue, donc
     * la route répond 401. C'est le comportement voulu — ce qu'on vérifie
     * ici, c'est qu'elle ne provoque NI une erreur 500, NI une seconde
     * anonymisation qui écraserait des données d'un autre.
     */
    comptes.delete(moi.email)
    const second = await poste('/compte/supprimer', {
      email: moi.email,
      motDePasse: MOT_DE_PASSE,
      confirmation: moi.email,
    })
    expect(second.status).toBe(401)
  })
})

describe('sans clé de service', () => {
  it('répond 501 et le dit, plutôt que d’échouer en silence', async () => {
    const sansCle = creerServeur({
      depot,
      auth: AUTH,
      fetchAuth: fetchSimule,
      cleService: null,
    })
    const reponse = await sansCle.request('http://test/compte/supprimer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
      body: JSON.stringify({ email: 'a@b.tn', motDePasse: MOT_DE_PASSE, confirmation: 'a@b.tn' }),
    })
    expect(reponse.status).toBe(501)
    const corps = (await reponse.json()) as { erreur: string }
    expect(corps.erreur).toBe('administration_indisponible')
  })
})
