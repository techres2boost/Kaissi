/**
 * Dépôt de la pointeuse — les pointages de CETTE caisse.
 *
 * Comme les services de caisse, ils sont POUSSÉS et jamais retirés : une
 * tablette ne connaît que les pointages faits sur elle. Un employé qui
 * pointe son arrivée sur la caisse 1 et sa sortie sur la caisse 2 laisse
 * donc deux lignes — c'est la limite assumée, et l'écran le dit. Le
 * back-office, qui reçoit tout, est l'endroit où l'on compte les heures.
 */

import type { Pointage } from '@kaissi/domain'
import type { AdaptateurSqlite } from '../adaptateur.js'

interface LignePointage {
  id: string
  employee_id: string | null
  clock_in_at: string
  clock_out_at: string | null
}

const versPointage = (l: LignePointage): Pointage => ({
  id: l.id,
  employeId: l.employee_id,
  arriveeA: l.clock_in_at,
  sortieA: l.clock_out_at,
})

export function depotPointeuse(db: AdaptateurSqlite) {
  return {
    /** Le pointage encore ouvert de cet employé sur cette caisse, s'il y en a un. */
    async ouvertDe(employeId: string): Promise<Pointage | null> {
      const l = await db.lireUne<LignePointage>(
        `SELECT id, employee_id, clock_in_at, clock_out_at FROM time_entries
         WHERE employee_id = ? AND clock_out_at IS NULL
         ORDER BY clock_in_at DESC LIMIT 1`,
        [employeId],
      )
      return l ? versPointage(l) : null
    },

    async pointerArrivee(p: {
      id: string
      organizationId: string
      restaurantId: string
      deviceId: string
      employeId: string
      arriveeA: string
    }): Promise<void> {
      await db.executer(
        `INSERT INTO time_entries
           (id, organization_id, restaurant_id, employee_id, device_id, clock_in_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p.id, p.organizationId, p.restaurantId, p.employeId, p.deviceId, p.arriveeA],
      )
    },

    /** La sortie, et le pointage repart vers le serveur, enrichi. */
    async pointerSortie(id: string, sortieA: string): Promise<void> {
      await db.executer(
        'UPDATE time_entries SET clock_out_at = ?, pushed_at = NULL WHERE id = ? AND clock_out_at IS NULL',
        [sortieA, id],
      )
    },

    /** Les pointages de cette caisse dont l'arrivée tombe dans la période. */
    async entre(debut: string, fin: string): Promise<Pointage[]> {
      const lignes = await db.lire<LignePointage>(
        `SELECT id, employee_id, clock_in_at, clock_out_at FROM time_entries
         WHERE clock_in_at >= ? AND clock_in_at < ? ORDER BY clock_in_at`,
        [debut, fin],
      )
      return lignes.map(versPointage)
    },

    async aPousser(limite = 50): Promise<Pointage[]> {
      const lignes = await db.lire<LignePointage>(
        `SELECT id, employee_id, clock_in_at, clock_out_at FROM time_entries
         WHERE pushed_at IS NULL ORDER BY clock_in_at LIMIT ?`,
        [limite],
      )
      return lignes.map(versPointage)
    },

    /**
     * Marque poussé ce qui a été accusé, TEL QU'IL A ÉTÉ ENVOYÉ.
     *
     * Une sortie pointée pendant que l'arrivée voyageait remet `pushed_at`
     * à nul ; marquer la ligne poussée sans regarder perdrait cette sortie,
     * qui ne remonterait jamais. On ne marque donc que si la sortie en base
     * est celle qui est partie.
     */
    async marquerPousses(envoyes: readonly Pointage[]): Promise<void> {
      const maintenant = new Date().toISOString()
      for (const p of envoyes) {
        await db.executer(
          `UPDATE time_entries SET pushed_at = ?
           WHERE id = ? AND COALESCE(clock_out_at, '') = COALESCE(?, '')`,
          [maintenant, p.id, p.sortieA],
        )
      }
    },
  }
}

export type DepotPointeuse = ReturnType<typeof depotPointeuse>
