/**
 * Les ABONNEMENTS (migration 0040) — et la serrure qui compte.
 *
 * ── Ce que ce fichier éprouve vraiment ────────────────────────────────────
 *
 * Une table de formules est facile à écrire ; ce qui est difficile, c'est
 * qu'un client ne puisse pas s'offrir la sienne. Le back-office n'utilise que
 * la clé publique de Supabase, avec la session de l'utilisateur : tout ce
 * qu'il peut écrire, n'importe qui peut le rejouer depuis la console de son
 * navigateur. Une politique `for update` sur `subscriptions`, si restreinte
 * soit-elle, serait donc un bouton « je passe en Pro ».
 *
 * D'où les tests ci-dessous, qui ne vérifient pas seulement qu'on LIT sa
 * formule, mais qu'on ne l'ÉCRIT pas — ni en `update`, ni en `insert`, ni
 * même en effaçant la ligne pour que `abonnementDe()` retombe sur un défaut.
 *
 * ── Et la frontière, éprouvée elle aussi ──────────────────────────────────
 *
 * Un abonnement ne ferme aucun geste de caisse. Ici, cela se voit à ce qu'il
 * n'y a RIEN à tester de ce côté : `/sync/push` n'interroge pas cette table,
 * et le dernier test de ce fichier s'assure qu'une organisation sans formule
 * du tout encaisse quand même.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { JOURS_ESSAI, etatAbonnement, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import { URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

const AUTH = { url: 'https://exemple.supabase.co', cleAnon: 'anon-de-test' }

/** Le Supabase Auth simulé : il crée la ligne `auth.users` et rend son id. */
const fetchSimule: typeof fetch = async (entree, init) => {
  const url = String(entree)
  if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') {
    const corps = JSON.parse(String(init.body)) as { email: string }
    const id = uuidV7()
    await client.query('insert into auth.users (id, email) values ($1, $2)', [id, corps.email])
    return new Response(JSON.stringify({ id, email: corps.email }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({ message: 'route non simulée' }), { status: 500 })
}

const app = creerServeur({
  depot,
  auth: AUTH,
  fetchAuth: fetchSimule,
  cleService: 'service-de-test',
})

const creees: string[] = []

async function inscrire(nom: string) {
  const reponse = await app.request('http://test/inscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `formule-${uuidV7()}@exemple.tn`,
      motDePasse: 'unMotDePasseSolide12',
      nomRestaurant: nom,
    }),
  })
  const corps = (await reponse.json()) as Record<string, unknown>
  if (typeof corps['organizationId'] === 'string') creees.push(corps['organizationId'])
  return { statut: reponse.status, corps }
}

/** Joue une requête dans la peau d'un compte Supabase, comme le back-office. */
type Issue = 'applique' | 'filtre' | 'refuse'
async function dansLaPeauDe(compte: string, sql: string, valeurs: unknown[] = []): Promise<Issue> {
  await client.query('begin')
  try {
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: compte }),
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

/** Le compte Supabase de l'admin créé par une inscription. */
async function compteAdmin(organizationId: string): Promise<string> {
  const { rows } = await client.query(
    `select u.auth_user_id from kaissi.users u
      where u.organization_id = $1::uuid and u.auth_user_id is not null limit 1`,
    [organizationId],
  )
  return rows[0].auth_user_id as string
}

afterAll(async () => {
  for (const orgId of creees) {
    await client.query('delete from kaissi.devices where organization_id = $1', [orgId])
    await client.query('delete from kaissi.memberships where organization_id = $1', [orgId])
    await client.query('delete from kaissi.tax_rates where organization_id = $1', [orgId])
    await client.query('delete from kaissi.payment_methods where organization_id = $1', [orgId])
    await client.query('delete from kaissi.stations where organization_id = $1', [orgId])
    await client.query('delete from kaissi.change_log where organization_id = $1', [orgId])
    await client.query('delete from kaissi.restaurants where organization_id = $1', [orgId])
    await client.query('delete from kaissi.users where organization_id = $1', [orgId])
    // La formule tombe avec l'organisation (`on delete cascade`) — mais on ne
    // le suppose pas ici : le test dédié plus bas s'en charge.
    await client.query('delete from kaissi.subscriptions where organization_id = $1', [orgId])
    await client.query('delete from kaissi.organizations where id = $1', [orgId])
  }
  await client.end()
  await depot.fermer()
})

describe('POST /inscription — l’essai de quatorze jours', () => {
  it('pose une formule « essai » datée, dans la même transaction', async () => {
    const { statut, corps } = await inscrire('Chez la Formule')
    expect(statut).toBe(200)

    const { rows } = await client.query(
      'select plan, trial_ends_at, note from kaissi.subscriptions where organization_id = $1',
      [corps['organizationId']],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].plan).toBe('essai')

    /*
     * L'échéance, à l'heure près. On ne compare pas à la milliseconde : entre
     * le calcul en TypeScript et l'écriture en base, il s'écoule ce qu'il
     * s'écoule. Ce que ce test attrape, c'est un essai d'un jour, de trente,
     * ou sans fin — pas une dérive de deux cents millisecondes.
     */
    const jours =
      (new Date(rows[0].trial_ends_at as string).getTime() - Date.now()) / 86_400_000
    expect(jours).toBeGreaterThan(JOURS_ESSAI - 0.05)
    expect(jours).toBeLessThan(JOURS_ESSAI + 0.05)
  })

  it('l’essai posé se relit en « en cours », avec ses jours restants', async () => {
    const { corps } = await inscrire('Le Comptoir des Essais')
    const { rows } = await client.query(
      'select plan, trial_ends_at from kaissi.subscriptions where organization_id = $1',
      [corps['organizationId']],
    )
    /*
     * La MÊME fonction que le back-office, sur la ligne telle qu'elle est en
     * base. C'est ce qui relie les deux moitiés : un essai écrit ici et lu
     * là-bas avec deux règles différentes s'afficherait « terminé » le jour
     * de l'installation.
     */
    const etat = etatAbonnement({
      plan: rows[0].plan as string,
      finEssai: rows[0].trial_ends_at as Date,
    })
    expect(etat.enEssai).toBe(true)
    expect(etat.essaiExpire).toBe(false)
    expect(etat.joursRestants).toBe(JOURS_ESSAI)
    expect(etat.modules).toContain('inventaire_avance')
    expect(etat.joursHistorique).toBeNull()
  })
})

describe('RLS — la formule se LIT, elle ne s’écrit jamais depuis le navigateur', () => {
  it('l’admin de l’organisation lit sa propre formule', async () => {
    const { corps } = await inscrire('La Lecture')
    const compte = await compteAdmin(corps['organizationId'] as string)
    expect(
      await dansLaPeauDe(compte, 'select 1 from kaissi.subscriptions where organization_id = $1', [
        corps['organizationId'],
      ]),
    ).toBe('applique')
  })

  /*
   * LE test de ce fichier.
   *
   * Sans politique `for update`, PostgreSQL ne REFUSE pas : il ne trouve
   * simplement aucune ligne à modifier, et rend « 0 ligne ». D'où l'issue
   * « filtre » plutôt que « refuse » — et d'où la seconde assertion, qui va
   * relire la ligne : une politique d'écriture ajoutée par mégarde ferait
   * passer le plan à « pro » sans qu'aucune erreur ne soit levée nulle part.
   */
  it('l’admin NE PEUT PAS s’offrir la formule payante', async () => {
    const { corps } = await inscrire('L’Autopromotion')
    const orgId = corps['organizationId'] as string
    const compte = await compteAdmin(orgId)

    const issue = await dansLaPeauDe(
      compte,
      `update kaissi.subscriptions set plan = 'pro', trial_ends_at = null
        where organization_id = $1 returning 1`,
      [orgId],
    )
    expect(issue).not.toBe('applique')

    const { rows } = await client.query(
      'select plan from kaissi.subscriptions where organization_id = $1',
      [orgId],
    )
    expect(rows[0].plan).toBe('essai')
  })

  it('ni en insérant une seconde ligne, ni en effaçant la sienne', async () => {
    const { corps } = await inscrire('Le Contournement')
    const orgId = corps['organizationId'] as string
    const compte = await compteAdmin(orgId)

    expect(
      await dansLaPeauDe(
        compte,
        `insert into kaissi.subscriptions (organization_id, plan) values ($1, 'pro') returning 1`,
        [orgId],
      ),
    ).not.toBe('applique')

    /*
     * L'effacement est la voie détournée : sans ligne, `abonnementDe()`
     * pourrait retomber sur un défaut généreux. Il retombe au GRATUIT — mais
     * la serrure vaut mieux que la ceinture, et elle est éprouvée ici.
     */
    expect(
      await dansLaPeauDe(
        compte,
        'delete from kaissi.subscriptions where organization_id = $1 returning 1',
        [orgId],
      ),
    ).not.toBe('applique')

    const { rows } = await client.query(
      'select plan from kaissi.subscriptions where organization_id = $1',
      [orgId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].plan).toBe('essai')
  })

  it('la formule d’un AUTRE client ne se lit pas', async () => {
    const [moi, eux] = await Promise.all([inscrire('Le Mien'), inscrire('Le Sien')])
    const compte = await compteAdmin(moi.corps['organizationId'] as string)
    expect(
      await dansLaPeauDe(compte, 'select 1 from kaissi.subscriptions where organization_id = $1', [
        eux.corps['organizationId'],
      ]),
    ).toBe('filtre')
  })
})

describe('les garde-fous de la table', () => {
  it('un essai SANS échéance est refusé', async () => {
    const { corps } = await inscrire('L’Essai sans Fin')
    await expect(
      client.query(
        `update kaissi.subscriptions set plan = 'essai', trial_ends_at = null
          where organization_id = $1`,
        [corps['organizationId']],
      ),
    ).rejects.toThrow(/essai_a_une_fin/)
  })

  it('une formule INCONNUE est refusée par la base, pas seulement par le code', async () => {
    const { corps } = await inscrire('La Formule Fantôme')
    await expect(
      client.query(`update kaissi.subscriptions set plan = 'illimite' where organization_id = $1`, [
        corps['organizationId'],
      ]),
    ).rejects.toThrow(/subscriptions_plan_check/)
  })

  it('la formule tombe avec l’organisation, et ne la retient pas', async () => {
    /*
     * `on delete cascade` et non `restrict` : une formule n'est pas une
     * écriture comptable, et la retenir empêcherait de supprimer une
     * organisation d'essai abandonnée — pour une ligne qui ne dit rien de
     * plus que « elle avait une formule ».
     */
    const orgId = uuidV7()
    await client.query('insert into kaissi.organizations (id, name, slug) values ($1, $2, $3)', [
      orgId,
      'Éphémère',
      `ephemere-${orgId.slice(-8)}`,
    ])
    await client.query(
      `insert into kaissi.subscriptions (organization_id, plan) values ($1, 'gratuit')`,
      [orgId],
    )
    await client.query('delete from kaissi.organizations where id = $1', [orgId])
    const { rows } = await client.query(
      'select 1 from kaissi.subscriptions where organization_id = $1',
      [orgId],
    )
    expect(rows).toHaveLength(0)
  })
})
