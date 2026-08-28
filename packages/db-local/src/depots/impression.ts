/**
 * File d'impression persistante.
 *
 * Un KOT non imprimé = un plat non préparé = un client mécontent en salle.
 * La file survit au redémarrage de l'application et de l'appareil : tant
 * qu'un travail n'est pas confirmé imprimé, il reste ici.
 *
 * Le rendu ESC/POS est fait AVANT la mise en file, pas au moment d'imprimer :
 * ainsi un ticket mis en file reste imprimable même si le catalogue change
 * ou si le produit est supprimé entre-temps.
 *
 * La DESTINATION, elle, est résolue au moment d'imprimer — jamais figée.
 * Le contenu d'un ticket appartient au passé ; l'adresse de l'imprimante
 * appartient au présent. Les figer ensemble condamnerait toute la file le
 * jour où l'imprimante de la cuisine est remplacée : chaque bon en attente
 * repartirait indéfiniment vers une adresse morte.
 *
 * Trois cas, dans cet ordre :
 *   1. le travail porte une station  → l'adresse ACTUELLE de cette station ;
 *   2. il n'en porte pas (ticket client, rapport de clôture, tiroir) →
 *      l'imprimante de la caisse, c'est-à-dire la première station
 *      configurée ;
 *   3. aucune station n'a d'imprimante → l'adresse enregistrée à la mise en
 *      file, en dernier recours.
 *
 * Le cas 2 n'est pas un détail : un ticket client n'appartient à aucune
 * station par nature, et c'est justement lui que le gérant réimprime.
 */

import type { AdaptateurSqlite } from '../adaptateur.js'

export type TypeImpression = 'kot' | 'ticket' | 'rapport' | 'tiroir'
export type StatutImpression = 'en_attente' | 'en_cours' | 'imprime' | 'echec'

export interface TravailImpression {
  id: string
  restaurantId: string
  orderId: string | null
  stationId: string | null
  kind: TypeImpression
  chargeB64: string
  hote: string | null
  port: number
  statut: StatutImpression
  tentatives: number
  derniereErreur: string | null
  creeA: string
  imprimeA: string | null
}

/** Au-delà, on cesse de réessayer tout seul et on alerte le gérant. */
export const TENTATIVES_MAX = 5

/**
 * Colonnes et jointures qui résolvent la destination d'un travail.
 *
 * Écrites une seule fois : la liste des échecs DOIT montrer l'adresse qui
 * sera réellement tentée. En montrer une autre enverrait chercher la panne
 * au mauvais endroit — exactement ce qu'on cherche à éviter.
 */
const DESTINATION_RESOLUE = `
       COALESCE(s.printer_host, caisse.printer_host, f.target_host) AS target_host,
       COALESCE(s.printer_port, caisse.printer_port, f.target_port) AS target_port
  FROM print_queue f
  LEFT JOIN stations s
         ON s.id = f.station_id AND s.archived_at IS NULL
  LEFT JOIN (SELECT printer_host, printer_port
               FROM stations
              WHERE archived_at IS NULL AND printer_host IS NOT NULL
              ORDER BY position, name
              LIMIT 1) caisse
         ON f.station_id IS NULL`

export function depotImpression(db: AdaptateurSqlite) {
  return {
    async mettreEnFile(travail: {
      id: string
      restaurantId: string
      orderId?: string | null
      stationId?: string | null
      kind: TypeImpression
      chargeB64: string
      hote: string | null
      port?: number
    }): Promise<void> {
      await db.executer(
        `INSERT OR IGNORE INTO print_queue
           (id, restaurant_id, order_id, station_id, kind, payload_b64,
            target_host, target_port, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,'en_attente',?)`,
        [
          travail.id,
          travail.restaurantId,
          travail.orderId ?? null,
          travail.stationId ?? null,
          travail.kind,
          travail.chargeB64,
          travail.hote,
          travail.port ?? 9100,
          new Date().toISOString(),
        ],
      )
    },

    /**
     * Prochains travaux à tenter, le plus ancien d'abord.
     *
     * L'adresse rendue est celle que porte la station AUJOURD'HUI, et non
     * celle enregistrée à la mise en file. `target_host` ne sert plus que de
     * repli, pour les travaux sans station (ouverture de tiroir, rapport).
     */
    async aImprimer(limite = 10): Promise<TravailImpression[]> {
      const lignes = await db.lire<Record<string, never>>(
        `SELECT f.*, ${DESTINATION_RESOLUE}
          WHERE f.status IN ('en_attente','en_cours') AND f.attempts < ?
          ORDER BY f.created_at LIMIT ?`,
        [TENTATIVES_MAX, limite],
      )
      return lignes.map(versTravail)
    },

    async marquerEnCours(id: string): Promise<void> {
      await db.executer(
        `UPDATE print_queue SET status = 'en_cours', attempts = attempts + 1
         WHERE id = ?`,
        [id],
      )
    },

    async marquerImprime(id: string): Promise<void> {
      await db.executer(
        `UPDATE print_queue SET status = 'imprime', printed_at = ?, last_error = NULL
         WHERE id = ?`,
        [new Date().toISOString(), id],
      )
    },

    /**
     * Un échec ne supprime JAMAIS le travail : il repart en attente jusqu'à
     * `TENTATIVES_MAX`, puis reste visible en échec. Un ticket qui disparaît
     * en silence est exactement ce qu'il ne faut pas.
     */
    async marquerEchec(id: string, erreur: string): Promise<void> {
      await db.executer(
        `UPDATE print_queue
         SET status = CASE WHEN attempts >= ? THEN 'echec' ELSE 'en_attente' END,
             last_error = ?
         WHERE id = ?`,
        [TENTATIVES_MAX, erreur, id],
      )
    },

    /** Compteurs du badge « N tickets non imprimés », visibles du serveur. */
    async compteurs(): Promise<{ enAttente: number; echecs: number }> {
      const l = await db.lireUne<{ attente: number; echecs: number }>(
        `SELECT
           SUM(CASE WHEN status IN ('en_attente','en_cours') THEN 1 ELSE 0 END) AS attente,
           SUM(CASE WHEN status = 'echec' THEN 1 ELSE 0 END) AS echecs
         FROM print_queue`,
      )
      return { enAttente: l?.attente ?? 0, echecs: l?.echecs ?? 0 }
    },

    async enEchec(): Promise<TravailImpression[]> {
      const lignes = await db.lire<Record<string, never>>(
        `SELECT f.*, ${DESTINATION_RESOLUE}
          WHERE f.status = 'echec'
          ORDER BY f.created_at DESC LIMIT 50`,
      )
      return lignes.map(versTravail)
    },

    /** Remet un travail en échec dans la file — action explicite du gérant. */
    async reessayer(id: string): Promise<void> {
      await db.executer(
        `UPDATE print_queue SET status = 'en_attente', attempts = 0, last_error = NULL
         WHERE id = ?`,
        [id],
      )
    },

    /**
     * Remet TOUS les travaux en échec dans la file — l'imprimante a été
     * rallumée, ou son adresse corrigée.
     *
     * Reste une action explicite : au-delà de `TENTATIVES_MAX`, la file
     * cesse de réessayer seule pour ne pas masquer une panne durable. Mais
     * il fallait un geste pour la relancer, sinon « rien n'est jamais
     * supprimé » signifiait « rien ne repart jamais ».
     */
    async reessayerTout(): Promise<number> {
      const enEchec = await db.lireUne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM print_queue WHERE status = 'echec'`,
      )
      await db.executer(
        `UPDATE print_queue SET status = 'en_attente', attempts = 0, last_error = NULL
         WHERE status = 'echec'`,
      )
      return enEchec?.n ?? 0
    },

    /** Purge des travaux imprimés il y a plus de N jours. */
    async purger(joursDeRetention = 7): Promise<void> {
      const limite = new Date(Date.now() - joursDeRetention * 86_400_000).toISOString()
      await db.executer(
        `DELETE FROM print_queue WHERE status = 'imprime' AND printed_at < ?`,
        [limite],
      )
    },
  }
}

function versTravail(l: Record<string, never>): TravailImpression {
  const r = l as unknown as {
    id: string
    restaurant_id: string
    order_id: string | null
    station_id: string | null
    kind: string
    payload_b64: string
    target_host: string | null
    target_port: number
    status: string
    attempts: number
    last_error: string | null
    created_at: string
    printed_at: string | null
  }
  return {
    id: r.id,
    restaurantId: r.restaurant_id,
    orderId: r.order_id,
    stationId: r.station_id,
    kind: r.kind as TypeImpression,
    chargeB64: r.payload_b64,
    hote: r.target_host,
    port: r.target_port,
    statut: r.status as StatutImpression,
    tentatives: r.attempts,
    derniereErreur: r.last_error,
    creeA: r.created_at,
    imprimeA: r.printed_at,
  }
}

export type DepotImpression = ReturnType<typeof depotImpression>
