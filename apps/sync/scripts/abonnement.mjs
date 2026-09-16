#!/usr/bin/env node
/**
 * Change la FORMULE d'une organisation. Outil de l'ÉDITEUR, pas du client.
 *
 * ── Pourquoi ce n'est pas un bouton dans le back-office ────────────────────
 *
 * Parce qu'un bouton qui change la formule sans encaisser est un cadeau, et
 * qu'un bouton qui prétend encaisser sans le faire est pire. Mais surtout :
 * le back-office n'utilise que la clé PUBLIQUE de Supabase, et toutes ses
 * écritures passent par RLS. `kaissi.subscriptions` n'a aucune politique
 * d'écriture (migration 0040) — une telle politique serait, littéralement,
 * un « je m'offre la formule payante » rejouable depuis la console du
 * navigateur de n'importe quel client.
 *
 * La formule se décide donc là où elle se paie : chez l'éditeur, avec la
 * connexion PostgreSQL, depuis ce script. C'est le même raisonnement, et le
 * même chemin, que `pnpm sync:acces` pour le tout premier administrateur.
 *
 * ── Ce que ce script ne peut PAS faire ─────────────────────────────────────
 *
 * Arrêter une caisse. Aucune formule ne ferme un geste d'encaissement, et il
 * n'existe nulle part de code capable de le faire : le POS est empaqueté dans
 * l'application, il n'interroge aucun abonnement, et il encaisse hors ligne.
 * Ce que ces formules ouvrent ou ferment, ce sont des écrans de GESTION.
 * Le raisonnement complet est en tête de `packages/domain/src/abonnement.ts`.
 *
 *   # 1. voir les formules en cours (aucun argument)
 *   pnpm sync:abonnement
 *
 *   # 2. changer
 *   pnpm sync:abonnement --organisation <uuid> --formule pro
 *   pnpm sync:abonnement --organisation <uuid> --formule essai --jours 30
 *   pnpm sync:abonnement --organisation <uuid> --formule gratuit --note "Impayé mars"
 *
 * Variables : DATABASE_URL (obligatoire), comme `pnpm sync:acces`.
 * Rejouable : relancer la même commande met la formule à jour, sans doublon.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { FORMULES, JOURS_ESSAI, PLANS, finEssaiDepuis } from '@kaissi/domain'
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

/** Sans argument, on montre l'état plutôt qu'un rappel d'usage. */
async function listerFormules() {
  const { rows } = await client.query(
    `select o.id, o.name,
            coalesce(s.plan, '(aucune ligne)') as plan,
            to_char(s.trial_ends_at, 'YYYY-MM-DD') as fin_essai,
            (select count(*) from kaissi.restaurants r
              where r.organization_id = o.id) as etablissements
       from kaissi.organizations o
       left join kaissi.subscriptions s on s.organization_id = o.id
      order by o.name`,
  )
  if (rows.length === 0) {
    console.error(
      '\n  ✗ Aucune organisation dans cette base.\n\n' +
        '    Les migrations ne sont pas appliquées, ou vous êtes connecté à la\n' +
        '    mauvaise base. Voir docs/mvp.md §6.1.\n',
    )
    process.exitCode = 1
    return
  }
  console.log('\n  Formules en cours :\n')
  for (const o of rows) {
    const essai = o.fin_essai ? `  essai jusqu'au ${o.fin_essai}` : ''
    console.log(
      `    ${o.id}   ${o.name}  — ${o.plan}${essai}  (${o.etablissements} établissement(s))`,
    )
  }
  console.log(
    `\n  Formules possibles : ${PLANS.join(', ')}\n` +
      '  Puis :\n' +
      `    pnpm sync:abonnement --organisation ${rows[0].id} --formule pro\n`,
  )
}

const organisationId = args.get('organisation')
const formule = args.get('formule')

if (!organisationId || !formule) {
  await listerFormules()
  await client.end()
  process.exit(process.exitCode ?? 0)
}

if (!PLANS.includes(formule)) {
  console.error(`\n  ✗ Formule inconnue « ${formule} ». Attendu : ${PLANS.join(', ')}.\n`)
  await client.end()
  process.exit(1)
}

/*
 * La durée d'un essai est un ARGUMENT, avec `JOURS_ESSAI` par défaut.
 *
 * Un essai prolongé « encore deux semaines, il installe son deuxième
 * restaurant » est un geste commercial courant. L'interdire obligerait à
 * écrire la date à la main en SQL — donc, un jour, à se tromper de mois.
 */
const jours = args.get('jours') === undefined ? JOURS_ESSAI : Number(args.get('jours'))
if (formule === 'essai' && (!Number.isInteger(jours) || jours < 1 || jours > 365)) {
  console.error(`\n  ✗ « --jours ${args.get('jours')} » : un entier entre 1 et 365 est attendu.\n`)
  await client.end()
  process.exit(1)
}

try {
  const { rows: orgs } = await client.query(
    'select id, name from kaissi.organizations where id = $1::uuid',
    [organisationId],
  )
  if (orgs.length === 0) {
    console.error(`\n  ✗ Organisation ${organisationId} introuvable.\n`)
    await listerFormules()
    process.exitCode = 1
  } else {
    const org = orgs[0]
    /*
     * `trial_ends_at` n'est posée QUE pour un essai, et remise à nul sinon.
     *
     * La contrainte `essai_a_une_fin` exige l'échéance pour `essai` ; la
     * laisser traîner sur un `pro` ferait réapparaître « essai terminé le
     * 3 mars » sur l'écran du client le jour où on le repasserait en essai,
     * avec une date vieille d'un an.
     */
    const finEssai = formule === 'essai' ? finEssaiDepuis(new Date(), jours).toISOString() : null
    const note = args.get('note') ?? null

    const { rows } = await client.query(
      `insert into kaissi.subscriptions (organization_id, plan, trial_ends_at, note)
       values ($1::uuid, $2::text, $3::timestamptz, $4::text)
       on conflict (organization_id) do update
          set plan = excluded.plan,
              trial_ends_at = excluded.trial_ends_at,
              -- La note n'est effacée que si on en fournit une nouvelle :
              -- « --formule pro » sans note ne doit pas perdre le « offert
              -- trois mois » écrit par quelqu'un d'autre il y a six mois.
              note = coalesce(excluded.note, kaissi.subscriptions.note)
       returning plan, to_char(trial_ends_at, 'YYYY-MM-DD') as fin_essai, note`,
      [organisationId, formule, finEssai, note],
    )

    const pose = rows[0]
    const droits = FORMULES[formule]
    console.log(
      `\n  ✓ « ${org.name} » est en formule « ${droits.nom} ».` +
        (pose.fin_essai ? `\n    Essai jusqu'au ${pose.fin_essai} (${jours} jours).` : '') +
        `\n    Historique : ${droits.joursHistorique === null ? 'sans limite' : `${droits.joursHistorique} jours`}` +
        `\n    Modules : ${droits.modules.length === 0 ? 'aucun' : droits.modules.join(', ')}` +
        (pose.note ? `\n    Note : ${pose.note}` : '') +
        `\n\n    La caisse n'est pas concernée : elle encaisse hors ligne, quelle\n` +
        `    que soit la formule. Le changement est visible au back-office au\n` +
        `    prochain chargement — rien à redémarrer.\n`,
    )
  }
} finally {
  await client.end()
}
