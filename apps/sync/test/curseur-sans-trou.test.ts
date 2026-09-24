/**
 * Le curseur de synchronisation ne doit JAMAIS sauter un événement.
 *
 * ── Le trou que ce fichier reproduit ──────────────────────────────────────
 *
 * Une tablette retient jusqu'où elle a lu (`seq > curseur`). Le curseur est un
 * compteur serveur, et non un horodatage — précisément pour ne rien sauter
 * (system-design.md §12).
 *
 * Mais PostgreSQL attribue le numéro au moment de l'INSERTION, pas de la
 * validation. Donc :
 *
 *   1. une transaction A insère et reçoit 100, sans valider tout de suite ;
 *   2. une transaction B insère, reçoit 101, et valide ;
 *   3. une tablette tire : elle voit 101 (A n'est pas validée) et avance son
 *      curseur à 101 ;
 *   4. A valide. La tablette tire `seq > 101`… et ne reçoit JAMAIS le 100.
 *
 * Rien ne le rattrape ensuite. Le serveur a tout — les totaux du back-office
 * restent justes — mais une tablette peut manquer pour toujours un article
 * ajouté par une autre sur une table partagée, ou un changement de prix.
 *
 * ── Comment on force la course, sans rien simuler d'autre ─────────────────
 *
 * Un déclencheur de TEST, posé le temps d'un test, fait dormir UNE insertion
 * précise après qu'elle a reçu son numéro et avant qu'elle ne valide. Le reste
 * est le vrai code : `insererEvenements()` et `evenementsDepuis()` pour les
 * ventes, les vraies fonctions de journalisation et `catalogueDepuis()` pour
 * le catalogue.
 *
 * La marge est large (le premier envoi dort 2 s, le second part après 300 ms) :
 * un test de concurrence qui passe « la plupart du temps » ne prouve rien.
 *
 * ⚑ Vérifié AVANT le correctif : les deux tests échouent, et disent lequel des
 *   événements a été perdu. La migration 0043 les fait passer.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import type { AppareilAuthentifie } from '../src/depot.js'
import {
  creerAppareil,
  DEMO_ORG,
  DEMO_RESTO,
  ev,
  nettoyer,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })

/** Combien de temps l'insertion ralentie garde sa transaction ouverte. */
const SOMMEIL_SECONDES = 2
/** Quand le second écrivain démarre — largement avant la fin du sommeil. */
const DECALAGE_MS = 300

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

const produitsCrees: string[] = []

afterAll(async () => {
  await retirerRalentisseur('order_events')
  await retirerRalentisseur('change_log')
  for (const id of produitsCrees) {
    await client.query('delete from kaissi.change_log where entity_id = $1', [id])
    await client.query('delete from kaissi.products where id = $1', [id])
  }
  await client.end()
  await depot.fermer()
})

/**
 * Pose un déclencheur de TEST qui fait dormir l'insertion d'UNE ligne précise,
 * APRÈS qu'elle a reçu son numéro et AVANT que sa transaction ne valide.
 *
 * `after insert` : à ce moment la ligne a son numéro définitif, et la
 * transaction reste ouverte le temps du sommeil. C'est exactement la fenêtre
 * d'une transaction lente en production — un envoi volumineux, une
 * reprojection, un réseau qui hésite.
 *
 * `security definer` : l'envoi d'une caisse s'exécute sous le rôle
 * `kaissi_device`, qui n'a aucune raison d'avoir le droit d'exécuter une
 * fonction de test.
 */
async function poserRalentisseur(
  table: 'order_events' | 'change_log',
  colonne: 'event_id' | 'entity_id',
  id: string,
): Promise<void> {
  await client.query(`
    create or replace function public.test_ralentir_${table}()
    returns trigger language plpgsql security definer set search_path = '' as $f$
    begin
      if new.${colonne} = '${id}'::uuid then
        perform pg_sleep(${SOMMEIL_SECONDES});
      end if;
      return null;
    end $f$`)
  await client.query(`drop trigger if exists test_ralentir on kaissi.${table}`)
  await client.query(`
    create trigger test_ralentir after insert on kaissi.${table}
    for each row execute function public.test_ralentir_${table}()`)
}

async function retirerRalentisseur(table: 'order_events' | 'change_log'): Promise<void> {
  await client.query(`drop trigger if exists test_ralentir on kaissi.${table}`)
  await client.query(`drop function if exists public.test_ralentir_${table}()`)
}

function authentifie(a: AppareilTest): AppareilAuthentifie {
  return {
    deviceId: a.id,
    restaurantId: DEMO_RESTO,
    organizationId: DEMO_ORG,
    revoque: false,
    protocolVersion: 1,
  }
}

function ouverture(a: AppareilTest) {
  const orderId = uuidV7()
  return ev(a, orderId, 'order.opened', {
    type: 'takeaway',
    ouvertePar: null as never,
    numeroTicket: `${a.prefixe}-${orderId.slice(-6)}`,
  })
}

describe('order_events — les ventes d’une caisse arrivent sur les AUTRES caisses', () => {
  let a: AppareilTest
  let b: AppareilTest

  beforeAll(async () => {
    // Même ménage que les autres fichiers : appareils et journal remis à zéro,
    // sinon un second passage bute sur le préfixe « TA » déjà pris.
    await nettoyer()
    a = await creerAppareil('TA')
    b = await creerAppareil('TB')
  })

  it('un envoi validé EN RETARD n’est pas sauté par une tablette déjà passée devant', async () => {
    const { rows } = await client.query<{ seq: string | null }>(
      'select max(server_seq)::text as seq from kaissi.order_events where restaurant_id = $1',
      [DEMO_RESTO],
    )
    const curseur0 = Number(rows[0]?.seq ?? 0)

    const lent = ouverture(a)
    const rapide = ouverture(b)
    await poserRalentisseur('order_events', 'event_id', lent.eventId)

    try {
      // A : un envoi réel, qui obtient son numéro puis tarde à valider.
      const envoiLent = depot.insererEvenements(authentifie(a), [lent], uuidV7())
      await attendre(DECALAGE_MS)

      // B : un envoi réel d'une autre caisse, pendant que A est en vol.
      await depot.insererEvenements(authentifie(b), [rapide], uuidV7())

      // Une troisième tablette tire, et avance son curseur sur ce qu'elle a vu.
      const lot1 = await depot.evenementsDepuis(DEMO_RESTO, curseur0, 500)
      const curseur1 = lot1.reduce((m, e) => Math.max(m, Number(e.serverSeq)), curseur0)

      await envoiLent

      // Elle tire à nouveau, depuis son curseur — comme à chaque cycle.
      const lot2 = await depot.evenementsDepuis(DEMO_RESTO, curseur1, 500)

      const recus = new Set([...lot1, ...lot2].map((e) => e.eventId))
      expect(
        recus.has(lent.eventId),
        'l’événement validé en retard a été SAUTÉ : la tablette ne le recevra jamais',
      ).toBe(true)
      expect(recus.has(rapide.eventId)).toBe(true)

      // Et l'ordre des numéros est celui des validations : A avant B.
      const ordre = [...lot1, ...lot2]
        .filter((e) => e.eventId === lent.eventId || e.eventId === rapide.eventId)
        .map((e) => e.eventId)
      expect(ordre).toEqual([lent.eventId, rapide.eventId])
    } finally {
      await retirerRalentisseur('order_events')
    }
  }, 15_000)

  it('deux établissements ne s’attendent PAS l’un l’autre', async () => {
    /*
     * Le verrou est PAR ÉTABLISSEMENT. S'il était global, une caisse de Sfax
     * attendrait la fin de l'envoi d'une caisse de Tunis — un client
     * ralentirait tous les autres, ce qui est le contraire de la multi-tenance.
     *
     * On le prouve en mesurant : pendant qu'un envoi de DEMO_RESTO dort deux
     * secondes, une insertion dans un AUTRE établissement doit passer tout de
     * suite.
     */
    const lent = ouverture(a)
    await poserRalentisseur('order_events', 'event_id', lent.eventId)

    const orgId = uuidV7()
    const restoId = uuidV7()
    await client.query('insert into kaissi.organizations (id, name, slug) values ($1, $2, $3)', [
      orgId,
      'Ailleurs',
      `ailleurs-${orgId.slice(-8)}`,
    ])
    await client.query(
      `insert into kaissi.restaurants (id, organization_id, name, slug)
       values ($1, $2, 'Ailleurs', 'ailleurs')`,
      [restoId, orgId],
    )

    const appareilAilleurs = uuidV7()
    await client.query(
      `insert into kaissi.devices
         (id, organization_id, restaurant_id, label, type, ticket_prefix, token_hash,
          app_version, protocol_version)
       values ($1, $2, $3, 'Ailleurs', 'pos', 'AL', $4, '0.2.0', 1)`,
      [appareilAilleurs, orgId, restoId, `test-${appareilAilleurs}`],
    )

    const autre = new Client({ connectionString: URL_TEST })
    await autre.connect()
    try {
      const envoiLent = depot.insererEvenements(authentifie(a), [lent], uuidV7())
      await attendre(DECALAGE_MS)

      const debut = Date.now()
      await autre.query(
        `insert into kaissi.order_events
           (event_id, order_id, organization_id, restaurant_id, device_id,
            seq_device, type, payload, client_ts, protocol_version)
         values ($1, $2, $3, $4, $5, 1, 'order.opened', '{}'::jsonb, now(), 1)`,
        [uuidV7(), uuidV7(), orgId, restoId, appareilAilleurs],
      )
      const duree = Date.now() - debut
      await envoiLent

      expect(
        duree,
        `un autre établissement a attendu ${duree} ms : le verrou n’est pas par établissement`,
      ).toBeLessThan((SOMMEIL_SECONDES * 1000) / 2)
    } finally {
      await retirerRalentisseur('order_events')
      /*
       * Le ménage APRÈS la fin de l'envoi lent, et pas avant : désactiver un
       * déclencheur prend un verrou exclusif sur la table, qui attendrait la
       * transaction en vol — et fausserait la mesure ci-dessus.
       */
      await autre.query('alter table kaissi.order_events disable trigger order_events_immuable')
      await autre.query('delete from kaissi.order_events where restaurant_id = $1', [restoId])
      await autre.query('alter table kaissi.order_events enable trigger order_events_immuable')
      await autre.end()
      await client.query('delete from kaissi.devices where id = $1', [appareilAilleurs])
      await client.query('delete from kaissi.restaurants where id = $1', [restoId])
      await client.query('delete from kaissi.organizations where id = $1', [orgId])
    }
  }, 15_000)
})

describe('change_log — le catalogue arrive sur toutes les caisses', () => {
  it('un changement validé EN RETARD n’est pas sauté par une tablette déjà passée devant', async () => {
    /*
     * `change_log` n'est pas écrit par UN chemin de code, mais par six
     * fonctions de journalisation déclenchées depuis le back-office, la
     * caisse (création d'article) ou le service. Le test passe donc par une
     * vraie modification de produit — la même qu'un changement de prix.
     */
    const lentId = uuidV7()
    const rapideId = uuidV7()
    for (const id of [lentId, rapideId]) {
      await client.query(
        `insert into kaissi.products
           (id, organization_id, restaurant_id, name, base_price_millimes, tax_rate_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, DEMO_ORG, DEMO_RESTO, `Produit ${id.slice(-4)}`, millimes(1000), TVA_19],
      )
      produitsCrees.push(id)
    }

    const { rows } = await client.query<{ seq: string | null }>(
      'select max(seq)::text as seq from kaissi.change_log where restaurant_id = $1',
      [DEMO_RESTO],
    )
    const curseur0 = Number(rows[0]?.seq ?? 0)

    await poserRalentisseur('change_log', 'entity_id', lentId)

    const ecrivainA = new Client({ connectionString: URL_TEST })
    const ecrivainB = new Client({ connectionString: URL_TEST })
    await ecrivainA.connect()
    await ecrivainB.connect()
    try {
      // A : un changement de prix, qui obtient son numéro puis tarde à valider.
      const lent = ecrivainA.query(
        'update kaissi.products set base_price_millimes = 1500 where id = $1',
        [lentId],
      )
      await attendre(DECALAGE_MS)

      // B : un autre changement de prix, pendant que A est en vol.
      await ecrivainB.query(
        'update kaissi.products set base_price_millimes = 2500 where id = $1',
        [rapideId],
      )

      const lot1 = await depot.catalogueDepuis(DEMO_RESTO, curseur0, 500)
      const curseur1 = lot1.reduce((m, c) => Math.max(m, c.seq), curseur0)

      await lent

      const lot2 = await depot.catalogueDepuis(DEMO_RESTO, curseur1, 500)

      const recus = new Set([...lot1, ...lot2].map((c) => c.entiteId))
      expect(
        recus.has(lentId),
        'le changement de prix validé en retard a été SAUTÉ : la caisse ne le recevra jamais',
      ).toBe(true)
      expect(recus.has(rapideId)).toBe(true)
    } finally {
      await retirerRalentisseur('change_log')
      await ecrivainA.end()
      await ecrivainB.end()
    }
  }, 15_000)
})
