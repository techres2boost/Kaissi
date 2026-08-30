#!/usr/bin/env node
/**
 * Donne à un compte Supabase l'accès au back-office d'un établissement.
 *
 * ── Pourquoi ce script existe ──────────────────────────────────────────────
 *
 * Trois identités distinctes vivent dans ce produit : le COMPTE (e-mail et
 * mot de passe, Supabase Auth), l'EMPLOYÉ (`kaissi.users`, un PIN) et
 * l'APPAREIL (un jeton). Créer un compte exige l'API d'administration de
 * Supabase, donc la clé `service_role` — qui contourne RLS et n'a rien à
 * faire dans une application web. Le back-office ne peut donc PAS créer de
 * compte : c'est délibéré, et c'est ce qui garantit qu'un `where` oublié ne
 * rend jamais les données d'un autre client.
 *
 * Reste à relier les deux, une fois le compte créé dans le tableau de bord
 * Supabase. C'est exactement ce que fait ce script, depuis le poste de
 * l'exploitant, avec la connexion PostgreSQL — jamais depuis le navigateur.
 *
 * Il sert deux fois :
 *   • au TOUT DÉBUT, pour le premier administrateur. Sans lui, personne ne
 *     peut ouvrir le back-office : les politiques RLS ne rendent aucune
 *     ligne à un compte sans appartenance, ce qui est le comportement voulu.
 *   • ENSUITE, pour chaque personne qui doit ouvrir le back-office — un
 *     cuisinier sur l'écran de cuisine, un comptable sur les rapports.
 *
 * Un serveur en salle n'en a pas besoin : il tape un PIN sur une tablette,
 * et le gérant l'embauche depuis le back-office.
 *
 *   # 1. lister les établissements (aucun argument)
 *   pnpm sync:acces
 *
 *   # 2. donner l'accès
 *   pnpm sync:acces --restaurant <uuid> --email moi@exemple.tn --role admin
 *
 * Options : --nom "Nom Prénom", --pin 4271 (si la personne encaisse aussi).
 * Variables : DATABASE_URL (obligatoire), comme `pnpm sync:appairer`.
 *
 * Rejouable : relancer la même commande met le rôle à jour au lieu d'échouer.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { hacherPin, pinTropFaible, uuidV7, validerFormatPin } from '@kaissi/domain'
import { configurationPg } from '../src/connexion.ts'
import { formaterErreurBase } from '../src/diagnostic-base.ts'

const ROLES = ['admin', 'gerant', 'caissier', 'serveur', 'cuisine']

const FICHIER_ENV = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env')
if (existsSync(FICHIER_ENV) && !process.env.DATABASE_URL) {
  process.loadEnvFile(FICHIER_ENV)
}

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

if (!process.env.DATABASE_URL) {
  console.error(
    `DATABASE_URL est absente.\n` +
      `  Attendue dans ${FICHIER_ENV}\n` +
      `  Modèle : apps/sync/.env.example — voir docs/mvp.md.`,
  )
  process.exit(1)
}

let configuration
try {
  configuration = configurationPg()
} catch (erreur) {
  console.error(`\n  ✗ ${erreur instanceof Error ? erreur.message : String(erreur)}\n`)
  process.exit(1)
}
const client = new pg.Client(configuration)

try {
  await client.connect()
} catch (erreur) {
  console.error(
    `\n  ✗ La base de données est injoignable.\n\n  ` +
      formaterErreurBase(erreur, {
        motDePasseSepare: configuration.password !== undefined,
        utilisateur: configuration.user,
      })
        .split('\n')
        .join('\n  ') +
      '\n',
  )
  process.exit(1)
}

/** Sans argument, on montre ce qui existe plutôt qu'un rappel d'usage. */
async function listerEtablissements() {
  const { rows } = await client.query(
    `select r.id, r.name, o.name as org,
            (select count(*) from kaissi.memberships m
              where m.restaurant_id = r.id and m.revoked_at is null) as equipe
       from kaissi.restaurants r
       join kaissi.organizations o on o.id = r.organization_id
      order by o.name, r.name`,
  )
  if (rows.length === 0) {
    console.error(
      '\n  ✗ Aucun établissement dans cette base.\n\n' +
        '    Les migrations ne sont pas appliquées, ou vous êtes connecté à la\n' +
        '    mauvaise base. Voir docs/mvp.md §6.1.\n',
    )
    process.exitCode = 1
    return
  }
  console.log('\n  Établissements de cette base :\n')
  for (const r of rows) {
    console.log(`    ${r.id}   ${r.name}  (${r.org}) — ${r.equipe} membre(s)`)
  }
  console.log(
    '\n  Puis :\n' +
      `    pnpm sync:acces --restaurant ${rows[0].id} --email vous@exemple.tn --role admin\n`,
  )
}

const restaurantId = args.get('restaurant')
const email = args.get('email')?.trim().toLowerCase()
const role = args.get('role') ?? 'admin'

if (!restaurantId || !email) {
  await listerEtablissements()
  await client.end()
  process.exit(process.exitCode ?? 0)
}

if (!ROLES.includes(role)) {
  console.error(`Rôle inconnu « ${role} ». Attendu : ${ROLES.join(', ')}.`)
  await client.end()
  process.exit(1)
}

// Le PIN est validé AVANT toute écriture : découvrir qu'il est trop faible
// après avoir créé l'employé laisserait la base à moitié faite.
let pinHash = null
const pin = args.get('pin')
if (pin !== undefined) {
  try {
    validerFormatPin(pin)
  } catch (erreur) {
    console.error(`\n  ✗ ${erreur.message}\n`)
    await client.end()
    process.exit(1)
  }
  if (pinTropFaible(pin)) {
    console.error(
      `\n  ✗ « ${pin} » est trop facile à deviner (suite, répétition ou code courant).\n` +
        `    Un PIN sert à savoir QUI a agi : un code devinable ne trace rien.\n`,
    )
    await client.end()
    process.exit(1)
  }
  pinHash = hacherPin(pin)
}

try {
  const { rows: restos } = await client.query(
    'select id, organization_id, name from kaissi.restaurants where id = $1',
    [restaurantId],
  )
  if (restos.length === 0) {
    console.error(`\n  ✗ Établissement ${restaurantId} introuvable.\n`)
    await listerEtablissements()
    process.exitCode = 1
  } else {
    const resto = restos[0]

    // Le COMPTE doit exister : ce script relie, il ne crée pas de compte.
    // Le créer d'ici exigerait la clé service_role, précisément ce qu'on
    // refuse de manipuler hors du tableau de bord Supabase.
    const { rows: comptes } = await client.query(
      'select id, email from auth.users where lower(email) = $1',
      [email],
    )
    if (comptes.length === 0) {
      console.error(
        `\n  ✗ Aucun compte Supabase avec l'adresse « ${email} ».\n\n` +
          `    Créez-le d'abord : tableau de bord Supabase → Authentication →\n` +
          `    Users → « Add user » → « Create new user ». Cochez « Auto Confirm\n` +
          `    User », sinon la personne ne pourra pas se connecter tant qu'elle\n` +
          `    n'aura pas cliqué sur un lien de confirmation.\n\n` +
          `    Puis relancez cette commande à l'identique.\n`,
      )
      process.exitCode = 1
    } else {
      const compte = comptes[0]

      await client.query('begin')

      // L'employé peut déjà exister de trois façons : déjà relié à ce compte,
      // embauché par le gérant avec la même adresse mais sans compte, ou pas
      // du tout. Les trois mènent à la même ligne finale.
      const { rows: existants } = await client.query(
        `select id, full_name, auth_user_id from kaissi.users
          where organization_id = $1
            and (auth_user_id = $2 or lower(email) = $3)
          limit 1`,
        [resto.organization_id, compte.id, email],
      )

      const nom = args.get('nom') ?? existants[0]?.full_name ?? email.split('@')[0]
      let employeId
      let cree = false

      if (existants.length > 0) {
        employeId = existants[0].id
        await client.query(
          `update kaissi.users
              set auth_user_id = $1,
                  email        = $2,
                  full_name    = $3,
                  status       = 'actif',
                  archived_at  = null,
                  pin_hash     = coalesce($4, pin_hash),
                  updated_at   = now()
            where id = $5`,
          [compte.id, email, nom, pinHash, employeId],
        )
      } else {
        employeId = uuidV7()
        cree = true
        await client.query(
          `insert into kaissi.users
             (id, organization_id, auth_user_id, email, full_name, pin_hash, status)
           values ($1, $2, $3, $4, $5, $6, 'actif')`,
          [employeId, resto.organization_id, compte.id, email, nom, pinHash],
        )
      }

      // Rejouable : le même appel deux fois met le rôle à jour et lève une
      // éventuelle révocation, au lieu d'échouer sur la clé d'unicité.
      const { rows: appartenances } = await client.query(
        `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
         values ($1, $2, $3, $4)
         on conflict (user_id, restaurant_id) do update
            set role = excluded.role, revoked_at = null, updated_at = now()
         returning (xmax = 0) as nouvelle`,
        [resto.organization_id, employeId, restaurantId, role],
      )

      await client.query('commit')

      console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  ACCÈS ACCORDÉ                                                           ║
╚══════════════════════════════════════════════════════════════════════════╝

  Établissement   ${resto.name}
  Compte          ${compte.email}
  Employé         ${nom}  (${employeId})${cree ? '   — créé' : '   — existant, mis à jour'}
  Rôle            ${role}${appartenances[0]?.nouvelle ? '' : '   (rôle mis à jour)'}
  Code PIN        ${pinHash ? 'défini' : 'inchangé — le gérant peut le poser depuis le back-office'}

  La personne peut maintenant se connecter au back-office avec son e-mail
  et son mot de passe Supabase.${
    role === 'cuisine'
      ? '\n  Rôle « cuisine » : elle arrivera directement sur l’écran de cuisine.'
      : ''
  }
`)
    }
  }
} catch (erreur) {
  await client.query('rollback').catch(() => {})
  console.error(`\n  ✗ Échec : ${erreur.message}\n`)
  process.exitCode = 1
} finally {
  await client.end()
}
