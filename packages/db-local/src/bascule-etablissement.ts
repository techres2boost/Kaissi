/**
 * Basculer un terminal d'un établissement à un autre — et pourquoi c'est
 * une remise à zéro, pas un simple changement de jeton.
 *
 * ── Ce qui se passait sans cela ───────────────────────────────────────────
 *
 * PANNE OBSERVÉE. Un gérant ouvre un deuxième restaurant au back-office, y
 * crée ses employés, puis rouvre la caisse : elle affiche toujours la carte,
 * les employés et le stock du PREMIER. On conclut que le second restaurant
 * n'existe pas vraiment.
 *
 * La cause n'est pas l'appairage — il fonctionne, et le serveur rend bien un
 * appareil du second établissement. C'est la base LOCALE qui reste celle du
 * premier, et deux mécanismes indépendants la figent :
 *
 *   • `last_catalog_seq` est un curseur sur `change_log.seq`, qui est un
 *     `bigserial` **global à toute la base** (RÈGLE 4). Le terminal l'a déjà
 *     avancé loin en suivant le premier restaurant ; les entrées du second,
 *     écrites AVANT, portent des `seq` inférieurs. Elles ne seront donc
 *     JAMAIS tirées. Le catalogue du second n'arrive pas, et rien ne le dit ;
 *   • les tables miroir contiennent encore les produits, les employés et les
 *     réductions du premier. Même en tirant le catalogue du second, on
 *     obtiendrait l'UNION des deux — une carte mélangée, sur une caisse.
 *
 * ── La règle : on ne bascule pas avec des ventes en attente ───────────────
 *
 * Les événements encore dans l'outbox portent l'ANCIEN `device_id`. Le
 * serveur les refuserait « appareil_etranger », et un rejet ne se réessaie
 * jamais tout seul : ces ventes n'arriveraient JAMAIS. C'est pourquoi
 * l'appelant DOIT vérifier l'outbox avant d'appeler cette fonction —
 * `peutBasculer()` est là pour ça, et le refus est la bonne réponse.
 *
 * Perdre une vente coûte infiniment plus cher que de demander une
 * synchronisation de plus.
 *
 * ── Ce qui SURVIT à la bascule, et pourquoi ───────────────────────────────
 *
 * `installation_id` seulement. Il ne vient pas du serveur, il identifie
 * l'INSTALLATION et non l'appareil : le conserver est ce qui permet au
 * serveur de reconnaître ce terminal s'il revient un jour au premier
 * établissement, au lieu de créer une caisse de plus (migration 0021).
 */

import type { AdaptateurSqlite } from './adaptateur.js'
import { TABLES_MIROIR } from './miroir.js'

/**
 * Les tables TRANSACTIONNELLES purgées à la bascule.
 *
 * Elles décrivent l'activité du terminal dans l'établissement qu'il quitte :
 * ses ventes, ses services de caisse, ses envois en cuisine. Les garder ferait
 * apparaître le chiffre du premier restaurant sur l'écran « Journée » du
 * second — un chiffre faux qui aurait l'air juste.
 *
 * `order_events` en fait partie : c'est le journal LOCAL, dont `orders` et
 * `order_items` sont des projections. Il a déjà été remonté au serveur — la
 * vérification de l'outbox le garantit — et il y reste, immuable. Ce qu'on
 * efface ici est une copie de travail, jamais l'original.
 */
const TABLES_ACTIVITE = [
  'outbox',
  'order_events',
  'order_items',
  'payments',
  'orders',
  'kitchen_sends',
  'cash_movements',
  'shifts',
  'print_queue',
] as const

/** Les clés d'état remises à zéro. `installation_id` n'en fait PAS partie. */
const CLES_A_EFFACER = [
  // Les curseurs, d'abord : c'est le vrai piège de cette bascule.
  'last_catalog_seq',
  'last_event_seq',
  'seq_device',
  // L'identité attribuée par le serveur — la nouvelle sera écrite ensuite.
  'device_id',
  'restaurant_id',
  'organization_id',
  'ticket_prefix',
  'ticket_counter',
  // L'activité en cours : un service ouvert dans l'autre restaurant n'a
  // aucun sens ici, et un employé pointé non plus.
  'shift_courant',
  'employe_courant',
  'last_sync_at',
  'catalogue_applique_a',
  'derniere_impression_erreur',
] as const

export interface EtatBascule {
  /** Ventes pas encore remontées. Bloquant : elles seraient perdues. */
  readonly enAttente: number
  /** Opérations refusées par le serveur. Bloquant aussi — elles se règlent. */
  readonly rejetes: number
}

/**
 * Peut-on basculer sans rien perdre ?
 *
 * Les rejets comptent autant que les envois en attente : ils portent eux
 * aussi l'ancien `device_id`, et les effacer reviendrait à jeter une vente
 * qu'un gérant doit d'abord arbitrer.
 */
export function peutBasculer(etat: EtatBascule): boolean {
  return etat.enAttente === 0 && etat.rejetes === 0
}

/** Le message affiché quand on ne peut pas — il dit quoi faire, pas ce qui va mal. */
export function motifDeRefus(etat: EtatBascule): string | null {
  if (peutBasculer(etat)) return null
  const morceaux: string[] = []
  if (etat.enAttente > 0) {
    morceaux.push(
      `${etat.enAttente} opération(s) ne sont pas encore remontées. ` +
        'Synchronisez la caisse, puis recommencez.',
    )
  }
  if (etat.rejetes > 0) {
    morceaux.push(
      `${etat.rejetes} opération(s) ont été refusées par le serveur. ` +
        'Réglez-les avec le gérant avant de changer d’établissement — ' +
        'elles ne repartiraient pas toutes seules.',
    )
  }
  return (
    'Changement impossible sans perdre des ventes.\n\n' +
    morceaux.join('\n\n') +
    '\n\nCes opérations portent l’identité de l’ancien terminal : le serveur ' +
    'les refuserait définitivement après le changement.'
  )
}

/**
 * Vide la base locale pour accueillir un autre établissement.
 *
 * UNE transaction : une base à moitié vidée sur la tablette d'un restaurant à
 * Sfax n'est pas réparable à distance — c'est la même règle que pour les
 * migrations locales.
 */
export async function reinitialiserPourAutreEtablissement(
  db: AdaptateurSqlite,
): Promise<void> {
  await db.transaction(async () => {
    /*
     * ── Les clés étrangères, DIFFÉRÉES jusqu'au commit ────────────────────
     *
     * Ces tables se référencent les unes les autres : un produit pointe sa
     * catégorie, une ligne de commande pointe son produit, un modificateur
     * son groupe. Aucun ordre de suppression n'est donc « le bon » de façon
     * durable — celui qui marche aujourd'hui casse à la première table
     * ajoutée, avec un `constraint failed` que personne ne rattachera à ce
     * fichier. (Vu ici même : la première version de cette fonction échouait
     * exactement là.)
     *
     * `defer_foreign_keys` reporte TOUTES les vérifications au commit. À cet
     * instant, les tables sont vides : l'état final est cohérent par
     * construction, quel que soit l'ordre. On ne désactive rien — on décale.
     * Une incohérence réelle ferait toujours échouer le commit, et la
     * transaction entière serait annulée.
     */
    await db.executer('PRAGMA defer_foreign_keys = ON')

    /*
     * L'ACTIVITÉ d'abord, le RÉFÉRENTIEL ensuite. L'ordre n'est plus imposé
     * par la base, mais il reste celui qui se lit : on retire ce que le
     * terminal a produit, puis ce qu'il avait reçu.
     */
    for (const table of TABLES_ACTIVITE) {
      await db.executer(`DELETE FROM ${table}`)
    }

    for (const table of Object.values(TABLES_MIROIR)) {
      await db.executer(`DELETE FROM ${table.nom}`)
    }
    /*
     * `product_modifiers` n'est pas dans le miroir — c'est une table de
     * LIAISON, alimentée par le catalogue mais sans entité propre dans
     * `change_log`. L'oublier laisserait des rattachements orphelins qui
     * feraient apparaître des modificateurs du premier établissement sur les
     * produits du second.
     */
    await db.executer('DELETE FROM product_modifiers')
    await db.executer('DELETE FROM restaurants')

    for (const cle of CLES_A_EFFACER) {
      await db.executer('DELETE FROM sync_state WHERE cle = ?', [cle])
    }
  })
}
