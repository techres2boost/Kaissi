/**
 * Dépôt de synchronisation — implémentation PostgreSQL.
 *
 * Deux points structurants :
 *
 * 1. **Le service emprunte le rôle `kaissi_device`** et pose le contexte
 *    d'appareil en variables de session. Toutes les requêtes passent donc
 *    par RLS, comme si l'appareil parlait directement à la base. Un défaut
 *    de filtrage applicatif ne peut pas provoquer de fuite entre deux
 *    restaurants : la base refuserait.
 *
 * 2. **L'insertion d'un lot est UNE transaction.** Soit tout le lot entre,
 *    soit rien. Un lot à moitié appliqué laisserait une commande dans un
 *    état que personne ne sait reconstruire.
 */

import { Pool, type PoolClient } from 'pg'
import {
  calculerTotaux,
  reduireEvenements,
  totalVerse,
  type ConfigCalcul,
  type EvenementCommande,
  type PointsDeBase,
} from '@kaissi/domain'
import { estUuid } from '@kaissi/domain'
import type { AppareilAuthentifie, DepotSync, ResultatInsertion } from './depot.js'
import type { ChangementCatalogue } from './protocole.js'

/**
 * Ne garde que les identifiants réellement au format UUID.
 *
 * Sans ce filtre, un appareil défectueux — ou hostile — qui envoie un
 * `event_id` vide fait échouer le cast `::uuid[]` et le serveur répond 500
 * sur TOUT le lot. Or un identifiant mal formé doit produire un rejet
 * propre, pas une panne : les autres ventes du même lot n'y sont pour rien.
 */
function uuidsValides(valeurs: readonly string[]): string[] {
  return valeurs.filter((v) => typeof v === 'string' && estUuid(v))
}

export interface OptionsDepot {
  readonly connectionString: string
  readonly max?: number
  /** `false` en test local : le Postgres de test n'a pas de TLS. */
  readonly ssl?: boolean
}

export class DepotPostgres implements DepotSync {
  private readonly pool: Pool

  constructor(options: OptionsDepot) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      ssl: options.ssl === false ? false : { rejectUnauthorized: true },
      // Une requête de sync qui dépasse dix secondes est une requête cassée :
      // mieux vaut la couper que laisser la connexion occupée.
      statement_timeout: 10_000,
    })
  }

  /**
   * Exécute un travail sous l'identité de l'appareil.
   * `set local` : le contexte disparaît à la fin de la transaction, donc
   * une connexion rendue au pool ne garde jamais l'identité du précédent.
   */
  private async sousIdentite<T>(
    appareil: AppareilAuthentifie,
    travail: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('set local role kaissi_device')
      await client.query('select set_config($1, $2, true)', [
        'kaissi.device_id',
        appareil.deviceId,
      ])
      await client.query('select set_config($1, $2, true)', [
        'kaissi.restaurant_id',
        appareil.restaurantId,
      ])
      await client.query('select set_config($1, $2, true)', [
        'kaissi.organization_id',
        appareil.organizationId,
      ])
      const resultat = await travail(client)
      await client.query('commit')
      return resultat
    } catch (erreur) {
      await client.query('rollback').catch(() => undefined)
      throw erreur
    } finally {
      client.release()
    }
  }

  async appareilParJeton(empreinte: string): Promise<AppareilAuthentifie | null> {
    // Recherche par empreinte AVANT d'avoir une identité : c'est la seule
    // requête qui ne peut pas passer par RLS, puisqu'elle établit l'identité.
    const { rows } = await this.pool.query<{
      id: string
      restaurant_id: string
      organization_id: string
      revoked_at: string | null
      protocol_version: number
    }>(
      `select id, restaurant_id, organization_id, revoked_at, protocol_version
       from kaissi.devices where token_hash = $1`,
      [empreinte],
    )
    const ligne = rows[0]
    if (!ligne) return null
    return {
      deviceId: ligne.id,
      restaurantId: ligne.restaurant_id,
      organizationId: ligne.organization_id,
      revoque: ligne.revoked_at !== null,
      protocolVersion: ligne.protocol_version,
    }
  }

  async evenementsConnus(
    restaurantId: string,
    eventIds: readonly string[],
  ): Promise<Set<string>> {
    const propres = uuidsValides(eventIds)
    if (propres.length === 0) return new Set()
    const { rows } = await this.pool.query<{ event_id: string }>(
      `select event_id from kaissi.order_events
       where restaurant_id = $1 and event_id = any($2::uuid[])`,
      [restaurantId, propres],
    )
    return new Set(rows.map((r) => r.event_id))
  }

  async insererEvenements(
    appareil: AppareilAuthentifie,
    evenements: readonly EvenementCommande[],
    batchId: string,
  ): Promise<ResultatInsertion> {
    return this.sousIdentite(appareil, async (client) => {
      const inseres: string[] = []
      const doublons: string[] = []

      for (const e of evenements) {
        // `on conflict do nothing` + `returning` : la ligne ne revient QUE
        // si elle a été réellement insérée. C'est la garantie d'idempotence
        // (RÈGLE 5) exprimée en une seule requête, sans lecture préalable
        // qui ouvrirait une fenêtre de concurrence.
        const { rows } = await client.query<{ server_seq: string }>(
          `insert into kaissi.order_events
             (event_id, order_id, organization_id, restaurant_id, device_id,
              seq_device, type, payload, actor_user_id, client_ts, protocol_version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (event_id) do nothing
           returning server_seq`,
          [
            e.eventId,
            e.orderId,
            e.organizationId,
            e.restaurantId,
            e.deviceId,
            e.seqDevice,
            e.type,
            JSON.stringify(e.payload),
            e.acteurId ?? null,
            e.clientTs,
            1,
          ],
        )
        if (rows.length > 0) inseres.push(e.eventId)
        else doublons.push(e.eventId)

        await client.query(
          `insert into kaissi.sync_mutations
             (event_id, organization_id, restaurant_id, device_id, batch_id, status)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (event_id) do nothing`,
          [
            e.eventId,
            e.organizationId,
            e.restaurantId,
            e.deviceId,
            batchId,
            rows.length > 0 ? 'accepte' : 'doublon',
          ],
        )
      }

      const { rows: tete } = await client.query<{ seq: string | null }>(
        `select max(server_seq) as seq from kaissi.order_events where restaurant_id = $1`,
        [appareil.restaurantId],
      )
      return {
        inseres,
        doublons,
        curseur: Number(tete[0]?.seq ?? 0),
      }
    })
  }

  async consignerRejets(
    appareil: AppareilAuthentifie,
    batchId: string,
    rejets: readonly { eventId: string; code: string; message: string }[],
  ): Promise<void> {
    // Un identifiant mal formé ne peut pas être consigné : la clé de
    // `sync_mutations` est un uuid. Le rejet part quand même dans la réponse,
    // donc l'appareil en est informé — mais le registre reste propre.
    const consignables = rejets.filter((r) => estUuid(r.eventId))
    if (consignables.length === 0) return

    await this.sousIdentite(appareil, async (client) => {
      for (const r of consignables) {
        await client.query(
          `insert into kaissi.sync_mutations
             (event_id, organization_id, restaurant_id, device_id, batch_id,
              status, reject_code, reject_message)
           values ($1,$2,$3,$4,$5,'rejete',$6,$7)
           -- « do nothing » et non « do update » : le registre d'idempotence
           -- reste en INSERTION SEULE, comme les journaux. Un appareil ne
           -- doit pas pouvoir réécrire le verdict d'une opération passée.
           on conflict (event_id) do nothing`,
          [
            r.eventId,
            appareil.organizationId,
            appareil.restaurantId,
            appareil.deviceId,
            batchId,
            r.code,
            r.message,
          ],
        )
      }
    })
  }

  async statutsDesCommandes(
    restaurantId: string,
    orderIds: readonly string[],
  ): Promise<Map<string, string>> {
    const propres = uuidsValides(orderIds)
    if (propres.length === 0) return new Map()
    const { rows } = await this.pool.query<{ id: string; status: string }>(
      `select id, status from kaissi.orders where restaurant_id = $1 and id = any($2::uuid[])`,
      [restaurantId, propres],
    )
    return new Map(rows.map((r) => [r.id, r.status]))
  }

  async evenementsDepuis(
    restaurantId: string,
    depuis: number,
    limite: number,
  ): Promise<readonly EvenementCommande[]> {
    // L'index `order_events_pull_idx (restaurant_id, server_seq)` sert
    // exactement cette requête : c'est le chemin le plus sollicité du système.
    const { rows } = await this.pool.query(
      `select event_id, order_id, organization_id, restaurant_id, device_id,
              seq_device, server_seq, type, payload, actor_user_id, client_ts
       from kaissi.order_events
       where restaurant_id = $1 and server_seq > $2
       order by server_seq
       limit $3`,
      [restaurantId, depuis, limite],
    )
    return rows.map(versEvenement)
  }

  async catalogueDepuis(
    restaurantId: string,
    depuis: number,
    limite: number,
  ): Promise<readonly ChangementCatalogue[]> {
    const { rows } = await this.pool.query<{
      seq: string
      entity_type: string
      entity_id: string
      op: string
      payload: Record<string, unknown> | null
    }>(
      `select seq, entity_type, entity_id, op, payload
       from kaissi.change_log
       where restaurant_id = $1 and seq > $2
       order by seq
       limit $3`,
      [restaurantId, depuis, limite],
    )
    return rows.map((r) => ({
      seq: Number(r.seq),
      entite: r.entity_type,
      entiteId: r.entity_id,
      operation: r.op as ChangementCatalogue['operation'],
      donnees: r.payload,
    }))
  }

  async curseursDeTete(
    restaurantId: string,
  ): Promise<{ catalogue: number; evenements: number }> {
    const { rows } = await this.pool.query<{ catalogue: string | null; evenements: string | null }>(
      `select
         (select max(seq) from kaissi.change_log where restaurant_id = $1) as catalogue,
         (select max(server_seq) from kaissi.order_events where restaurant_id = $1) as evenements`,
      [restaurantId],
    )
    return {
      catalogue: Number(rows[0]?.catalogue ?? 0),
      evenements: Number(rows[0]?.evenements ?? 0),
    }
  }

  async majCurseurs(
    appareil: AppareilAuthentifie,
    curseurs: { catalogue?: number; evenements?: number },
    quoi: 'push' | 'pull',
  ): Promise<void> {
    await this.sousIdentite(appareil, async (client) => {
      await client.query(
        `insert into kaissi.sync_cursors
           (device_id, organization_id, restaurant_id, last_catalog_seq,
            last_event_seq, last_push_at, last_pull_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (device_id) do update set
           last_catalog_seq = greatest(kaissi.sync_cursors.last_catalog_seq,
                                       excluded.last_catalog_seq),
           last_event_seq   = greatest(kaissi.sync_cursors.last_event_seq,
                                       excluded.last_event_seq),
           last_push_at = coalesce(excluded.last_push_at, kaissi.sync_cursors.last_push_at),
           last_pull_at = coalesce(excluded.last_pull_at, kaissi.sync_cursors.last_pull_at),
           updated_at = now()`,
        [
          appareil.deviceId,
          appareil.organizationId,
          appareil.restaurantId,
          curseurs.catalogue ?? 0,
          curseurs.evenements ?? 0,
          quoi === 'push' ? new Date().toISOString() : null,
          quoi === 'pull' ? new Date().toISOString() : null,
        ],
      )
      await client.query(
        `update kaissi.devices set last_seen_at = now() where id = $1`,
        [appareil.deviceId],
      )
    })
  }

  /**
   * Reprojection serveur : journal → `orders` / `order_items` / `payments`.
   *
   * Utilise `reduireEvenements` et `calculerTotaux` de `@kaissi/domain` —
   * le MÊME code que la tablette. C'est ce qui garantit qu'un total calculé
   * hors ligne et le total du rapport du back-office ne divergent jamais.
   */
  async reprojeter(restaurantId: string, orderIds: readonly string[]): Promise<void> {
    if (orderIds.length === 0) return
    const client = await this.pool.connect()
    try {
      const config = await chargerConfig(client, restaurantId)
      for (const orderId of orderIds) {
        const { rows } = await client.query(
          `select event_id, order_id, organization_id, restaurant_id, device_id,
                  seq_device, server_seq, type, payload, actor_user_id, client_ts
           from kaissi.order_events
           where order_id = $1 and restaurant_id = $2
           order by server_seq`,
          [orderId, restaurantId],
        )
        if (rows.length === 0) continue

        const etat = reduireEvenements(rows.map(versEvenement))
        const totaux = calculerTotaux({
          lignes: etat.lignes,
          remiseGlobale: etat.remiseGlobale ?? undefined,
          config,
        })

        await client.query('begin')
        try {
          await client.query(
            `insert into kaissi.orders (
               id, organization_id, restaurant_id, table_id, device_id, opened_by,
               closed_by, type, status, covers, ticket_number,
               subtotal_millimes, discount_millimes, tax_millimes, service_millimes,
               stamp_duty_millimes, total_millimes, paid_millimes,
               tax_breakdown, exceptions, opened_at, sent_at, closed_at,
               cancelled_at, cancel_reason, last_event_seq, event_count
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                       $19,$20,$21,$22,$23,$24,$25,$26,$27)
             on conflict (id) do update set
               table_id = excluded.table_id,
               status = excluded.status,
               covers = excluded.covers,
               closed_by = excluded.closed_by,
               ticket_number = coalesce(excluded.ticket_number, kaissi.orders.ticket_number),
               subtotal_millimes = excluded.subtotal_millimes,
               discount_millimes = excluded.discount_millimes,
               tax_millimes = excluded.tax_millimes,
               service_millimes = excluded.service_millimes,
               stamp_duty_millimes = excluded.stamp_duty_millimes,
               total_millimes = excluded.total_millimes,
               paid_millimes = excluded.paid_millimes,
               tax_breakdown = excluded.tax_breakdown,
               exceptions = excluded.exceptions,
               sent_at = excluded.sent_at,
               closed_at = excluded.closed_at,
               cancelled_at = excluded.cancelled_at,
               cancel_reason = excluded.cancel_reason,
               last_event_seq = excluded.last_event_seq,
               event_count = excluded.event_count,
               updated_at = now()`,
            [
              etat.id, etat.organizationId, etat.restaurantId, etat.tableId,
              etat.deviceProprietaireId, etat.ouvertePar, etat.closePar,
              etat.type, etat.statut, etat.couverts, etat.numeroTicket,
              totaux.sousTotalMillimes, totaux.totalRemisesMillimes,
              totaux.taxeMillimes, totaux.serviceMillimes,
              totaux.timbreFiscalMillimes, totaux.totalMillimes, totalVerse(etat),
              JSON.stringify(totaux.ventilationTaxes), JSON.stringify(etat.exceptions),
              etat.ouverteA ?? new Date().toISOString(), etat.envoyeeA, etat.closeA,
              etat.annuleeA, etat.annuleeMotif, etat.derniereSeqServeur ?? 0,
              etat.nombreEvenements,
            ],
          )

          await client.query('delete from kaissi.order_items where order_id = $1', [orderId])
          let position = 0
          for (const ligne of etat.lignes) {
            const calc = totaux.lignes.find((c) => c.id === ligne.id)
            await client.query(
              `insert into kaissi.order_items (
                 id, organization_id, restaurant_id, order_id, product_id, variant_id,
                 station_id, tax_rate_id, designation, qty, unit_price_millimes,
                 modifiers_millimes, line_gross_millimes, line_discount_millimes,
                 global_discount_share_millimes, line_total_millimes, line_tax_millimes,
                 modifiers, note, position, voided_at
               ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
              [
                ligne.id, etat.organizationId, etat.restaurantId, orderId,
                ligne.produitId, ligne.variantId, ligne.stationId, ligne.tauxTaxeId,
                ligne.designation, ligne.quantite,
                calc?.prixUnitaireMillimes ?? ligne.prixBaseMillimes,
                ligne.modificateursMillimes, calc?.totalBrutMillimes ?? 0,
                calc?.remiseLigneMillimes ?? 0, calc?.remiseGlobaleRepartieMillimes ?? 0,
                calc?.baseApresRemisesMillimes ?? 0, calc?.taxeMillimes ?? 0,
                JSON.stringify(ligne.modificateurs), ligne.note, position,
                ligne.annulee ? ligne.ajouteeA : null,
              ],
            )
            position += 1
          }

          await client.query('delete from kaissi.payments where order_id = $1', [orderId])
          for (const p of etat.paiements) {
            await client.query(
              `insert into kaissi.payments (
                 id, organization_id, restaurant_id, order_id, method_id, type,
                 amount_millimes, received_millimes, change_millimes, reference,
                 device_id, voided_at, created_at
               ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                p.id, etat.organizationId, etat.restaurantId, orderId,
                p.methodeId, p.mode, p.montantMillimes, p.recuMillimes,
                p.renduMillimes ?? 0, p.reference, etat.deviceProprietaireId,
                p.annule ? p.enregistreA : null, p.enregistreA,
              ],
            )
          }
          await client.query('commit')
        } catch (erreur) {
          await client.query('rollback').catch(() => undefined)
          throw erreur
        }
      }
    } finally {
      client.release()
    }
  }

  async fermer(): Promise<void> {
    await this.pool.end()
  }
}

async function chargerConfig(client: PoolClient, restaurantId: string): Promise<ConfigCalcul> {
  const { rows } = await client.query<{
    id: string
    name: string
    rate_bp: number
    is_included: boolean
  }>(
    `select id, name, rate_bp, is_included from kaissi.tax_rates
     where restaurant_id = $1 and archived_at is null`,
    [restaurantId],
  )
  return {
    tauxTaxes: Object.fromEntries(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          nom: r.name,
          tauxBp: r.rate_bp as PointsDeBase,
          incluse: r.is_included,
        },
      ]),
    ),
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function versEvenement(r: any): EvenementCommande {
  return {
    eventId: r.event_id,
    orderId: r.order_id,
    organizationId: r.organization_id,
    restaurantId: r.restaurant_id,
    deviceId: r.device_id,
    seqDevice: Number(r.seq_device),
    serverSeq: r.server_seq === null ? null : Number(r.server_seq),
    type: r.type,
    payload: r.payload,
    acteurId: r.actor_user_id,
    clientTs:
      r.client_ts instanceof Date ? r.client_ts.toISOString() : String(r.client_ts),
  }
}
