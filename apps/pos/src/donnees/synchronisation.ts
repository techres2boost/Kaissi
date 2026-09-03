/**
 * Branchement du moteur de synchronisation sur la base locale.
 *
 * Fait le pont entre `@kaissi/sync-client` (qui ne connaît que des
 * interfaces) et `@kaissi/db-local` (qui connaît SQLite).
 *
 * Le point délicat : les événements reçus des AUTRES appareils doivent être
 * écrits dans le journal local ET déclencher une reprojection, sinon
 * l'écran de salle n'afficherait jamais la commande ouverte par le collègue.
 */

import type { ConfigCalcul, EvenementCommande } from '@kaissi/domain'
import { projeterCommande } from '@kaissi/db-local'
import type { DepotLocalSync } from '@kaissi/sync-client'
import type { ContexteApplication } from './demarrage.js'

export function depotLocalSync(
  contexte: ContexteApplication,
  config: () => ConfigCalcul,
): DepotLocalSync {
  const db = contexte.base.adaptateur

  return {
    async lotAPousser(taille) {
      const lot = await contexte.journal.lotAPousser(taille)
      return lot.map((l) => ({ eventId: l.eventId, payload: l.payload }))
    },

    async accuserReception(eventIds) {
      await contexte.journal.accuserReception(eventIds)
    },

    async marquerRejet(eventId, code, message) {
      await contexte.journal.marquerRejet(eventId, code, message)
    },

    /**
     * Intègre les événements venus des autres terminaux.
     *
     * `INSERT OR IGNORE` : recevoir deux fois le même événement au fil de
     * deux pulls qui se chevauchent ne doit rien dupliquer localement.
     * On reprojette ensuite les commandes touchées, et elles seulement.
     */
    async integrerEvenements(evenements: readonly EvenementCommande[]) {
      if (evenements.length === 0) return
      const touchees = new Set<string>()

      await db.transaction(async () => {
        for (const e of evenements) {
          await db.executer(
            `INSERT OR IGNORE INTO order_events
               (event_id, order_id, organization_id, restaurant_id, device_id,
                seq_device, server_seq, type, payload, actor_user_id, client_ts,
                protocol_version)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
            [
              e.eventId, e.orderId, e.organizationId, e.restaurantId, e.deviceId,
              e.seqDevice, e.serverSeq, e.type, JSON.stringify(e.payload),
              e.acteurId ?? null, e.clientTs,
            ],
          )
          // Le serveur a attribué un curseur : on le note aussi sur nos
          // propres événements, c'est ce qui les fait passer devant les
          // événements encore locaux dans l'ordre canonique.
          if (e.serverSeq !== null) {
            await db.executer(
              'UPDATE order_events SET server_seq = ? WHERE event_id = ? AND server_seq IS NULL',
              [e.serverSeq, e.eventId],
            )
          }
          touchees.add(e.orderId)
        }
      })

      for (const orderId of touchees) {
        const journal = await contexte.journal.journalDe(orderId)
        if (journal.length > 0) {
          await projeterCommande(db, journal, config())
        }
      }
    },

    /**
     * Applique une page de changements du référentiel.
     *
     * Le catalogue est un miroir : on écrase la ligne locale par celle du
     * serveur. Aucun arbitrage n'est nécessaire — un appareil ne modifie
     * jamais le référentiel, il le reçoit.
     */
    async integrerCatalogue(changements) {
      if (changements.length === 0) return
      await db.transaction(async () => {
        for (const c of changements) {
          const table = TABLES_MIROIR[c.entite]
          if (!table) continue // entité que cette version ne connaît pas encore

          if (c.operation === 'delete') {
            await db.executer(`DELETE FROM ${table.nom} WHERE id = ?`, [c.entiteId])
            continue
          }
          if (!c.donnees) continue

          const colonnes = table.colonnes.filter((col) => col in c.donnees!)
          const valeurs = colonnes.map((col) => normaliser(c.donnees![col]))
          const marques = colonnes.map(() => '?').join(', ')
          const majSet = colonnes.map((col) => `${col} = excluded.${col}`).join(', ')
          await db.executer(
            `INSERT INTO ${table.nom} (${colonnes.join(', ')}) VALUES (${marques})
             ON CONFLICT (id) DO UPDATE SET ${majSet}`,
            valeurs,
          )
        }
      })
    },

    /**
     * Services de caisse restant à remonter.
     *
     * Le back-office lit `kaissi.shifts` pour son écran « Journée » ; sans
     * cette remontée, la table « Caisses » y reste vide même après une
     * prise de poste et une clôture — le gérant ne voit jamais son écart.
     */
    async shiftsAPousser(limite) {
      return contexte.caisse.shiftsAPousser(limite)
    },

    async accuserShifts(ids) {
      await contexte.caisse.marquerShiftsPousses(ids)
    },

    async lireCurseur(cle) {
      const brut = await contexte.etat.lire(
        cle === 'catalogue' ? 'last_catalog_seq' : 'last_event_seq',
      )
      return Number.parseInt(brut ?? '0', 10) || 0
    },

    async ecrireCurseur(cle, valeur) {
      await contexte.etat.ecrire(
        cle === 'catalogue' ? 'last_catalog_seq' : 'last_event_seq',
        String(valeur),
      )
    },

    async compteurs() {
      return contexte.journal.enAttente()
    },
  }
}

/**
 * Tables du référentiel répliquées localement, avec leurs colonnes.
 *
 * Liste EXPLICITE et non « toutes les colonnes reçues » : le serveur peut
 * être plus récent que l'application et envoyer des colonnes que ce schéma
 * local ne connaît pas encore. Les ignorer est exactement ce que demande le
 * support N−2 du protocole.
 */
const TABLES_MIROIR: Record<string, { nom: string; colonnes: string[] }> = {
  tax_rates: {
    nom: 'tax_rates',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'rate_bp',
               'is_included', 'is_default', 'archived_at'],
  },
  categories: {
    nom: 'categories',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'position',
               'color', 'archived_at'],
  },
  stations: {
    nom: 'stations',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'printer_host',
               'printer_port', 'position', 'archived_at'],
  },
  products: {
    nom: 'products',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'category_id', 'station_id',
               'tax_rate_id', 'name', 'description', 'base_price_millimes', 'color',
               'position', 'is_available', 'track_stock', 'archived_at'],
  },
  product_variants: {
    nom: 'product_variants',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'product_id', 'name',
               'price_delta_millimes', 'position', 'is_available', 'archived_at'],
  },
  modifier_groups: {
    nom: 'modifier_groups',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'min_select',
               'max_select', 'is_required', 'position', 'archived_at'],
  },
  modifiers: {
    nom: 'modifiers',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'modifier_group_id', 'name',
               'price_delta_millimes', 'position', 'is_available', 'archived_at'],
  },
  areas: {
    nom: 'areas',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'position', 'archived_at'],
  },
  tables: {
    nom: 'tables',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'area_id', 'label',
               'seats', 'archived_at'],
  },
  payment_methods: {
    nom: 'payment_methods',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'type',
               'opens_drawer', 'position', 'is_active', 'archived_at'],
  },
  // Côté serveur, un employé est la jointure de users et memberships ; le
  // journal de changements l'envoie déjà aplati à cette forme-là. L'appareil
  // reçoit le HACHAGE Argon2id du PIN, jamais le PIN : c'est ce qui lui
  // permet de valider une prise de poste sans réseau.
  employees: {
    nom: 'employees',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'full_name', 'role',
               'pin_hash', 'permissions', 'is_active', 'archived_at'],
  },
}

/** SQLite ne connaît ni booléen ni objet : on convertit à la frontière. */
function normaliser(valeur: unknown): string | number | null {
  if (valeur === null || valeur === undefined) return null
  if (typeof valeur === 'boolean') return valeur ? 1 : 0
  if (typeof valeur === 'number') return valeur
  if (typeof valeur === 'string') return valeur
  return JSON.stringify(valeur)
}
