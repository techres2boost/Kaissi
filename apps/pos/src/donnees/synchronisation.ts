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
import { appliquerMiroir, projeterCommande } from '@kaissi/db-local'
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
      // Le miroir lui-même vit dans `@kaissi/db-local` : il parle du schéma
      // local, pas du réseau, et c'est là qu'il est testable contre une vraie
      // base — y compris pour ce qui compte le plus, un PIN réinitialisé qui
      // doit prendre effet sur la tablette.
      const touchees = await db.transaction(() => appliquerMiroir(db, changements))
      /*
       * On note QUAND le catalogue a réellement changé.
       *
       * « Dernière synchronisation » répond déjà à « ai-je du réseau ». Elle
       * ne répond pas à la question qu'on se pose vraiment devant une caisse
       * qui refuse un code PIN tout juste réinitialisé : est-ce que CE
       * changement-là est arrivé jusqu'ici ? Un contact réseau permanent et
       * un catalogue vieux de trois jours se ressemblent exactement, sans
       * cette ligne.
       */
      if (touchees > 0) {
        await contexte.etat.ecrire('catalogue_applique_a', new Date().toISOString())
      }
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
