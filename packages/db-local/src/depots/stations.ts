/**
 * Stations d'impression — cuisine, bar, caisse.
 *
 * L'adresse de l'imprimante est ici, et pas dans un fichier de
 * configuration, pour une raison simple : le jour où l'imprimante de la
 * cuisine est remplacée, c'est le gérant qui doit pouvoir la ressaisir
 * depuis la tablette, pas nous depuis une console SQL.
 */

import type { AdaptateurSqlite } from '../adaptateur.js'

export interface Station {
  id: string
  nom: string
  hote: string | null
  port: number
  position: number
}

export function depotStations(db: AdaptateurSqlite) {
  return {
    async toutes(): Promise<Station[]> {
      const lignes = await db.lire<{
        id: string
        name: string
        printer_host: string | null
        printer_port: number
        position: number
      }>(
        `SELECT id, name, printer_host, printer_port, position
           FROM stations
          WHERE archived_at IS NULL
          ORDER BY position, name`,
      )
      return lignes.map((l) => ({
        id: l.id,
        nom: l.name,
        hote: l.printer_host,
        port: l.printer_port,
        position: l.position,
      }))
    },

    /**
     * Change l'adresse de l'imprimante d'une station.
     *
     * L'écriture est LOCALE. Tant que l'appareil n'est pas appairé, elle
     * fait autorité. Une fois appairé, `stations` est un référentiel tiré
     * du serveur : la prochaine synchronisation écrasera cette valeur par
     * celle du back-office. C'est voulu — deux tablettes du même
     * restaurant ne doivent pas imprimer à deux endroits différents.
     */
    async definirImprimante(
      stationId: string,
      hote: string | null,
      port: number,
    ): Promise<void> {
      await db.executer(
        `UPDATE stations SET printer_host = ?, printer_port = ? WHERE id = ?`,
        [hote && hote.trim() ? hote.trim() : null, port, stationId],
      )
    },
  }
}

export type DepotStations = ReturnType<typeof depotStations>
