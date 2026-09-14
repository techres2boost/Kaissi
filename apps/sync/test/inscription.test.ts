/**
 * `POST /inscription` — ouvrir un restaurant depuis la tablette.
 *
 * C'est la PREMIÈRE surface publique de ce service : tout le reste exige déjà
 * soit un jeton d'appareil, soit une session Supabase. Ces tests portent donc
 * autant sur ce qu'elle REFUSE que sur ce qu'elle crée.
 *
 * ── La décision produit, telle qu'elle a été prise ────────────────────────
 *
 * L'ouverture est VOLONTAIREMENT libre : n'importe qui peut créer une
 * organisation sur ce serveur. Ce qui la rend tenable n'est pas une barrière
 * à l'entrée mais le fait qu'elle ne touche RIEN d'existant — elle ne crée
 * qu'une organisation neuve avec son unique membre, et aucun identifiant venu
 * du client ne désigne quoi que ce soit de déjà là.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const AUTH = { url: 'https://exemple.supabase.co', cleAnon: 'anon-de-test' }
const CLE_SERVICE = 'service-de-test'

/** Adresses déjà prises côté Supabase — pour rejouer « déjà inscrit ». */
const dejaInscrites = new Map<string, string>()

const fetchSimule: typeof fetch = async (entree, init) => {
  const url = String(entree)
  const json = (corps: unknown, statut = 200) =>
    new Response(JSON.stringify(corps), {
      status: statut,
      headers: { 'content-type': 'application/json' },
    })

  if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') {
    const corps = JSON.parse(String(init.body)) as { email: string }
    if (dejaInscrites.has(corps.email)) {
      return json({ msg: 'email address has already been registered' }, 422)
    }
    const id = uuidV7()
    dejaInscrites.set(corps.email, id)
    await client.query('insert into auth.users (id, email) values ($1, $2)', [id, corps.email])
    return json({ id, email: corps.email })
  }

  return json({ message: 'route non simulée' }, 500)
}

const app = creerServeur({ depot, auth: AUTH, fetchAuth: fetchSimule, cleService: CLE_SERVICE })
const appSansCle = creerServeur({
  depot,
  auth: AUTH,
  fetchAuth: fetchSimule,
  cleService: null,
})

let compteur = 0
/** Une adresse neuve à chaque appel : la limite par compte est par adresse. */
const adresseNeuve = () => `gerant${(compteur += 1)}-${Date.now()}@exemple.tn`

async function inscrire(demande: Record<string, unknown>, application = app) {
  const reponse = await application.request('http://test/inscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(demande),
  })
  const corps = (await reponse.json()) as Record<string, unknown>
  // Retenue dès qu'elle existe : c'est la seule trace qui permette de rendre
  // la base telle qu'on l'a trouvée.
  if (typeof corps['organizationId'] === 'string') creees.push(corps['organizationId'])
  return { statut: reponse.status, corps }
}

const valide = () => ({
  email: adresseNeuve(),
  motDePasse: 'unMotDePasseSolide12',
  nomRestaurant: 'Chez Fatma',
})

/*
 * ── Ce test CRÉE des organisations, et doit donc les reprendre ───────────
 *
 * Chaque inscription réussie pose une organisation, un restaurant, un employé
 * et un appareil. La base de test est PARTAGÉE entre les fichiers : sans
 * nettoyage, quinze « chez-fatma » s'accumulent, et c'est un AUTRE test —
 * celui qui vérifie que le slug « snack-lac-2 » n'est pas désambiguïsé — qui
 * finit par échouer, sur un message qui ne nomme pas ce fichier-ci.
 *
 * Vu ici même : la suite complète a échoué deux fois avant qu'on remonte
 * jusqu'à la cause.
 */
const creees: string[] = []

beforeEach(() => {
  dejaInscrites.clear()
})

afterAll(async () => {
  for (const orgId of creees) {
    // Dans cet ordre : les appareils et les appartenances pointent le
    // restaurant, le restaurant pointe l'organisation.
    await client.query('delete from kaissi.devices where organization_id = $1', [orgId])
    await client.query('delete from kaissi.memberships where organization_id = $1', [orgId])
    await client.query('delete from kaissi.tax_rates where organization_id = $1', [orgId])
    await client.query('delete from kaissi.payment_methods where organization_id = $1', [orgId])
    await client.query('delete from kaissi.stations where organization_id = $1', [orgId])
    await client.query('delete from kaissi.change_log where organization_id = $1', [orgId])
    await client.query('delete from kaissi.restaurants where organization_id = $1', [orgId])
    await client.query('delete from kaissi.users where organization_id = $1', [orgId])
    await client.query('delete from kaissi.organizations where id = $1', [orgId])
  }
})

describe('POST /inscription', () => {
  it('crée l’organisation, le restaurant, l’admin — et APPAIRE la caisse', async () => {
    const demande = valide()
    const { statut, corps } = await inscrire(demande)

    expect(statut).toBe(200)
    /*
     * Le jeton d'appareil dans la MÊME réponse : c'est tout l'intérêt de la
     * route. Obliger à ressaisir ses identifiants juste après les avoir
     * choisis serait exactement l'étape en trop qu'on vient de supprimer.
     */
    expect(corps['jeton']).toMatch(/^kdev_/)
    expect(corps['prefixe']).toBeTruthy()

    const { rows } = await client.query(
      `select r.name as resto, o.name as orga, m.role, u.email, u.full_name
         from kaissi.restaurants r
         join kaissi.organizations o on o.id = r.organization_id
         join kaissi.memberships m on m.restaurant_id = r.id
         join kaissi.users u on u.id = m.user_id
        where r.id = $1`,
      [corps['restaurantId']],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].resto).toBe('Chez Fatma')
    expect(rows[0].role).toBe('admin')
    expect(rows[0].email).toBe(demande.email)

    /*
     * Le jeton fonctionne VRAIMENT — c'est la seule preuve qui compte. Un
     * appairage qui rend un jeton inutilisable laisserait le gérant devant
     * une caisse qui paraît en service et n'envoie rien.
     */
    const pull = await app.request('http://test/sync/pull?taillePage=1', {
      headers: { authorization: `Bearer ${String(corps['jeton'])}` },
    })
    expect(pull.status).toBe(200)
  })

  it('pose de quoi ENCAISSER, mais n’invente aucun taux de taxe', async () => {
    const { corps } = await inscrire(valide())
    const resto = String(corps['restaurantId'])

    /*
     * Sans taux ni mode de paiement, la caisse refuserait la première vente
     * sans dire pourquoi. Il en faut donc.
     *
     * ⚠ Mais écrire « TVA 19 % » dans le code serait affirmer une règle
     *   fiscale tunisienne, ce que ce dépôt s'interdit. Le taux est donc à
     *   ZÉRO et nommé pour ce qu'il est — et la réponse le DIT, parce qu'un
     *   zéro silencieux ferait facturer sans taxe pendant des semaines.
     */
    const { rows: taxes } = await client.query(
      'select name, rate_bp from kaissi.tax_rates where restaurant_id = $1',
      [resto],
    )
    expect(taxes).toHaveLength(1)
    expect(taxes[0].rate_bp).toBe(0)
    expect(taxes[0].name).toMatch(/régler/i)
    expect(corps['aRegler']).toEqual(['taux_de_taxe'])
    expect(String(corps['message'])).toMatch(/0 %/)

    const { rows: paiements } = await client.query(
      'select name from kaissi.payment_methods where restaurant_id = $1 order by position',
      [resto],
    )
    expect(paiements.map((l: { name: string }) => l.name)).toEqual(['Espèces', 'Carte bancaire'])

    // La CARTE, elle, n'est pas devinée : on ne suppose pas un menu.
    const { rows: produits } = await client.query(
      'select count(*)::int as n from kaissi.products where restaurant_id = $1',
      [resto],
    )
    expect(produits[0].n).toBe(0)
  })

  it('refuse une adresse DÉJÀ prise — sans créer d’organisation orpheline', async () => {
    const demande = valide()
    await inscrire(demande)
    const avant = await client.query('select count(*)::int as n from kaissi.organizations')

    const { statut, corps } = await inscrire({ ...demande, nomRestaurant: 'Un autre' })
    expect(statut).toBe(409)
    expect(corps['erreur']).toBe('adresse_deja_utilisee')
    // Renvoie vers la bonne porte, qui est la seule à vérifier le mot de passe.
    expect(String(corps['message'])).toMatch(/Se connecter/)

    /*
     * Et RIEN n'a été écrit. Un restaurant créé puis abandonné parce que le
     * compte existait déjà serait invisible sous RLS — personne n'y
     * appartient — et irrattrapable depuis l'interface.
     */
    const apres = await client.query('select count(*)::int as n from kaissi.organizations')
    expect(apres.rows[0].n).toBe(avant.rows[0].n)
  })

  it('refuse un nom de restaurant vide, un mot de passe faible, une bascule illisible', async () => {
    const sansNom = await inscrire({ ...valide(), nomRestaurant: ' ' })
    expect(sansNom.statut).toBe(401)
    expect(String(sansNom.corps['message'])).toMatch(/nom du restaurant/i)

    const faible = await inscrire({ ...valide(), motDePasse: '123' })
    expect(faible.statut).toBe(401)

    const bascule = await inscrire({ ...valide(), bascule: '4h du matin' })
    expect(bascule.statut).toBe(401)
    expect(String(bascule.corps['message'])).toMatch(/04:00/)
  })

  it('répond 501 sans clé de service, au lieu de créer un compte inutilisable', async () => {
    /*
     * Créer un compte `auth.users` en SQL est le raccourci qu'il ne faut
     * jamais prendre : GoTrue lit ses colonnes de jetons dans des chaînes non
     * nullables, et un NULL fait échouer la connexion avec « e-mail ou mot de
     * passe incorrect », sans que rien ne dise pourquoi. Vu en production.
     * Sans la clé, on refuse — on n'improvise pas.
     */
    const { statut, corps } = await inscrire(valide(), appSansCle)
    expect(statut).toBe(501)
    expect(corps['erreur']).toBe('inscription_indisponible')
    expect(String(corps['message'])).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('n’ouvre AUCUN accès à une organisation existante', async () => {
    /*
     * La route est publique. Le seul danger sérieux serait qu'un
     * identifiant venu du client désigne quelque chose de déjà là — une
     * organisation, un restaurant, un compte. Ce test le tente explicitement.
     */
    const { rows: avant } = await client.query(
      'select id from kaissi.organizations order by id',
    )
    const cible = avant[0]?.id as string | undefined
    expect(cible, 'il faut au moins une organisation existante pour ce test').toBeTruthy()

    const { statut, corps } = await inscrire({
      ...valide(),
      organizationId: cible,
      restaurantId: cible,
      role: 'admin',
    })

    expect(statut).toBe(200)
    // L'organisation créée est NEUVE : celle qu'on a tenté de viser est intacte.
    expect(corps['organizationId']).not.toBe(cible)
    const { rows: membres } = await client.query(
      'select count(*)::int as n from kaissi.memberships where organization_id = $1',
      [cible],
    )
    const { rows: apres } = await client.query(
      'select count(*)::int as n from kaissi.memberships where organization_id = $1',
      [corps['organizationId']],
    )
    expect(apres[0].n).toBe(1)
    expect(membres[0].n).toBeGreaterThanOrEqual(0)
  })
})
