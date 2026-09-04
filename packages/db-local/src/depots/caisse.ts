/**
 * Dépôt caisse — shifts, mouvements d'espèces, commandes ouvertes,
 * rapport du jour. Tout est lu LOCALEMENT : le rapport de shift doit
 * s'imprimer même si la ligne est tombée à 23 h.
 */

import type {
  EncaissementShift,
  Millimes,
  ModePaiement,
  MouvementCaisse,
  Shift,
} from '@kaissi/domain'
import type { AdaptateurSqlite } from '../adaptateur.js'

export interface CommandeOuverte {
  id: string
  tableId: string | null
  tableLabel: string | null
  type: string
  statut: string
  numeroTicket: string | null
  totalMillimes: number
  nombreArticles: number
  ouverteA: string
  envoyeeA: string | null
}

export interface LigneRapportProduit {
  produitId: string | null
  designation: string
  quantite: number
  totalMillimes: number
}

export interface RapportJournee {
  date: string
  nombreCommandes: number
  nombreAnnulees: number
  chiffreAffairesMillimes: number
  remisesMillimes: number
  taxesMillimes: number
  serviceMillimes: number
  parMode: { mode: string; nombre: number; montantMillimes: number }[]
  parProduit: LigneRapportProduit[]
  ticketMoyenMillimes: number
}

export function depotCaisse(db: AdaptateurSqlite) {
  return {
    // ── Shifts ───────────────────────────────────────────────────────────
    async shiftOuvert(): Promise<Shift | null> {
      const l = await db.lireUne<Record<string, never>>(
        `SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`,
      )
      return l ? versShift(l) : null
    },

    async shiftParId(id: string): Promise<Shift | null> {
      const l = await db.lireUne<Record<string, never>>(
        'SELECT * FROM shifts WHERE id = ?',
        [id],
      )
      return l ? versShift(l) : null
    },

    async ouvrirShift(shift: {
      id: string
      organizationId: string
      restaurantId: string
      deviceId: string | null
      employeId: string | null
      caisseId: string | null
      fondDeCaisseMillimes: number
    }): Promise<void> {
      const dejaOuvert = await db.lireUne<{ id: string }>(
        'SELECT id FROM shifts WHERE closed_at IS NULL LIMIT 1',
      )
      if (dejaOuvert) {
        throw new Error(
          'Un shift est déjà ouvert sur ce terminal. Clôturez-le avant d’en ouvrir un autre.',
        )
      }
      await db.executer(
        `INSERT INTO shifts (
           id, organization_id, restaurant_id, device_id, employee_id,
           cash_register_id, opened_at, opening_float_millimes, opened_by
         ) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          shift.id,
          shift.organizationId,
          shift.restaurantId,
          shift.deviceId,
          shift.employeId,
          shift.caisseId,
          new Date().toISOString(),
          shift.fondDeCaisseMillimes,
          shift.employeId,
        ],
      )
    },

    async cloturerShift(
      id: string,
      compteMillimes: number,
      attenduMillimes: number,
      note: string | null,
      /**
       * L'employé qui COMPTE la caisse — pas forcément celui qui a ouvert.
       *
       * Un caissier ouvre à midi, un serveur compte le soir. Devant un
       * écart, le nom qui compte est celui de la personne qui a vu les
       * billets ; afficher celui de l'ouverture met en cause quelqu'un qui
       * était parti depuis quatre heures.
       */
      fermePar: string | null = null,
    ): Promise<void> {
      await db.executer(
        `UPDATE shifts
         SET closed_at = ?, counted_millimes = ?, expected_millimes = ?,
             variance_millimes = ?, closing_note = ?, closed_by = ?,
             -- Le shift repart au serveur : il porte maintenant son écart,
             -- qui est LE chiffre pour lequel on tient une caisse.
             pushed_at = NULL
         WHERE id = ? AND closed_at IS NULL`,
        [
          new Date().toISOString(),
          compteMillimes,
          attenduMillimes,
          // L'écart PEUT être négatif : aucune borne à zéro.
          compteMillimes - attenduMillimes,
          note,
          fermePar,
          id,
        ],
      )
    },

    /**
     * Services de caisse à remonter au serveur.
     *
     * `pushed_at IS NULL` = jamais accusé, ou modifié depuis. Un shift part
     * donc DEUX fois : à son ouverture, puis à sa clôture. C'est voulu — le
     * gérant voit la caisse ouverte pendant le service, pas seulement après.
     */
    async shiftsAPousser(limite = 50): Promise<
      {
        id: string
        employeId: string | null
        ouvertA: string
        fondDeCaisseMillimes: number
        fermeA: string | null
        fermePar: string | null
        compteMillimes: number | null
        attenduMillimes: number | null
        ecartMillimes: number | null
      }[]
    > {
      const lignes = await db.lire<{
        id: string
        employee_id: string | null
        opened_at: string
        opening_float_millimes: number
        closed_at: string | null
        closed_by: string | null
        counted_millimes: number | null
        expected_millimes: number | null
        variance_millimes: number | null
      }>(
        `SELECT id, employee_id, opened_at, opening_float_millimes, closed_at,
                closed_by, counted_millimes, expected_millimes, variance_millimes
         FROM shifts WHERE pushed_at IS NULL ORDER BY opened_at LIMIT ?`,
        [limite],
      )
      return lignes.map((l) => ({
        id: l.id,
        employeId: l.employee_id,
        ouvertA: l.opened_at,
        fondDeCaisseMillimes: l.opening_float_millimes,
        fermeA: l.closed_at,
        fermePar: l.closed_by,
        compteMillimes: l.counted_millimes,
        attenduMillimes: l.expected_millimes,
        ecartMillimes: l.variance_millimes,
      }))
    },

    /** Marque poussé ce que le serveur a explicitement accusé, et rien d'autre. */
    async marquerShiftsPousses(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return
      const maintenant = new Date().toISOString()
      for (const id of ids) {
        await db.executer('UPDATE shifts SET pushed_at = ? WHERE id = ?', [maintenant, id])
      }
    },

    async ajouterMouvement(m: {
      id: string
      organizationId: string
      restaurantId: string
      shiftId: string
      type: MouvementCaisse['type']
      montantMillimes: number
      motif: string
      creePar: string | null
    }): Promise<void> {
      await db.executer(
        `INSERT INTO cash_movements (
           id, organization_id, restaurant_id, shift_id, type,
           amount_millimes, reason, created_by, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          m.id,
          m.organizationId,
          m.restaurantId,
          m.shiftId,
          m.type,
          m.montantMillimes,
          m.motif,
          m.creePar,
          new Date().toISOString(),
        ],
      )
    },

    async mouvementsDe(shiftId: string): Promise<MouvementCaisse[]> {
      const lignes = await db.lire<{
        id: string
        type: string
        amount_millimes: number
        reason: string
        created_at: string
        created_by: string | null
      }>(
        `SELECT id, type, amount_millimes, reason, created_at, created_by
         FROM cash_movements WHERE shift_id = ? ORDER BY created_at`,
        [shiftId],
      )
      return lignes.map((l) => ({
        id: l.id,
        type: l.type as MouvementCaisse['type'],
        montantMillimes: l.amount_millimes as Millimes,
        motif: l.reason,
        creeA: l.created_at,
        creePar: l.created_by,
      }))
    },

    /** Encaissements imputés au shift, pour le calcul de l'écart de caisse. */
    async encaissementsDe(shiftId: string): Promise<EncaissementShift[]> {
      const lignes = await db.lire<{
        id: string
        type: string
        amount_millimes: number
        voided_at: string | null
      }>(
        `SELECT p.id, p.type, p.amount_millimes, p.voided_at
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.shift_id = ? AND o.status = 'close'`,
        [shiftId],
      )
      return lignes.map((l) => ({
        paiementId: l.id,
        mode: l.type as ModePaiement,
        montantMillimes: l.amount_millimes as Millimes,
        annule: l.voided_at !== null,
      }))
    },

    async totauxDe(
      shiftId: string,
    ): Promise<{ nombreCommandes: number; chiffreAffairesMillimes: number }> {
      const l = await db.lireUne<{ n: number; ca: number | null }>(
        `SELECT COUNT(*) AS n, SUM(total_millimes) AS ca
         FROM orders WHERE shift_id = ? AND status = 'close'`,
        [shiftId],
      )
      return { nombreCommandes: l?.n ?? 0, chiffreAffairesMillimes: l?.ca ?? 0 }
    },

    // ── Commandes ────────────────────────────────────────────────────────
    async commandesOuvertes(): Promise<CommandeOuverte[]> {
      const lignes = await db.lire<{
        id: string
        table_id: string | null
        table_label: string | null
        type: string
        status: string
        ticket_number: string | null
        total_millimes: number
        articles: number | null
        opened_at: string
        sent_at: string | null
      }>(
        `SELECT o.id, o.table_id, t.label AS table_label, o.type, o.status,
                o.ticket_number, o.total_millimes, o.opened_at, o.sent_at,
                (SELECT SUM(qty) FROM order_items i
                  WHERE i.order_id = o.id AND i.voided_at IS NULL) AS articles
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE o.status IN ('ouverte','envoyee')
         ORDER BY o.opened_at`,
      )
      return lignes.map((l) => ({
        id: l.id,
        tableId: l.table_id,
        tableLabel: l.table_label,
        type: l.type,
        statut: l.status,
        numeroTicket: l.ticket_number,
        totalMillimes: l.total_millimes,
        nombreArticles: l.articles ?? 0,
        ouverteA: l.opened_at,
        envoyeeA: l.sent_at,
      }))
    },

    /** Commande ouverte occupant une table, s'il y en a une. */
    async commandeDeTable(tableId: string): Promise<string | null> {
      const l = await db.lireUne<{ id: string }>(
        `SELECT id FROM orders
         WHERE table_id = ? AND status IN ('ouverte','envoyee')
         ORDER BY opened_at LIMIT 1`,
        [tableId],
      )
      return l?.id ?? null
    },

    // ── Envois en cuisine ────────────────────────────────────────────────
    async lignesDejaEnvoyees(orderId: string): Promise<Set<string>> {
      const lignes = await db.lire<{ order_item_id: string }>(
        'SELECT order_item_id FROM kitchen_sends WHERE order_id = ?',
        [orderId],
      )
      return new Set(lignes.map((l) => l.order_item_id))
    },

    async marquerEnvoyees(
      orderId: string,
      lignesId: readonly string[],
      stationId: string | null,
      printJobId: string | null,
    ): Promise<void> {
      const maintenant = new Date().toISOString()
      await db.transaction(async () => {
        for (const ligneId of lignesId) {
          await db.executer(
            `INSERT OR IGNORE INTO kitchen_sends
               (id, order_id, order_item_id, station_id, sent_at, print_job_id)
             VALUES (?,?,?,?,?,?)`,
            [`${orderId}:${ligneId}`, orderId, ligneId, stationId, maintenant, printJobId],
          )
        }
      })
    },

    // ── Rapport du jour ──────────────────────────────────────────────────
    async rapportJournee(depuis: string, jusqua: string): Promise<RapportJournee> {
      const global = await db.lireUne<{
        n: number
        annulees: number
        ca: number | null
        remises: number | null
        taxes: number | null
        service: number | null
      }>(
        `SELECT
           SUM(CASE WHEN status = 'close'   THEN 1 ELSE 0 END) AS n,
           SUM(CASE WHEN status = 'annulee' THEN 1 ELSE 0 END) AS annulees,
           SUM(CASE WHEN status = 'close' THEN total_millimes    ELSE 0 END) AS ca,
           SUM(CASE WHEN status = 'close' THEN discount_millimes ELSE 0 END) AS remises,
           SUM(CASE WHEN status = 'close' THEN tax_millimes      ELSE 0 END) AS taxes,
           SUM(CASE WHEN status = 'close' THEN service_millimes  ELSE 0 END) AS service
         FROM orders
         WHERE opened_at >= ? AND opened_at < ?`,
        [depuis, jusqua],
      )

      const parMode = await db.lire<{ mode: string; n: number; montant: number }>(
        `SELECT p.type AS mode, COUNT(*) AS n, SUM(p.amount_millimes) AS montant
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.status = 'close' AND p.voided_at IS NULL
           AND o.opened_at >= ? AND o.opened_at < ?
         GROUP BY p.type ORDER BY montant DESC`,
        [depuis, jusqua],
      )

      const parProduit = await db.lire<{
        product_id: string | null
        designation: string
        quantite: number
        total: number
      }>(
        `SELECT i.product_id, i.designation,
                SUM(i.qty) AS quantite,
                SUM(i.line_total_millimes) AS total
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         WHERE o.status = 'close' AND i.voided_at IS NULL
           AND o.opened_at >= ? AND o.opened_at < ?
         GROUP BY i.product_id, i.designation
         ORDER BY total DESC`,
        [depuis, jusqua],
      )

      const nombre = global?.n ?? 0
      const ca = global?.ca ?? 0
      return {
        date: depuis.slice(0, 10),
        nombreCommandes: nombre,
        nombreAnnulees: global?.annulees ?? 0,
        chiffreAffairesMillimes: ca,
        remisesMillimes: global?.remises ?? 0,
        taxesMillimes: global?.taxes ?? 0,
        serviceMillimes: global?.service ?? 0,
        parMode: parMode.map((l) => ({
          mode: l.mode,
          nombre: l.n,
          montantMillimes: l.montant,
        })),
        parProduit: parProduit.map((l) => ({
          produitId: l.product_id,
          designation: l.designation,
          quantite: l.quantite,
          totalMillimes: l.total,
        })),
        // Arrondi entier : un ticket moyen s'exprime en millimes, pas en flottant.
        ticketMoyenMillimes: nombre > 0 ? Math.round(ca / nombre) : 0,
      }
    },
  }
}

function versShift(l: Record<string, never>): Shift {
  const r = l as unknown as {
    id: string
    organization_id: string
    restaurant_id: string
    device_id: string | null
    employee_id: string | null
    opened_at: string
    opening_float_millimes: number
    closed_at: string | null
    counted_millimes: number | null
    closing_note: string | null
  }
  return {
    id: r.id,
    organizationId: r.organization_id,
    restaurantId: r.restaurant_id,
    deviceId: r.device_id,
    employeId: r.employee_id,
    ouvertA: r.opened_at,
    fondDeCaisseMillimes: r.opening_float_millimes as Millimes,
    closA: r.closed_at,
    compteMillimes: (r.counted_millimes ?? null) as Millimes | null,
    noteCloture: r.closing_note,
  }
}

export type DepotCaisse = ReturnType<typeof depotCaisse>
