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

    /** Prochains travaux à tenter, le plus ancien d'abord. */
    async aImprimer(limite = 10): Promise<TravailImpression[]> {
      const lignes = await db.lire<Record<string, never>>(
        `SELECT * FROM print_queue
         WHERE status IN ('en_attente','en_cours') AND attempts < ?
         ORDER BY created_at LIMIT ?`,
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
        `SELECT * FROM print_queue WHERE status = 'echec' ORDER BY created_at DESC LIMIT 50`,
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
