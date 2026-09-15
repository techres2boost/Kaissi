/**
 * L'établissement, tel que la caisse le connaît.
 *
 * ── Pourquoi un dépôt, alors que c'est un seul SELECT ─────────────────────
 *
 * Parce que ce SELECT décide du TOTAL. Il nomme les colonnes que
 * `configEtablissement` traduit en frais de service et en droit de timbre : une
 * faute de frappe sur `service_rate_bp` ne lève aucune erreur — SQLite rend
 * `undefined`, `configEtablissement` lit zéro, la caisse encaisse sans service,
 * et le ticket cesse de valoir le total du back-office. Rien ne le signale.
 *
 * Il vivait en ligne dans `apps/pos/src/etat/contexte.tsx`, c'est-à-dire au
 * milieu d'un composant React, là où aucun test ne l'atteint sans monter un
 * navigateur. Ici, il s'exécute contre le schéma réellement migré, et
 * `miroir.test.ts` le fait tourner sur une ligne posée par le miroir — le
 * chemin exact de la production.
 */

import type { AdaptateurSqlite } from '../adaptateur.js'

/**
 * Ce que la caisse lit de son établissement.
 *
 * Les noms sont ceux des COLONNES, pas ceux du domaine : la traduction se fait
 * chez l'appelant, et une colonne renommée doit casser là où on la lit.
 */
export interface LigneEtablissement {
  name: string
  address: string | null
  phone: string | null
  fiscal_id: string | null
  receipt_footer: string | null
  /*
   * Les options de restauration (migrations Postgres 0036, locale 013).
   *
   * SQLite n'a pas de booléen : `service_taxable` arrive en 0/1 — c'est
   * `normaliser()` du miroir qui convertit depuis le `true` de Postgres.
   */
  service_rate_bp: number | null
  service_taxable: number | null
  service_tax_rate_id: string | null
  stamp_duty_millimes: number | null
}

const COLONNES = `name, address, phone, fiscal_id, receipt_footer,
                  service_rate_bp, service_taxable, service_tax_rate_id,
                  stamp_duty_millimes`

export function depotEtablissement(db: AdaptateurSqlite) {
  return {
    /**
     * L'établissement de CE terminal.
     *
     * ── Par identifiant, jamais « LIMIT 1 » ───────────────────────────────
     *
     * Depuis que `restaurants` descend par le catalogue (migration Postgres
     * 0035, locale 012), la table peut contenir DEUX lignes : celle de la
     * graine de démonstration, et celle que le serveur envoie. `LIMIT 1` sans
     * `ORDER BY` rendait alors l'une ou l'autre au gré de SQLite — un ticket
     * au nom du restaurant de démonstration, une fois sur deux, sans que rien
     * n'échoue.
     *
     * Le repli reste pour une caisse JAMAIS appairée, qui n'a pas encore de
     * `restaurant_id` : elle n'a alors qu'une ligne, celle de la démonstration,
     * et c'est bien celle-là qu'il faut.
     */
    async lire(restaurantId: string | null): Promise<LigneEtablissement | null> {
      if (restaurantId) {
        return (
          (await db.lireUne<LigneEtablissement>(
            `SELECT ${COLONNES} FROM restaurants WHERE id = ?`,
            [restaurantId],
          )) ?? null
        )
      }
      return (
        (await db.lireUne<LigneEtablissement>(
          `SELECT ${COLONNES} FROM restaurants LIMIT 1`,
        )) ?? null
      )
    },
  }
}

export type DepotEtablissement = ReturnType<typeof depotEtablissement>
