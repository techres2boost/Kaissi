/**
 * Auto-réparation des projections — au démarrage, puis périodiquement.
 *
 * ── Pourquoi le serveur se répare tout seul ────────────────────────────────
 *
 * `order_events` est la source de vérité ; `orders`, `order_items` et
 * `payments` n'en sont que des projections. Une projection perdue n'est donc
 * JAMAIS une donnée perdue : elle est toujours reconstructible.
 *
 * Restait à savoir QUI la reconstruit. Un outil en ligne de commande
 * (`pnpm sync:reprojeter`) suppose que quelqu'un remarque le trou, sache
 * qu'il existe, et dispose de la chaîne de connexion à la base de
 * production. Autrement dit : un restaurateur à Sfax ne le lancera jamais,
 * et il aura raison. Une vente invisible au back-office doit se réparer
 * SEULE — c'est tout l'intérêt d'avoir choisi un journal d'événements.
 *
 * Le service balaie donc les commandes dont les événements sont arrivés mais
 * dont la projection manque, et les reconstruit — au démarrage, puis toutes
 * les demi-heures (voir `planifierReparation`, et pourquoi le démarrage seul
 * ne suffisait pas).
 *
 * ── Ce que ce balayage ne fait PAS ────────────────────────────────────────
 *
 *   • il n'écrit jamais dans `order_events` : la source de vérité reste
 *     intacte, en insertion seule ;
 *   • il ne touche AUCUNE commande déjà projetée. Rejouer tout l'historique
 *     est une opération d'heures creuses, pas de balayage automatique ;
 *   • il ne bloque pas l'écoute. Il est lancé APRÈS l'ouverture du port :
 *     une caisse doit pouvoir se synchroniser pendant que la réparation
 *     tourne, et un balayage lent ne doit pas faire échouer la sonde de
 *     santé de l'hébergeur — ce qui déclencherait un redémarrage, donc un
 *     nouveau balayage, en boucle ;
 *   • il n'interrompt jamais le démarrage sur une erreur. Un service qui
 *     refuse de servir parce qu'une réparation facultative a échoué serait
 *     un remède pire que le mal.
 *
 * ── Pourquoi une fenêtre, et pourquoi sur `server_seq` ────────────────────
 *
 * Le balayage est borné aux derniers événements reçus. Sans borne, chaque
 * démarrage relirait tout le journal — sur une base de plusieurs millions de
 * lignes, à chaque redéploiement.
 *
 * La borne est un intervalle de `server_seq`, jamais une durée : c'est le
 * curseur du protocole (règle 4), il est indexé, et il ne dépend d'aucune
 * horloge. Une commande plus ancienne que la fenêtre a déjà été vue par un
 * tour précédent ; si elle avait besoin d'être réparée, elle l'a été.
 */

import type { DepotSync } from './depot.js'

/** Nombre d'événements récents examinés. Environ deux semaines de service. */
export const FENETRE_DEFAUT = 20_000

/** Plafond de commandes reconstruites en un tour. */
export const PLAFOND_DEFAUT = 500

export interface OptionsReparation {
  readonly fenetre?: number
  readonly plafond?: number
  /** Injectable : le balayage doit rester silencieux dans les tests. */
  readonly journaliser?: (message: string) => void
}

export interface ResultatReparation {
  readonly examinees: number
  readonly reparees: number
  readonly erreur?: string
}

/**
 * Reconstruit les projections manquantes des derniers événements reçus.
 *
 * Ne lance jamais : un échec est rendu dans `erreur`. L'appelant est le
 * démarrage du service — puis un minuteur — et ni l'un ni l'autre ne doit
 * dépendre de la réussite de ceci.
 */
export async function reparerProjectionsOrphelines(
  depot: DepotSync,
  options: OptionsReparation = {},
): Promise<ResultatReparation> {
  const fenetre = options.fenetre ?? FENETRE_DEFAUT
  const plafond = options.plafond ?? PLAFOND_DEFAUT
  const dire = options.journaliser ?? ((m: string) => console.log(m))

  try {
    const orphelines = await depot.projectionsOrphelines(fenetre, plafond)
    if (orphelines.length === 0) return { examinees: 0, reparees: 0 }

    // Regroupées PAR ÉTABLISSEMENT : la reprojection charge la configuration
    // de calcul (taux de TVA, service, timbre) du restaurant. La mélanger
    // entre deux établissements donnerait des totaux faux — et un total faux
    // est pire qu'une projection absente, parce qu'il a l'air juste.
    const parEtablissement = new Map<string, string[]>()
    for (const { restaurantId, orderId } of orphelines) {
      const liste = parEtablissement.get(restaurantId)
      if (liste) liste.push(orderId)
      else parEtablissement.set(restaurantId, [orderId])
    }

    let reparees = 0
    for (const [restaurantId, orderIds] of parEtablissement) {
      await depot.reprojeter(restaurantId, orderIds)
      reparees += orderIds.length
    }

    dire(
      `  ⟳ ${reparees} vente(s) sans projection reconstruite(s) depuis le journal` +
        ` (${parEtablissement.size} établissement(s)).` +
        (orphelines.length >= plafond
          ? `\n    Plafond de ${plafond} atteint : le tour suivant prendra la suite.`
          : ''),
    )
    return { examinees: orphelines.length, reparees }
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur)
    // On le DIT, sans faire tomber le service : les ventes sont dans le
    // journal, elles ne sont pas perdues, et la caisse doit continuer.
    dire(
      `  ⚠ Le balayage des projections a échoué : ${message}` +
        '\n    Aucune vente perdue — elles restent dans le journal.' +
        '\n    La synchronisation fonctionne normalement.',
    )
    return { examinees: 0, reparees: 0, erreur: message }
  }
}

/** Intervalle par défaut entre deux balayages, en minutes. */
export const INTERVALLE_DEFAUT_MINUTES = 30

export interface OptionsPlanification extends OptionsReparation {
  /** 0 ou négatif : aucun balayage périodique, seulement celui du démarrage. */
  readonly intervalleMinutes?: number
}

/**
 * Lance le balayage au démarrage, puis le répète.
 *
 * ── Pourquoi le démarrage NE SUFFIT PAS ───────────────────────────────────
 *
 * Première version de ce code : un seul balayage, au démarrage. L'erreur
 * s'est vue tout de suite en production — deux ventes attendaient d'être
 * reconstruites, le correctif était en ligne, et rien ne se passait, parce
 * que l'hébergeur n'avait tout simplement pas encore redéployé.
 *
 * Faire dépendre la réparation d'un redéploiement, c'est la faire dépendre
 * d'une action humaine — la même que celle qu'on voulait supprimer, déguisée.
 * Un service de synchronisation tourne des semaines sans redémarrer ; c'est
 * même le but.
 *
 * Le balayage se répète donc tout seul. Une demi-heure est volontairement
 * lente : ce n'est pas un mécanisme de temps réel — le chemin normal reste
 * la reprojection immédiate au push — c'est un filet, et un filet qu'on
 * relève trop souvent coûte plus qu'il ne rapporte.
 *
 * Le minuteur est `unref()` : il n'empêche jamais le process de s'arrêter.
 * Sans cela, un SIGTERM d'hébergeur attendrait le prochain tour, et le
 * redéploiement paraîtrait bloqué.
 */
export function planifierReparation(
  depot: DepotSync,
  options: OptionsPlanification = {},
): () => void {
  const minutes = options.intervalleMinutes ?? INTERVALLE_DEFAUT_MINUTES

  // Un seul balayage à la fois. Sur une base lente, deux tours qui se
  // chevauchent reprojetteraient les mêmes commandes en concurrence — sans
  // rien casser (la reprojection est idempotente), mais en doublant la
  // charge exactement quand elle est déjà trop haute.
  let enCours = false
  const tour = async () => {
    if (enCours) return
    enCours = true
    try {
      await reparerProjectionsOrphelines(depot, options)
    } finally {
      enCours = false
    }
  }

  void tour()

  if (minutes <= 0) return () => {}

  const minuteur = setInterval(() => void tour(), minutes * 60_000)
  minuteur.unref()
  return () => clearInterval(minuteur)
}
