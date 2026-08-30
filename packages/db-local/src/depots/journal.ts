/**
 * Dépôt du journal d'événements local + outbox.
 *
 * Écrire un événement et l'inscrire dans l'outbox est UNE SEULE transaction :
 * si l'application est tuée entre les deux, l'événement serait soit perdu,
 * soit jamais poussé. Les deux sont inacceptables pour une vente.
 */

import type { EvenementCommande } from '@kaissi/domain'
import type { AdaptateurSqlite } from '../adaptateur.js'

export interface EnregistrementOutbox {
  eventId: string
  payload: string
  tentatives: number
  derniereErreur: string | null
  codeRejet: string | null
  statut: 'en_attente' | 'en_cours' | 'rejete'
  creeA: string
}

export function depotJournal(db: AdaptateurSqlite) {
  return {
    /**
     * Alloue le prochain numéro de séquence local.
     * Monotone, jamais réutilisé : c'est l'ordre intra-appareil.
     */
    async prochaineSeq(): Promise<number> {
      return db.transaction(async () => {
        const ligne = await db.lireUne<{ valeur: string }>(
          "SELECT valeur FROM sync_state WHERE cle = 'seq_device'",
        )
        const suivant = Number.parseInt(ligne?.valeur ?? '0', 10) + 1
        await db.executer(
          "UPDATE sync_state SET valeur = ? WHERE cle = 'seq_device'",
          [String(suivant)],
        )
        return suivant
      })
    },

    /**
     * Écrit un événement ET son entrée d'outbox, atomiquement.
     * Idempotent : réécrire le même `eventId` ne crée pas de doublon.
     */
    async ajouter(evenement: EvenementCommande): Promise<void> {
      await db.transaction(async () => {
        await db.executer(
          `INSERT OR IGNORE INTO order_events
             (event_id, order_id, organization_id, restaurant_id, device_id,
              seq_device, server_seq, type, payload, actor_user_id, client_ts,
              protocol_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            evenement.eventId,
            evenement.orderId,
            evenement.organizationId,
            evenement.restaurantId,
            evenement.deviceId,
            evenement.seqDevice,
            evenement.serverSeq,
            evenement.type,
            JSON.stringify(evenement.payload),
            evenement.acteurId ?? null,
            evenement.clientTs,
            1,
          ],
        )
        await db.executer(
          `INSERT OR IGNORE INTO outbox
             (event_id, restaurant_id, kind, payload, created_at)
           VALUES (?, ?, 'order_event', ?, ?)`,
          [
            evenement.eventId,
            evenement.restaurantId,
            JSON.stringify(evenement),
            new Date().toISOString(),
          ],
        )
      })
    },

    /** Journal complet d'une commande, prêt pour `reduireEvenements`. */
    async journalDe(orderId: string): Promise<EvenementCommande[]> {
      const lignes = await db.lire<{
        event_id: string
        order_id: string
        organization_id: string
        restaurant_id: string
        device_id: string
        seq_device: number
        server_seq: number | null
        type: string
        payload: string
        actor_user_id: string | null
        client_ts: string
      }>(
        `SELECT * FROM order_events WHERE order_id = ?
         ORDER BY COALESCE(server_seq, 9223372036854775807), client_ts, device_id, seq_device`,
        [orderId],
      )
      return lignes.map((l) => ({
        eventId: l.event_id,
        orderId: l.order_id,
        organizationId: l.organization_id,
        restaurantId: l.restaurant_id,
        deviceId: l.device_id,
        seqDevice: l.seq_device,
        serverSeq: l.server_seq,
        type: l.type as EvenementCommande['type'],
        payload: JSON.parse(l.payload) as never,
        acteurId: l.actor_user_id,
        clientTs: l.client_ts,
      }))
    },

    /** Lot à pousser, le plus ancien d'abord. */
    async lotAPousser(taille = 200): Promise<EnregistrementOutbox[]> {
      const lignes = await db.lire<{
        event_id: string
        payload: string
        attempts: number
        last_error: string | null
        reject_code: string | null
        status: string
        created_at: string
      }>(
        `SELECT event_id, payload, attempts, last_error, reject_code, status, created_at
         FROM outbox WHERE status = 'en_attente' ORDER BY created_at LIMIT ?`,
        [taille],
      )
      return lignes.map((l) => ({
        eventId: l.event_id,
        payload: l.payload,
        tentatives: l.attempts,
        derniereErreur: l.last_error,
        codeRejet: l.reject_code,
        statut: l.status as EnregistrementOutbox['statut'],
        creeA: l.created_at,
      }))
    },

    /**
     * Purge de l'outbox sur ACCUSÉ DE RÉCEPTION. C'est le seul moment où
     * un événement quitte la file : jamais « au bout de N essais ».
     */
    async accuserReception(eventIds: readonly string[]): Promise<void> {
      if (eventIds.length === 0) return
      const marques = eventIds.map(() => '?').join(', ')
      await db.executer(
        `DELETE FROM outbox WHERE event_id IN (${marques})`,
        [...eventIds],
      )
    },

    /**
     * Consigne un rejet serveur. L'événement RESTE visible : le gérant doit
     * voir « 2 opérations nécessitent votre attention ».
     */
    async marquerRejet(eventId: string, code: string, message: string): Promise<void> {
      await db.executer(
        `UPDATE outbox
         SET status = 'rejete', reject_code = ?, last_error = ?,
             attempts = attempts + 1, last_attempt_at = ?
         WHERE event_id = ?`,
        [code, message, new Date().toISOString(), eventId],
      )
    },

    /**
     * Abandonne les rejets d'un CODE donné — sans jamais toucher au journal.
     *
     * L'outbox est la FILE d'envoi, distincte de `order_events` (la source de
     * vérité, en insertion seule). Retirer une ligne d'outbox n'efface donc
     * aucune vente : la commande reste dans le journal et dans la projection,
     * elle cesse seulement d'être présentée à l'envoi.
     *
     * Le seul usage prévu : les rejets « appareil_etranger » consécutifs à un
     * ré-appairage. Ces événements portent l'ancien identifiant d'appareil et
     * ne pourront JAMAIS être acceptés par le serveur ; les garder à l'écran
     * noierait les vrais rejets, ceux qui appellent une décision. On borne
     * donc au code, pour ne pas offrir d'effacer un rejet métier légitime.
     */
    async abandonnerRejets(code: string): Promise<number> {
      const avant = await db.lireUne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbox WHERE status = 'rejete' AND reject_code = ?`,
        [code],
      )
      await db.executer(`DELETE FROM outbox WHERE status = 'rejete' AND reject_code = ?`, [code])
      return avant?.n ?? 0
    },

    /** Nombre d'opérations en attente — badge de l'écran de synchronisation. */
    async enAttente(): Promise<{ enAttente: number; rejetes: number }> {
      const ligne = await db.lireUne<{ en_attente: number; rejetes: number }>(
        `SELECT
           SUM(CASE WHEN status = 'en_attente' THEN 1 ELSE 0 END) AS en_attente,
           SUM(CASE WHEN status = 'rejete'     THEN 1 ELSE 0 END) AS rejetes
         FROM outbox`,
      )
      return { enAttente: ligne?.en_attente ?? 0, rejetes: ligne?.rejetes ?? 0 }
    },

    /** Numéro de ticket préfixé par appareil : P1-000431. Aucune collision. */
    async prochainNumeroTicket(): Promise<string> {
      return db.transaction(async () => {
        const prefixe = await db.lireUne<{ valeur: string }>(
          "SELECT valeur FROM sync_state WHERE cle = 'ticket_prefix'",
        )
        const compteur = await db.lireUne<{ valeur: string }>(
          "SELECT valeur FROM sync_state WHERE cle = 'ticket_counter'",
        )
        const suivant = Number.parseInt(compteur?.valeur ?? '0', 10) + 1
        await db.executer(
          "UPDATE sync_state SET valeur = ? WHERE cle = 'ticket_counter'",
          [String(suivant)],
        )
        return `${prefixe?.valeur || 'P0'}-${String(suivant).padStart(6, '0')}`
      })
    },
  }
}

export type DepotJournal = ReturnType<typeof depotJournal>
