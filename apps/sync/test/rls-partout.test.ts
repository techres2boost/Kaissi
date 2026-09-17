/**
 * La garde qui manquait : AUCUNE table du schéma `kaissi` sans RLS.
 *
 * ── Pourquoi une garde, alors que la règle est écrite ─────────────────────
 *
 * CLAUDE.md l'exige depuis le début — « chaque migration qui crée une table
 * doit activer RLS dans le même fichier » — et `kaissi.protege_referentiel()`
 * comme `protege_transactionnel()` la tiennent pour les tables qu'elles
 * créent. Mais elles s'articulent toutes deux sur `restaurant_id`, et trois
 * tables au moins ne l'ont pas : `audit_events`, `subscriptions`,
 * `organizations`. Celles-là écrivent leurs politiques À LA MAIN.
 *
 * Or une table sans RLS ne casse RIEN. Elle rend simplement les lignes de
 * tous les clients à quiconque a une session, et rien dans le code ni dans
 * les tests ne le signale : la page s'affiche, les chiffres s'affichent, et
 * ce sont ceux du voisin. C'est la panne la plus grave que ce produit puisse
 * avoir, et la seule qui ne se voie pas.
 *
 * Ce fichier balaie donc le catalogue de PostgreSQL lui-même. Il ne relit pas
 * les migrations — il regarde l'état RÉEL de la base, après application de
 * toutes les migrations de production, dans l'ordre.
 *
 * ── Ce qu'il éprouve, et pourquoi chaque point ────────────────────────────
 *
 * `relrowsecurity` ET `relforcerowsecurity` : le second n'est pas un doublon.
 * Sans `force`, le PROPRIÉTAIRE de la table contourne toutes les politiques —
 * et le service de synchronisation se connecte avec un rôle privilégié.
 *
 * Au moins UNE politique : RLS active sans aucune politique refuse tout, ce
 * qui est sûr mais casse l'écran en silence. C'est arrivé à `subscriptions`,
 * dont la politique de lecture existait sans le `grant` correspondant.
 *
 * `anon` sans aucun privilège : c'est la contrepartie de l'exposition du
 * schéma `kaissi` à PostgREST (migration 0012). Le schéma est joignable par
 * l'API REST ; ce qui protège, c'est que le rôle anonyme n'y a rien.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { URL_TEST } from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

afterAll(async () => {
  await client.end()
})

describe('le schéma kaissi, table par table', () => {
  it('n’a AUCUNE table sans RLS, sans force, ou sans politique', async () => {
    const { rows } = await client.query<{
      relname: string
      rls: boolean
      force: boolean
      politiques: number
    }>(
      `select c.relname,
              c.relrowsecurity      as rls,
              c.relforcerowsecurity as force,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as politiques
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'kaissi' and c.relkind = 'r'
        order by c.relname`,
    )

    // Une base vide ferait passer ce test sans rien vérifier : le préflight
    // applique les migrations, donc ce compte doit être franchement non nul.
    expect(rows.length).toBeGreaterThan(20)

    const fautives = rows
      .filter((r) => !r.rls || !r.force || r.politiques === 0)
      .map(
        (r) =>
          `kaissi.${r.relname} (rls=${r.rls}, force=${r.force}, ${r.politiques} politique(s))`,
      )

    expect(fautives, `tables non protégées : ${fautives.join(' · ')}`).toEqual([])
  })

  /*
   * Les VUES sont l'angle mort de la ligne précédente : une vue n'a pas de
   * RLS à elle. Sans `security_invoker`, elle s'exécute avec les droits de
   * son PROPRIÉTAIRE et rend donc les lignes de tous les restaurants — une
   * fuite qu'aucune politique sur les tables sous-jacentes ne rattrape.
   *
   * C'est déjà éprouvé pour `stock_actuel` dans `rls-stock.test.ts`, mais
   * produit par produit : ici on exige la PROPRIÉTÉ, sur toutes les vues,
   * y compris celles que personne n'a encore écrites.
   */
  it('n’a aucune vue qui contourne RLS (security_invoker manquant)', async () => {
    const { rows } = await client.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'kaissi' and c.relkind = 'v'
          -- Le cast en booléen, et non une comparaison à « true ».
          --
          -- PostgreSQL range l'option TELLE QU'ELLE A ÉTÉ ÉCRITE : la 0019
          -- dit « security_invoker = true », la 0031 « = on ». Les deux sont
          -- la même chose pour le moteur, et une comparaison de chaînes en
          -- déclarait une fautive — un garde-fou qui accuse une vue
          -- correctement protégée envoie chercher une fuite qui n'existe pas.
          and not coalesce(
                (select option_value::boolean from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'),
                false)
        order by c.relname`,
    )
    const fautives = rows.map((r) => `kaissi.${r.relname}`)
    expect(fautives, `vues sans security_invoker : ${fautives.join(' · ')}`).toEqual([])
  })

  it('n’accorde RIEN au rôle anonyme', async () => {
    /*
     * Le schéma `kaissi` est exposé à PostgREST (0012) : il est donc
     * joignable par l'API REST avec la clé publique, sans être connecté. Ce
     * qui protège, ce n'est pas qu'il soit caché — c'est que `anon` n'y a
     * aucun privilège. Un `grant … to public` fait par inadvertance
     * l'accorderait à `anon` du même coup.
     */
    const { rows } = await client.query<{ relname: string; privilege_type: string }>(
      `select c.relname, a.privilege_type
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(
           coalesce(c.relacl, acldefault('r', c.relowner))
         ) a
        where n.nspname = 'kaissi' and c.relkind in ('r', 'v')
          and a.grantee = 'anon'::regrole
        order by 1, 2`,
    )
    const accordes = rows.map((r) => `${r.relname}:${r.privilege_type}`)
    expect(accordes, `privilèges anonymes : ${accordes.join(' · ')}`).toEqual([])
  })
})

describe('kaissi_device — ce qu’une CAISSE peut atteindre', () => {
  /*
   * ── La frontière, exprimée en privilèges ──────────────────────────────
   *
   * Un abonnement ne ferme jamais un geste de caisse. La formulation la plus
   * forte de cette règle n'est pas un commentaire : c'est que le rôle de la
   * caisse ne puisse même pas LIRE la table des formules. Tant que ce test
   * passe, aucun code du POS ne peut se mettre à en dépendre — il n'aurait
   * rien à lire.
   *
   * La migration 0040 avait accordé cette lecture « au cas où le Diagnostic
   * voudrait afficher la formule ». Personne ne l'a jamais lue, et la 0042
   * l'a retirée : un privilège accordé pour un usage qui n'existe pas est un
   * usage qui finit par exister.
   */
  it('ne peut pas lire la table des abonnements', async () => {
    const { rows } = await client.query<{ lecture: boolean }>(
      `select has_table_privilege('kaissi_device', 'kaissi.subscriptions', 'select') as lecture`,
    )
    expect(rows[0]?.lecture).toBe(false)
  })

  it('ne peut rien écrire dans le référentiel qu’il reçoit', async () => {
    /*
     * Le catalogue DESCEND : serveur → caisse. La seule exception est la
     * CRÉATION d'un article (0034), et elle est étroite — `insert` seulement.
     * `update` n'est PAS accordé, et c'est la seconde serrure : elle tient
     * même si la politique `products_creation_caisse` était réécrite.
     */
    const { rows } = await client.query<{ table_name: string; privilege: string }>(
      `select t.table_name, p.privilege
         from (values
                ('categories'), ('tax_rates'), ('discounts'),
                ('modifier_groups'), ('modifiers'), ('stations'),
                ('payment_methods'), ('suppliers')
              ) as t(table_name)
         cross join (values ('insert'), ('update'), ('delete')) as p(privilege)
        where has_table_privilege('kaissi_device', 'kaissi.' || t.table_name, p.privilege)`,
    )
    const accordes = rows.map((r) => `${r.table_name}:${r.privilege}`)
    expect(accordes, `écritures accordées à la caisse : ${accordes.join(' · ')}`).toEqual([])
  })

  it('n’a QUE l’insertion sur les produits — jamais la modification', async () => {
    const { rows } = await client.query<{ i: boolean; u: boolean; d: boolean }>(
      `select has_table_privilege('kaissi_device', 'kaissi.products', 'insert') as i,
              has_table_privilege('kaissi_device', 'kaissi.products', 'update') as u,
              has_table_privilege('kaissi_device', 'kaissi.products', 'delete') as d`,
    )
    expect(rows[0]?.i).toBe(true)
    expect(rows[0]?.u).toBe(false)
    expect(rows[0]?.d).toBe(false)
  })
})
