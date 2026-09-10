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
  // Ajoutées par la migration locale 002 (Phase 1).
  | 'employe_courant'
  | 'shift_courant'
  | 'derniere_impression_erreur'
  // Appairage de l'appareil (Phase 2). Sans elles, la sync reste éteinte.
  | 'url_sync'
  | 'jeton_appareil'
  // Identifiant STABLE de cette installation du POS, tiré une seule fois au
  // premier démarrage. À la différence de `device_id`, il ne vient PAS du
  // serveur et ne change JAMAIS : c'est lui qui permet au serveur de
  // reconnaître ce terminal quand on le remet en service, au lieu de lui
  // créer un appareil de plus (migration Postgres 0021).
  | 'installation_id'
  // Quand le catalogue a RÉELLEMENT changé pour la dernière fois — distinct
  // de `last_sync_at`, qui ne dit que « j'ai eu du réseau ». Un contact
  // permanent et un catalogue vieux de trois jours se ressemblent sans elle,
  // et c'est exactement ce qu'on regarde quand un PIN réinitialisé est
  // refusé par la caisse.
  | 'catalogue_applique_a'
  /*
   * Drapeau de PURGE, posé et retiré dans la seule transaction de
   * `reinitialiserPourAutreEtablissement()` (migration locale 010).
   *
   * Tant qu'il est là, le déclencheur d'immuabilité de `order_events` laisse
   * passer une suppression — et LUI SEUL le permet. Il n'a donc rien à faire
   * dans du code applicatif : il n'est déclaré ici que pour que les tests
   * puissent vérifier qu'il ne reste JAMAIS posé après coup.
   */
  | 'purge_etablissement'

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
