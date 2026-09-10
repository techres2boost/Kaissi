#!/usr/bin/env node
/**
 * Ouvre un NOUVEAU CLIENT : organisation, premier établissement, premier
 * administrateur — en une transaction.
 *
 * ── Pourquoi ce script, et pas une page « Créer mon compte » ──────────────
 *
 * La question s'est posée telle quelle : « demain un nouveau client vient,
 * il crée son restaurant — comment fait-il ? Il doit avoir une page pour
 * créer son compte, non ? »
 *
 * Non, et c'est une décision, pas un manque. Kaissi n'est pas un logiciel
 * qu'on s'inscrit à : c'est un POS qu'on VEND, qu'on installe, et dont on
 * paramètre les taux de taxe avec le restaurateur. Une page d'inscription
 * ouverte donnerait trois choses dont aucune n'est souhaitable :
 *
 *   • n'importe qui pourrait créer une organisation dans la base de
 *     production — celle qui porte les ventes des clients existants ;
 *   • un restaurant s'ouvrirait sans TVA paramétrée, donc incapable
 *     d'encaisser, et le nouveau venu conclurait que le produit est cassé ;
 *   • il n'y a ni facturation, ni vérification d'identité, ni contrat
 *     derrière. Créer un compte ne serait pas devenir client.
 *
 * L'ouverture d'un client est un ACTE COMMERCIAL. Elle se fait donc du côté
 * de Res2Boost, avec la chaîne PostgreSQL — jamais depuis un navigateur.
 * Ensuite, le client est autonome : son administrateur ouvre ses propres
 * établissements (Administration → Établissements), embauche son équipe et
 * appaire ses tablettes, sans nous.
 *
 * ── Ce que ce script NE fait pas : inventer des taux de TVA ───────────────
 *
 * Le dépôt s'interdit d'affirmer une règle fiscale depuis du code (voir
 * « Points à valider avec un expert-comptable » dans CLAUDE.md). Les taux
 * sont donc soit RECOPIÉS d'un établissement existant (--modele), soit
 * saisis explicitement (--tva), soit absents — et dans ce dernier cas le
 * script le dit en toutes lettres, parce qu'une caisse sans taux de taxe
 * refuse la première vente sans expliquer pourquoi.
 *
 *   # Lister ce qui existe déjà
 *   node apps/sync/scripts/nouveau-client.mjs
 *
 *   # Un client tout neuf, avec ses taux
 *   node apps/sync/scripts/nouveau-client.mjs \
 *     --organisation "Chez Fatma SARL" \
 *     --restaurant "Chez Fatma — Menzah 6" \
 *     --email fatma@chezfatma.tn \
 *     --tva "TVA 19 %:1900,TVA 7 %:700"
 *
 *   # Ou en reprenant les réglages d'un client déjà en service
 *   ... --modele <uuid-d-un-restaurant-existant>
 *
 * Le COMPTE Supabase doit exister au préalable (Authentication → Users →
 * Add user, avec « Auto Confirm User »). Ce script relie, il ne crée pas de
 * compte : cela exigerait la clé `service_role`, qui reste hors d'ici.
 *
 * Rejouable : relancé avec la même organisation, il ne la duplique pas.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { hacherPin, pinTropFaible, uuidV7, validerFormatPin } from '@kaissi/domain'
import { configurationPg } from '../src/connexion.ts'
import { formaterErreurBase } from '../src/diagnostic-base.ts'

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
    '\n  ✗ DATABASE_URL manquante.\n\n' +
      '    Supabase → Project Settings → Database → Connection string → URI.\n' +
      "    Posez-la dans apps/sync/.env, ou devant la commande.\n",
  )
  process.exit(1)
}

/** « TVA 19 %:1900,TVA 7 %:700 » → [{ nom, bp }] — jamais deviné. */
export function lireTaux(texte) {
  if (!texte) return []
  return texte
    .split(',')
    .map((morceau) => morceau.trim())
    .filter(Boolean)
    .map((morceau) => {
      const separateur = morceau.lastIndexOf(':')
      if (separateur < 1) {
        throw new Error(
          `Taux illisible : « ${morceau} ». Attendu « Nom:pointsDeBase », ` +
            'par exemple « TVA 19 %:1900 ». 19 % s’écrit 1900, jamais 0.19 (RÈGLE 1).',
        )
      }
      const nom = morceau.slice(0, separateur).trim()
      const bp = Number(morceau.slice(separateur + 1).trim())
      if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) {
        throw new Error(
          `Taux « ${nom} » : « ${morceau.slice(separateur + 1).trim()} » n'est pas ` +
            'un entier de points de base entre 0 et 10000. 19 % = 1900.',
        )
      }
      return { nom, bp }
    })
}

/** Les modes de paiement et les postes de départ — aucune règle fiscale ici. */
const PAIEMENTS_DEPART = [
  { nom: 'Espèces', type: 'cash', tiroir: true, position: 1 },
  { nom: 'Carte bancaire', type: 'card', tiroir: false, position: 2 },
]
const POSTES_DEPART = ['Cuisine', 'Bar']

const client = new pg.Client(configurationPg())
try {
  await client.connect()
} catch (erreur) {
  console.error(`\n${formaterErreurBase(erreur, process.env.DATABASE_URL)}\n`)
  process.exit(1)
}

/**
 * Un identifiant lisible, dérivé du nom — jamais saisi.
 *
 * `organizations.slug` et `restaurants.slug` sont tous deux obligatoires et
 * uniques. Les demander ajouterait un champ que personne ne sait remplir,
 * pour une valeur qui n'apparaît nulle part dans l'interface. On le dérive,
 * et on le désambiguïse au besoin — comme un numéro de ticket en collision :
 * mieux vaut « chez-fatma-2 » qu'un refus.
 */
export function slugifier(nom) {
  return (
    nom
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'sans-nom'
  )
}

/** Le premier slug libre, testé par la requête que l'appelant fournit. */
async function slugLibre(base, estPris) {
  let slug = base
  for (let n = 2; n < 100; n += 1) {
    if (!(await estPris(slug))) return slug
    slug = `${base}-${n}`
  }
  return `${base}-${Date.now()}`
}

async function listerClients() {
  const { rows } = await client.query(
    `select o.id as org, o.name as organisation,
            count(r.id)::int as etablissements,
            coalesce(string_agg(r.name, ', ' order by r.created_at), '—') as noms
       from kaissi.organizations o
       left join kaissi.restaurants r on r.organization_id = o.id
      group by o.id, o.name
      order by o.created_at`,
  )
  if (rows.length === 0) {
    console.log('\n  Aucun client. C’est le tout premier.\n')
    return
  }
  console.log('\n  Clients en service :\n')
  for (const l of rows) {
    console.log(`    ${l.organisation}  (${l.etablissements} établissement(s))`)
    console.log(`      ${l.org}`)
    console.log(`      ${l.noms}\n`)
  }
}

const organisation = (args.get('organisation') ?? '').trim()
const nomResto = (args.get('restaurant') ?? '').trim()
const email = (args.get('email') ?? '').trim().toLowerCase()

if (!organisation || !nomResto || !email) {
  console.log(
    '\n  Ouvre un nouveau client : organisation + premier établissement + premier admin.\n\n' +
      '    node apps/sync/scripts/nouveau-client.mjs \\\n' +
      '      --organisation "Chez Fatma SARL" \\\n' +
      '      --restaurant "Chez Fatma — Menzah 6" \\\n' +
      '      --email fatma@chezfatma.tn \\\n' +
      '      --tva "TVA 19 %:1900,TVA 7 %:700"\n\n' +
      '  Options : --modele <uuid>  reprend taux, paiements et postes d’un établissement\n' +
      '            --nom "Fatma Ben Ali"   --pin 4271   --timezone Africa/Tunis\n' +
      '            --bascule 04:00\n',
  )
  await listerClients()
  await client.end()
  process.exit(0)
}

let taux
try {
  taux = lireTaux(args.get('tva'))
} catch (erreur) {
  console.error(`\n  ✗ ${erreur.message}\n`)
  await client.end()
  process.exit(1)
}

const modele = (args.get('modele') ?? '').trim() || null
if (modele && taux.length > 0) {
  console.error(
    '\n  ✗ --modele et --tva ensemble : il faudrait choisir lequel fait foi.\n' +
      '    Reprenez un établissement existant, OU saisissez les taux. Pas les deux.\n',
  )
  await client.end()
  process.exit(1)
}

let pinHash = null
const pin = args.get('pin')
if (pin) {
  const format = validerFormatPin(pin)
  if (format) {
    console.error(`\n  ✗ ${format}\n`)
    await client.end()
    process.exit(1)
  }
  if (pinTropFaible(pin)) {
    console.error(
      `\n  ✗ Le PIN « ${pin} » est trop devinable (suite, répétition, date).\n`,
    )
    await client.end()
    process.exit(1)
  }
  pinHash = hacherPin(pin)
}

try {
  // Le COMPTE doit exister. Ce script relie, il ne crée pas de compte :
  // le créer exigerait la clé service_role, qui n'entre pas ici.
  const { rows: comptes } = await client.query(
    'select id from auth.users where lower(email) = $1',
    [email],
  )
  if (comptes.length === 0) {
    console.error(
      `\n  ✗ Aucun compte Supabase avec l'adresse « ${email} ».\n\n` +
        '    Tableau de bord Supabase → Authentication → Users → « Add user »\n' +
        '    → « Create new user ». COCHEZ « Auto Confirm User » : sans cela, la\n' +
        '    personne ne pourra pas se connecter.\n\n' +
        '    ⚠ Ne créez JAMAIS ce compte en SQL : GoTrue lit ses colonnes de jetons\n' +
        '      dans des chaînes non nullables, et un NULL fait échouer la connexion\n' +
        '      avec « E-mail ou mot de passe incorrect », sans que rien ne le dise.\n\n' +
        '    Puis relancez cette commande à l’identique.\n',
    )
    process.exitCode = 1
  } else {
    const compteId = comptes[0].id

    if (modele) {
      const { rows } = await client.query(
        'select 1 from kaissi.restaurants where id = $1',
        [modele],
      )
      if (rows.length === 0) {
        console.error(`\n  ✗ Établissement modèle ${modele} introuvable.\n`)
        await client.end()
        process.exit(1)
      }
    }

    await client.query('begin')

    // Rejouable : la même organisation deux fois ne la duplique pas.
    const { rows: orgs } = await client.query(
      'select id, name from kaissi.organizations where lower(name) = lower($1)',
      [organisation],
    )
    let organizationId
    let orgCreee = false
    if (orgs.length > 0) {
      organizationId = orgs[0].id
    } else {
      organizationId = uuidV7()
      orgCreee = true
      const slugOrg = await slugLibre(slugifier(organisation), async (candidat) => {
        const { rows } = await client.query(
          'select 1 from kaissi.organizations where slug = $1',
          [candidat],
        )
        return rows.length > 0
      })
      await client.query(
        'insert into kaissi.organizations (id, name, slug) values ($1, $2, $3)',
        [organizationId, organisation, slugOrg],
      )
    }

    const timezone = (args.get('timezone') ?? 'Africa/Tunis').trim()
    const bascule = (args.get('bascule') ?? '04:00').trim()
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(bascule)) {
      throw new Error('L’heure de bascule s’écrit « 04:00 ».')
    }

    const restaurantId = uuidV7()
    // Unique PAR ORGANISATION pour un établissement — deux clients peuvent
    // très bien avoir chacun leur « chez-fatma ».
    const slug = await slugLibre(slugifier(nomResto), async (candidat) => {
      const { rows } = await client.query(
        'select 1 from kaissi.restaurants where organization_id = $1 and slug = $2',
        [organizationId, candidat],
      )
      return rows.length > 0
    })

    await client.query(
      `insert into kaissi.restaurants
         (id, organization_id, name, slug, timezone, business_day_start)
       values ($1, $2, $3, $4, $5, $6)`,
      [restaurantId, organizationId, nomResto, slug, timezone, bascule],
    )

    let reglages = 0
    if (modele) {
      // `kaissi.uuid_v7()` explicitement : ces tables n'ont pas de défaut sur
      // `id` (RÈGLE 2). Ici c'est le serveur qui crée, avec la même fonction
      // que les tablettes.
      for (const copie of [
        `insert into kaissi.tax_rates
           (id, organization_id, restaurant_id, name, rate_bp, is_included, is_default)
         select kaissi.uuid_v7(), $3, $1, name, rate_bp, is_included, is_default
           from kaissi.tax_rates where restaurant_id = $2 and archived_at is null`,
        `insert into kaissi.payment_methods
           (id, organization_id, restaurant_id, name, type, opens_drawer, position, is_active)
         select kaissi.uuid_v7(), $3, $1, name, type, opens_drawer, position, is_active
           from kaissi.payment_methods where restaurant_id = $2 and archived_at is null`,
        `insert into kaissi.stations
           (id, organization_id, restaurant_id, name, position)
         select kaissi.uuid_v7(), $3, $1, name, position
           from kaissi.stations where restaurant_id = $2 and archived_at is null`,
      ]) {
        const { rowCount } = await client.query(copie, [restaurantId, modele, organizationId])
        reglages += rowCount ?? 0
      }
    } else {
      for (const [index, t] of taux.entries()) {
        await client.query(
          `insert into kaissi.tax_rates
             (id, organization_id, restaurant_id, name, rate_bp, is_included, is_default)
           values (kaissi.uuid_v7(), $1, $2, $3, $4, true, $5)`,
          [organizationId, restaurantId, t.nom, t.bp, index === 0],
        )
        reglages += 1
      }
      for (const p of PAIEMENTS_DEPART) {
        await client.query(
          `insert into kaissi.payment_methods
             (id, organization_id, restaurant_id, name, type, opens_drawer, position, is_active)
           values (kaissi.uuid_v7(), $1, $2, $3, $4, $5, $6, true)`,
          [organizationId, restaurantId, p.nom, p.type, p.tiroir, p.position],
        )
        reglages += 1
      }
      for (const [index, nom] of POSTES_DEPART.entries()) {
        await client.query(
          `insert into kaissi.stations (id, organization_id, restaurant_id, name, position)
           values (kaissi.uuid_v7(), $1, $2, $3, $4)`,
          [organizationId, restaurantId, nom, index + 1],
        )
        reglages += 1
      }
    }

    /*
     * L'EMPLOYÉ relié au compte, puis son appartenance en `admin`.
     *
     * Un compte Supabase ne peut avoir qu'UNE ligne `kaissi.users`
     * (`users_auth_user_id_key`). Relancer ce script pour ouvrir un second
     * établissement au même client échouait donc sur cette contrainte, avec
     * un message de base de données que personne ne rattache à sa cause. On
     * réutilise l'employé s'il existe déjà — c'est le même geste que
     * `sync:acces`, et il rend le script réellement rejouable.
     */
    const nom = (args.get('nom') ?? email.split('@')[0]).trim()
    const { rows: existants } = await client.query(
      `select id from kaissi.users
        where auth_user_id = $1 or (organization_id = $2 and lower(email) = $3)
        limit 1`,
      [compteId, organizationId, email],
    )
    let employeId
    if (existants.length > 0) {
      employeId = existants[0].id
      await client.query(
        `update kaissi.users
            set email = $2, full_name = $3, status = 'actif', archived_at = null,
                pin_hash = coalesce($4, pin_hash), updated_at = now()
          where id = $1`,
        [employeId, email, nom, pinHash],
      )
    } else {
      employeId = uuidV7()
      await client.query(
        `insert into kaissi.users
           (id, organization_id, auth_user_id, email, full_name, pin_hash, status)
         values ($1, $2, $3, $4, $5, $6, 'actif')`,
        [employeId, organizationId, compteId, email, nom, pinHash],
      )
    }
    await client.query(
      `insert into kaissi.memberships (organization_id, user_id, restaurant_id, role)
       values ($1, $2, $3, 'admin')
       on conflict (user_id, restaurant_id) do update
          set role = 'admin', revoked_at = null, updated_at = now()`,
      [organizationId, employeId, restaurantId],
    )

    await client.query('commit')

    console.log(
      `\n  ✓ ${orgCreee ? 'Organisation créée' : 'Organisation existante'} : ${organisation}\n` +
        `    ${organizationId}\n\n` +
        `  ✓ Établissement : ${nomResto}\n` +
        `    ${restaurantId}\n` +
        `    ${reglages} réglage(s) posé(s)${modele ? ` (repris de ${modele})` : ''}\n\n` +
        `  ✓ Administrateur : ${nom} <${email}>\n` +
        `    ${pinHash ? 'PIN posé — il encaisse aussi.' : 'Sans PIN — back-office seulement.'}\n`,
    )

    if (!modele && taux.length === 0) {
      console.log(
        '  ⚠ AUCUN TAUX DE TAXE n’a été posé, et c’est délibéré : ce dépôt\n' +
          '    n’affirme aucune règle fiscale depuis du code.\n\n' +
          '    La caisse REFUSERA la première vente tant que le gérant n’en aura\n' +
          '    pas créé au moins un (back-office → Menu → Taxes).\n\n' +
          '    Relancez avec --tva "TVA 19 %:1900" si vous les connaissez, ou\n' +
          '    avec --modele <uuid> pour reprendre ceux d’un client existant.\n',
      )
    }

    console.log(
      '  La suite appartient au client :\n\n' +
        `    1. il se connecte au back-office avec ${email}\n` +
        '    2. il saisit sa carte (Menu → Articles)\n' +
        '    3. il embauche son équipe (Employés)\n' +
        '    4. il appaire sa première tablette : Diagnostic → Synchronisation,\n' +
        '       son e-mail et son mot de passe — aucun jeton à recopier\n\n' +
        '    Il ouvre ensuite ses propres établissements tout seul :\n' +
        '    Administration → Établissements.\n',
    )
  }
} catch (erreur) {
  await client.query('rollback').catch(() => {})
  console.error(`\n  ✗ ${erreur.message}\n`)
  process.exitCode = 1
} finally {
  await client.end()
}
