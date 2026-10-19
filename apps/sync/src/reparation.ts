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

import type { DepotSync, RetentionRegistre } from './depot.js'
import { journal } from './journal.js'

/** Nombre d'événements récents examinés. Environ deux semaines de service. */
export const FENETRE_DEFAUT = 20_000

/** Plafond de commandes reconstruites en un tour. */
export const PLAFOND_DEFAUT = 500

export interface OptionsReparation {
  readonly fenetre?: number
  readonly plafond?: number
  /** Injectable : le balayage doit rester silencieux dans les tests. */
  readonly journaliser?: (message: string) => void
  /**
   * Âge au-delà duquel un marqueur « prêt » sort du journal de catalogue
   * (0029). 0 ou négatif : aucune purge.
   */
  readonly retentionPretsJours?: number
  /** Conservation du registre d'idempotence. `null` : aucune purge. */
  readonly retentionRegistre?: RetentionRegistre | null
  /**
   * Instant du dernier ménage du registre — injectable pour les tests. Le
   * ménage n'a lieu qu'une fois par jour, pas à chaque tour de 30 minutes.
   */
  readonly horloge?: () => number
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
  // Par défaut, le journal structuré : une ligne libre sur le tableau de bord
  // d'un hébergeur est indistinguable du reste, donc introuvable.
  const dire = options.journaliser ?? ((m: string) => journal.info(m))
  const retentionPrets = options.retentionPretsJours ?? RETENTION_PRETS_JOURS

  try {
    /*
     * Au passage : on allège le journal de catalogue de ses vieux « prêt ».
     *
     * Ils y descendent par le canal du catalogue (0029), ce qui rend la
     * fonction gratuite en protocole — mais ils sont bien plus nombreux
     * qu'un changement de prix. Sans purge, un terminal neuf rejouerait des
     * années de plats servis avant d'atteindre le catalogue courant.
     *
     * Jamais bloquant, et jamais fatal : perdre un balayage de projections
     * parce qu'un ménage a échoué serait un remède pire que le mal.
     */
    if (retentionPrets > 0) {
      try {
        const purges = await depot.purgerJournalPrets(retentionPrets)
        if (purges > 0) {
          dire(`  🧹 ${purges} marqueur(s) « prêt » retiré(s) du journal de catalogue.`)
        }
      } catch (erreur) {
        journal.avertissement('purge des marqueurs « prêt » impossible', { erreur })
      }
    }

    await purgerRegistreUneFoisParJour(depot, options, dire)

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

/**
 * Durée de vie d'un marqueur « prêt » dans le journal de catalogue.
 *
 * Sept jours : une tablette restée hors ligne plus longtemps n'a que faire
 * d'un plateau prêt la semaine dernière — le service est fini depuis
 * longtemps, et la commande encaissée.
 */
export const RETENTION_PRETS_JOURS = 7

/**
 * ── Le registre d'idempotence, et pourquoi on n'y purge PAS les ventes ────
 *
 * Question posée en démonstration : « on ne purge pas les tickets chaque
 * semaine ? la base va déborder ». Non — et c'est voulu. Une vente est une
 * pièce comptable et la source de vérité : la supprimer effacerait les
 * rapports, l'historique des clients, la preuve d'un écart de caisse. ⚠ Sa
 * durée de conservation légale relève de l'expert-comptable, pas de nous.
 *
 * Ce qui grossit SANS rien protéger, en revanche, c'est ce registre : une
 * ligne par événement reçu (environ 20 % du volume d'une vente), dont
 * l'idempotence est déjà tenue par la clé primaire de `order_events`.
 * Mesuré en production le 19/10 : 151 octets par ligne, six par commande.
 *
 * Le volume des ventes elles-mêmes se règle par l'offre de la base, puis par
 * un archivage des exercices clos — pas par une purge. Voir
 * docs/pret-pour-la-production.md §2.6.
 */
export const RETENTION_REGISTRE_DEFAUT: RetentionRegistre = {
  // Un reçu, rien de plus : l'idempotence est dans `order_events`.
  evenementsJours: 30,
  // Ici le registre EST la garantie : plus long que toute déconnexion
  // plausible d'une caisse (une tablette rangée trois mois dans un tiroir).
  catalogueJours: 180,
  // Remontés au gérant au moment du rejet ; gardés six mois pour l'enquête.
  rejetsJours: 180,
}

const UN_JOUR_MS = 24 * 60 * 60 * 1000
let dernierMenageRegistre = Number.NEGATIVE_INFINITY

/** Pour les tests : le prochain tour refera le ménage. */
export function oublierDernierMenage(): void {
  dernierMenageRegistre = Number.NEGATIVE_INFINITY
}

async function purgerRegistreUneFoisParJour(
  depot: DepotSync,
  options: OptionsReparation,
  dire: (message: string) => void,
): Promise<void> {
  const retention =
    options.retentionRegistre === undefined ? RETENTION_REGISTRE_DEFAUT : options.retentionRegistre
  if (!retention || !depot.purgerRegistreSynchronisation) return
  const maintenant = (options.horloge ?? Date.now)()
  if (maintenant - dernierMenageRegistre < UN_JOUR_MS) return
  dernierMenageRegistre = maintenant
  // Jamais fatal, comme la purge des « prêt » : un ménage manqué attend
  // simplement le jour suivant.
  try {
    const retirees = await depot.purgerRegistreSynchronisation(retention)
    if (retirees > 0) dire(`  🧹 ${retirees} accusé(s) de synchronisation périmé(s) retiré(s) du registre.`)
  } catch (erreur) {
    journal.avertissement('ménage du registre de synchronisation impossible', { erreur })
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
