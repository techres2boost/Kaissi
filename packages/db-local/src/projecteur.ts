/**
 * Projecteur — journal d'événements → tables `orders` / `order_items` / `payments`.
 *
 * Le POS n'interroge JAMAIS le journal pour afficher une liste de commandes :
 * rejouer les événements de la journée à chaque rafraîchissement d'écran
 * rendrait la caisse lente en fin de service, précisément au moment où elle
 * doit être rapide. Il lit ces projections, reconstruites ici.
 *
 * Le repli utilise `@kaissi/domain` — le MÊME code que le serveur. Une
 * projection locale et une projection serveur ne peuvent donc pas diverger.
 *
 * Écriture des événements et mise à jour des projections sont UNE SEULE
 * transaction : sinon un arrêt brutal laisserait une vente dans le journal
 * mais invisible à l'écran, ou l'inverse.
 */

import {
  calculerTotaux,
  reduireEvenements,
  totalVerse,
  type ConfigCalcul,
  type EtatCommande,
  type EvenementCommande,
  type TotauxCommande,
} from '@kaissi/domain'
import type { AdaptateurSqlite } from './adaptateur.js'

export interface ResultatProjection {
  readonly etat: EtatCommande
  readonly totaux: TotauxCommande
}

/**
 * Recalcule la projection d'une commande depuis son journal complet.
 * Idempotent : rejouer donne exactement le même résultat.
 */
export async function projeterCommande(
  db: AdaptateurSqlite,
  evenements: readonly EvenementCommande[],
  config: ConfigCalcul,
  contexte: { shiftId?: string | null } = {},
): Promise<ResultatProjection> {
  const etat = reduireEvenements(evenements)
  const totaux = calculerTotaux({
    lignes: etat.lignes,
    remiseGlobale: etat.remiseGlobale ?? undefined,
    config: etat.service
      ? {
          ...config,
          service: {
            tauxBp: etat.service.tauxBp as never,
            taxable: etat.service.taxable,
            tauxTaxeId: etat.service.tauxTaxeId ?? undefined,
          },
        }
      : config,
  })
  const verse = totalVerse(etat)
  const maintenant = new Date().toISOString()

  await db.transaction(async () => {
    await db.executer(
      `INSERT INTO orders (
         id, organization_id, restaurant_id, table_id, device_id, opened_by,
         type, status, covers, ticket_number,
         subtotal_millimes, discount_millimes, tax_millimes, service_millimes,
         stamp_duty_millimes, total_millimes, paid_millimes,
         tax_breakdown, exceptions,
         opened_at, sent_at, closed_at, cancelled_at,
         last_event_seq, event_count, updated_at,
         shift_id, closed_by, cancel_reason, customer_name
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET
         table_id = excluded.table_id,
         status = excluded.status,
         covers = excluded.covers,
         ticket_number = COALESCE(excluded.ticket_number, orders.ticket_number),
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
         last_event_seq = excluded.last_event_seq,
         event_count = excluded.event_count,
         updated_at = excluded.updated_at,
         closed_by = excluded.closed_by,
         cancel_reason = excluded.cancel_reason,
         customer_name = excluded.customer_name,
         -- Le shift d'origine ne se réécrit pas : une commande ouverte sur le
         -- shift du matin reste imputée au matin, même encaissée à midi.
         shift_id = COALESCE(orders.shift_id, excluded.shift_id)`,
      [
        etat.id,
        etat.organizationId,
        etat.restaurantId,
        etat.tableId,
        etat.deviceProprietaireId ?? '',
        etat.ouvertePar,
        etat.type,
        etat.statut,
        etat.couverts,
        etat.numeroTicket,
        totaux.sousTotalMillimes,
        totaux.totalRemisesMillimes,
        totaux.taxeMillimes,
        totaux.serviceMillimes,
        totaux.timbreFiscalMillimes,
        totaux.totalMillimes,
        verse,
        JSON.stringify(totaux.ventilationTaxes),
        JSON.stringify(etat.exceptions),
        etat.ouverteA ?? maintenant,
        etat.envoyeeA,
        etat.closeA,
        etat.annuleeA,
        etat.derniereSeqServeur ?? 0,
        etat.nombreEvenements,
        maintenant,
        contexte.shiftId ?? null,
        etat.closePar,
        etat.annuleeMotif,
        etat.clientNom,
      ],
    )

    // Les lignes sont entièrement reconstruites : c'est une projection, pas
    // un état mutable. Le journal reste la seule source de vérité.
    await db.executer('DELETE FROM order_items WHERE order_id = ?', [etat.id])
    let position = 0
    for (const ligne of etat.lignes) {
      const calculee = totaux.lignes.find((c) => c.id === ligne.id)
      await db.executer(
        `INSERT INTO order_items (
           id, order_id, organization_id, restaurant_id, product_id, variant_id,
           station_id, tax_rate_id, designation, qty,
           unit_price_millimes, modifiers_millimes, line_gross_millimes,
           line_discount_millimes, global_discount_share_millimes,
           line_total_millimes, line_tax_millimes,
           modifiers, note, position, voided_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          ligne.id,
          etat.id,
          etat.organizationId,
          etat.restaurantId,
          ligne.produitId,
          ligne.variantId,
          ligne.stationId,
          ligne.tauxTaxeId,
          ligne.designation,
          ligne.quantite,
          calculee?.prixUnitaireMillimes ?? ligne.prixBaseMillimes,
          ligne.modificateursMillimes,
          calculee?.totalBrutMillimes ?? 0,
          calculee?.remiseLigneMillimes ?? 0,
          calculee?.remiseGlobaleRepartieMillimes ?? 0,
          calculee?.baseApresRemisesMillimes ?? 0,
          calculee?.taxeMillimes ?? 0,
          JSON.stringify(ligne.modificateurs),
          ligne.note,
          position,
          ligne.annulee ? ligne.ajouteeA : null,
        ],
      )
      position += 1
    }

    await db.executer('DELETE FROM payments WHERE order_id = ?', [etat.id])
    for (const paiement of etat.paiements) {
      await db.executer(
        `INSERT INTO payments (
           id, order_id, organization_id, restaurant_id, method_id, type,
           amount_millimes, received_millimes, change_millimes, reference,
           shift_id, voided_at, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          paiement.id,
          etat.id,
          etat.organizationId,
          etat.restaurantId,
          paiement.methodeId,
          paiement.mode,
          paiement.montantMillimes,
          paiement.recuMillimes,
          paiement.renduMillimes ?? 0,
          paiement.reference,
          contexte.shiftId ?? null,
          paiement.annule ? paiement.enregistreA : null,
          paiement.enregistreA,
        ],
      )
    }
  })

  return { etat, totaux }
}
