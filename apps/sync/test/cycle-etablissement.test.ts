/**
 * Fermer, rouvrir, supprimer un établissement.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 *
 * Deux gestes que TOUT oppose, et que l'interface doit empêcher de confondre :
 *
 *   • FERMER est réversible et garde tout. Son effet est volontairement
 *     étroit — aucun NOUVEL appairage — et c'est le seul qu'on puisse se
 *     permettre : refuser les envois d'un terminal déjà en service perdrait
 *     les ventes de la dernière soirée, celles qu'il n'a pas encore pu
 *     remonter. Un rejet ne se réessaie jamais tout seul.
 *
 *   • SUPPRIMER est définitif, et la BASE le refuse dès qu'une écriture
 *     comptable existe (`on delete restrict`, migrations 0004 et 0006). Ces
 *     tests vérifient que le service le dit AVANT le clic plutôt que de
 *     laisser remonter une violation de contrainte — laquelle ne nomme ni ce
 *     qui bloque, ni quoi faire à la place.
 *
 * ⚑ `restaurants.status` existait depuis la 0002 et n'était lu NULLE PART.
 *   Le basculer n'aurait rien changé. Ce fichier existe parce qu'un réglage
 *   qui ne fait rien est exactement ce que ce dépôt refuse.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { DEMO_ORG, DEMO_RESTO, URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const AUTH = { url: 'https://exemple.supabase.co', cleAnon: 'anon-de-test' }
const jetons = new Map<string, string>()
const MDP = 'unMotDePasseSolide12'

/** Supabase simulé : ces tests vérifient NOS décisions, pas les siennes. */
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
  // `/appairage` s'authentifie par mot de passe : on rend le compte demandé.
  if (url.includes('/auth/v1/token')) {
    const corps = JSON.parse(String(init?.body ?? '{}')) as { email?: string; password?: string }
    const compte = comptesParEmail.get(String(corps.email))
    if (!compte || corps.password !== MDP) {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ user: { id: compte, email: corps.email } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response('{}', { status: 500 })
}

const comptesParEmail = new Map<string, string>()

const app = creerServeur({
  depot,
  auth: AUTH,
  fetchAuth: fetchSimule,
  cleService: 'service-de-test',
})

const SUFFIXE = '@cycle-test.tn'
const crees: string[] = []

/** Un administrateur, avec un compte utilisable par `/appairage` aussi. */
async function acteur(role: string, restaurantId: string) {
  const compte = uuidV7()
  const employeId = uuidV7()
  const jeton = `jeton-${compte}`
  const email = `${employeId}${SUFFIXE}`
  await client.query('insert into auth.users (id) values ($1)', [compte])
  await client.query(
    `insert into kaissi.users (id, organization_id, auth_user_id, email, full_name)
     values ($1, $2, $3, $4, $5)`,
    [employeId, DEMO_ORG, compte, email, `Test ${role}`],
  )
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, $4)`,
    [DEMO_ORG, employeId, restaurantId, role],
  )
  jetons.set(jeton, compte)
  comptesParEmail.set(email, compte)
  return { jeton, employeId, email }
}

/** Un établissement neuf, vierge de toute vente. */
async function etablissementNeuf(nom: string): Promise<string> {
  const id = uuidV7()
  await client.query(
    `insert into kaissi.restaurants (id, organization_id, name, slug, timezone)
     values ($1, $2, $3, $4, 'Africa/Tunis')`,
    [id, DEMO_ORG, nom, `cycle-${id.slice(-8)}`],
  )
  crees.push(id)
  return id
}

const appeler = (chemin: string, jeton: string | null, corps: unknown) =>
  app.request(`http://test${chemin}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: JSON.stringify(corps),
  })

/**
 * Vérifie le statut ET rend le corps — en nommant l'erreur quand ça rate.
 *
 * `expect(r.status).toBe(409)` seul affiche « expected 500 to be 409 » et
 * laisse chercher dans les journaux du serveur. Le corps porte déjà le
 * message : le lire coûte une ligne et évite une demi-heure.
 */
async function attendre<T>(reponse: Response, statut: number): Promise<T> {
  const corps = (await reponse.json()) as T & { message?: string; erreur?: string }
  expect(
    reponse.status,
    `réponse ${reponse.status} : ${corps.erreur ?? ''} ${corps.message ?? ''}`,
  ).toBe(statut)
  return corps
}

let admin: Awaited<ReturnType<typeof acteur>>
let vierge: string

beforeAll(async () => {
  vierge = await etablissementNeuf('Snack Vierge')
  // Administrateur des DEUX : la suppression refuse le dernier établissement
  // administré, il en faut donc un second pour que le test porte sur autre
  // chose que ce refus-là.
  admin = await acteur('admin', DEMO_RESTO)
  await client.query(
    `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
     values ($1, $2, $3, 'admin')`,
    [DEMO_ORG, admin.employeId, vierge],
  )
})

beforeEach(async () => {
  // L'établissement de démonstration est partagé : on le rend toujours actif.
  await client.query(
    "update kaissi.restaurants set status = 'actif', closed_at = null where id = $1",
    [DEMO_RESTO],
  )
})

afterAll(async () => {
  await client.query(
    "update kaissi.restaurants set status = 'actif', closed_at = null where id = $1",
    [DEMO_RESTO],
  )
  for (const id of crees) {
    // Les ventes d'abord : elles référencent l'établissement en `restrict`,
    // et c'est précisément ce que les tests vérifient.
    await client.query('delete from kaissi.orders where restaurant_id = $1', [id])
    await client.query('delete from kaissi.memberships where restaurant_id = $1', [id])
    await client.query('delete from kaissi.devices where restaurant_id = $1', [id])
    await client.query('delete from kaissi.change_log where restaurant_id = $1', [id])
    await client.query('delete from kaissi.restaurants where id = $1', [id])
  }
  await client.query(`delete from kaissi.memberships where user_id in
    (select id from kaissi.users where email like '%${SUFFIXE}')`)
  await client.query(`delete from kaissi.users where email like '%${SUFFIXE}'`)
  await depot.fermer()
  await client.end()
})

describe('fermer un établissement', () => {
  it('coupe les NOUVEAUX appairages, avec la vraie raison', async () => {
    const avant = await app.request('http://test/appairage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: admin.email, motDePasse: MDP, restaurantId: DEMO_RESTO }),
    })
    expect(avant.status, 'ouvert, l’appairage doit passer').toBe(200)

    const r = await appeler('/admin/restaurants/statut', admin.jeton, {
      restaurantId: DEMO_RESTO,
      statut: 'ferme',
    })
    expect(r.status).toBe(200)

    const apres = await app.request('http://test/appairage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: admin.email, motDePasse: MDP, restaurantId: DEMO_RESTO }),
    })
    expect(apres.status).toBe(403)
    const corps = (await apres.json()) as { erreur: string; message: string }

    /*
     * Le CODE compte autant que le refus.
     *
     * `etablissement_refuse` dirait « ce compte n'est pas gérant de cet
     * établissement » — ce qui est faux, et enverrait l'administrateur
     * vérifier des appartenances parfaitement correctes pendant que la vraie
     * cause, une fermeture décidée la semaine dernière, reste invisible.
     */
    expect(corps.erreur).toBe('etablissement_ferme')
    expect(corps.message).toMatch(/ferm/i)
  })

  it('pose la DATE, et la retire à la réouverture', async () => {
    await appeler('/admin/restaurants/statut', admin.jeton, {
      restaurantId: DEMO_RESTO,
      statut: 'ferme',
    })
    const ferme = await client.query('select status, closed_at from kaissi.restaurants where id = $1', [
      DEMO_RESTO,
    ])
    expect(ferme.rows[0].status).toBe('ferme')
    expect(ferme.rows[0].closed_at).not.toBeNull()

    await appeler('/admin/restaurants/statut', admin.jeton, {
      restaurantId: DEMO_RESTO,
      statut: 'actif',
    })
    const rouvert = await client.query(
      'select status, closed_at from kaissi.restaurants where id = $1',
      [DEMO_RESTO],
    )
    expect(rouvert.rows[0].status).toBe('actif')
    // Un établissement rouvert qui garderait sa date ferait lire « fermé
    // depuis mars » sur un restaurant en service.
    expect(rouvert.rows[0].closed_at).toBeNull()
  })

  it('n’est pas ouvert à un GÉRANT', async () => {
    const gerant = await acteur('gerant', DEMO_RESTO)
    const r = await appeler('/admin/restaurants/statut', gerant.jeton, {
      restaurantId: DEMO_RESTO,
      statut: 'ferme',
    })
    expect(r.status).toBe(401)
    const { rows } = await client.query('select status from kaissi.restaurants where id = $1', [
      DEMO_RESTO,
    ])
    expect(rows[0].status, 'le refus doit être RÉEL, pas seulement affiché').toBe('actif')
  })

  it('n’est pas ouvert à l’administrateur d’un AUTRE établissement', async () => {
    /*
     * `etablissementsAdministres` dirait seulement qu'il administre quelque
     * chose. Sans relecture du rôle sur l'établissement VISÉ, l'administrateur
     * d'une chaîne pourrait fermer le restaurant d'une autre.
     */
    const autre = await etablissementNeuf('Snack Ailleurs')
    const etranger = await acteur('admin', autre)
    const r = await appeler('/admin/restaurants/statut', etranger.jeton, {
      restaurantId: DEMO_RESTO,
      statut: 'ferme',
    })
    expect(r.status).toBe(401)
  })
})

describe('supprimer un établissement', () => {
  /*
   * ⚑ AUCUN de ces tests ne vise l'établissement de DÉMONSTRATION.
   *
   * Et c'est une correction, pas une précaution de style : la première
   * version pointait la suppression sur `DEMO_RESTO` en supposant qu'il
   * portait des ventes. Sur une base de test FRAÎCHE il n'en a aucune — la
   * suppression aurait donc réussi, et emporté le restaurant dont dépendent
   * les trente autres fichiers de la suite. Un test qui détruit son propre
   * décor échoue ailleurs, sur un message qui ne le nomme pas.
   *
   * Chaque test fabrique donc son établissement et, quand il lui faut un
   * obstacle, il le pose lui-même.
   */

  /** Un établissement qu'on ne peut plus supprimer : il porte une écriture. */
  async function avecEcriture(nom: string): Promise<string> {
    const id = await etablissementNeuf(nom)
    await client.query(
      `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
       values ($1, $2, $3, 'admin')`,
      [DEMO_ORG, admin.employeId, id],
    )
    /*
     * Une VENTE — le cas représentatif, et le seul qu'un test puisse nettoyer.
     *
     * `audit_events` conviendrait tout aussi bien (même `on delete restrict`
     * depuis la 0006, et il bloque même un établissement qui n'a jamais
     * encaissé). Mais cette table est en INSERTION SEULE : le déclencheur
     * d'immuabilité refuse le DELETE même au propriétaire — c'est la RÈGLE 6,
     * et elle a fait échouer le ménage de ce fichier. Une trace d'audit posée
     * par un test resterait dans la base partagée pour toujours.
     */
    const appareil = uuidV7()
    await client.query(
      `insert into kaissi.devices
         (id, organization_id, restaurant_id, label, type, ticket_prefix, token_hash,
          app_version, protocol_version)
       values ($1, $2, $3, 'Terminal test', 'pos', 'TT', $4, '0.2.0', 1)`,
      [appareil, DEMO_ORG, id, `empreinte-${appareil}`],
    )
    await client.query(
      `insert into kaissi.orders
         (id, organization_id, restaurant_id, device_id, status, opened_at)
       values ($1, $2, $3, $4, 'close', now())`,
      [uuidV7(), DEMO_ORG, id, appareil],
    )
    return id
  }

  it('REFUSE dès qu’il y a une écriture, et dit quoi faire à la place', async () => {
    const bloque = await avecEcriture('Snack Bloqué')

    const r = await appeler('/admin/restaurants/supprimer', admin.jeton, {
      restaurantId: bloque,
      confirmation: 'Snack Bloqué',
    })
    const corps = await attendre<{ message: string }>(r, 409)
    expect(corps.message).toMatch(/comptable/i)
    // Le refus doit PROPOSER la fermeture, pas seulement dire non.
    expect(corps.message).toMatch(/Fermez/i)

    const { rows } = await client.query(
      'select count(*)::int as n from kaissi.restaurants where id = $1',
      [bloque],
    )
    expect(rows[0].n, 'le refus doit être RÉEL, pas seulement affiché').toBe(1)
  })

  it('compte les obstacles AVANT, pour pouvoir les nommer', async () => {
    const bloque = await avecEcriture('Snack Compté')

    const r = await appeler('/admin/restaurants/obstacles', admin.jeton, {
      restaurantId: bloque,
    })
    const corps = await attendre<{ ventes: number; appareils: number }>(r, 200)

    // `pg` rend `count(*)` en CHAÎNE : sans `Number()`, l'écran lirait « 0 »
    // comme une valeur vraie et annoncerait des ventes là où il n'y en a pas.
    expect(typeof corps.ventes).toBe('number')
    expect(corps.ventes, 'la vente posée doit être vue').toBe(1)
    expect(corps.appareils, 'l’appareil aussi — il sera révoqué').toBe(1)
  })

  it('exige le NOM EXACT retapé', async () => {
    const r = await appeler('/admin/restaurants/supprimer', admin.jeton, {
      restaurantId: vierge,
      confirmation: 'snack vierge',
    })
    const corps = await attendre<{ message: string }>(r, 401)
    expect(corps.message).toMatch(/retapez/i)

    const { rows } = await client.query(
      'select count(*)::int as n from kaissi.restaurants where id = $1',
      [vierge],
    )
    expect(rows[0].n, 'un nom approchant ne doit RIEN supprimer').toBe(1)
  })

  it('supprime un établissement VIERGE, et lui seul', async () => {
    const aSupprimer = await etablissementNeuf('Snack À Supprimer')
    await client.query(
      `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
       values ($1, $2, $3, 'admin')`,
      [DEMO_ORG, admin.employeId, aSupprimer],
    )

    const r = await appeler('/admin/restaurants/supprimer', admin.jeton, {
      restaurantId: aSupprimer,
      confirmation: 'Snack À Supprimer',
    })
    await attendre(r, 200)

    const parti = await client.query(
      'select count(*)::int as n from kaissi.restaurants where id = $1',
      [aSupprimer],
    )
    expect(parti.rows[0].n).toBe(0)

    // Et RIEN d'autre n'a bougé — surtout pas l'établissement de démonstration.
    const reste = await client.query(
      'select count(*)::int as n from kaissi.restaurants where id = $1',
      [DEMO_RESTO],
    )
    expect(reste.rows[0].n).toBe(1)
  })

  it('refuse le DERNIER établissement administré', async () => {
    /*
     * Le supprimer laisserait un compte qui ouvre sur rien, et sans moyen
     * d'en rouvrir un : l'ouverture d'un établissement exige un modèle
     * existant. C'est une impasse dont on ne sort pas depuis l'interface.
     */
    const seul = await etablissementNeuf('Snack Unique')
    const solitaire = await acteur('admin', seul)

    const r = await appeler('/admin/restaurants/supprimer', solitaire.jeton, {
      restaurantId: seul,
      confirmation: 'Snack Unique',
    })
    const corps = await attendre<{ message: string }>(r, 401)
    expect(corps.message).toMatch(/seul établissement/i)

    const { rows } = await client.query(
      'select count(*)::int as n from kaissi.restaurants where id = $1',
      [seul],
    )
    expect(rows[0].n).toBe(1)
  })
})
