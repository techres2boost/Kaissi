/**
 * Dépôt `sync_state` — les quelques scalaires de configuration locale.
 */

import type { AdaptateurSqlite } from '../adaptateur.js'

export type CleEtat =
  | 'seq_device'
  | 'last_catalog_seq'
  | 'last_event_seq'
  | 'protocol_version'
  | 'device_id'
  | 'restaurant_id'
  | 'organization_id'
  | 'ticket_prefix'
  | 'ticket_counter'
  | 'last_sync_at'

export function depotEtat(db: AdaptateurSqlite) {
  return {
    async lire(cle: CleEtat): Promise<string | null> {
      const ligne = await db.lireUne<{ valeur: string | null }>(
        'SELECT valeur FROM sync_state WHERE cle = ?',
        [cle],
      )
      return ligne?.valeur ?? null
    },

    async ecrire(cle: CleEtat, valeur: string): Promise<void> {
      await db.executer(
        `INSERT INTO sync_state (cle, valeur) VALUES (?, ?)
         ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur`,
        [cle, valeur],
      )
    },

    async tout(): Promise<Record<string, string | null>> {
      const lignes = await db.lire<{ cle: string; valeur: string | null }>(
        'SELECT cle, valeur FROM sync_state ORDER BY cle',
      )
      return Object.fromEntries(lignes.map((l) => [l.cle, l.valeur]))
    },
  }
}

export type DepotEtat = ReturnType<typeof depotEtat>
