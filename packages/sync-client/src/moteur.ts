/**
 * Moteur de synchronisation côté appareil.
 *
 * Discipline, dans cet ordre — et l'ordre compte :
 *   1. PUSH d'abord. Nos ventes partent avant qu'on ne s'intéresse à celles
 *      des autres : si le réseau ne tient que trois secondes, ce sont les
 *      encaissements locaux qui doivent en profiter.
 *   2. PULL ensuite, en boucle tant que le serveur dit « encore ».
 *   3. L'outbox ne se vide QUE sur accusé de réception explicite.
 *
 * Ce que le moteur ne fait jamais :
 *   • bloquer la caisse — tout est asynchrone et hors du chemin de vente ;
 *   • réessayer un REJET métier — un rejet remonte au gérant, il ne se
 *     répare pas tout seul ;
 *   • supprimer un événement local — le journal est en insertion seule.
 */

import type { EvenementCommande } from '@kaissi/domain'
import { delaiRetentative, estReessayable, type PolitiqueRetentative } from './index.js'
import { ErreurTransport, type Transport } from './transport.js'

export interface DepotLocalSync {
  /** Lot à pousser, le plus ancien d'abord. */
  lotAPousser(taille: number): Promise<readonly { eventId: string; payload: string }[]>
  /** Purge sur accusé de réception. */
  accuserReception(eventIds: readonly string[]): Promise<void>
  /** Consigne un rejet, sans jamais le supprimer. */
  marquerRejet(eventId: string, code: string, message: string): Promise<void>
  /** Écrit les événements reçus des autres appareils. */
  integrerEvenements(evenements: readonly EvenementCommande[]): Promise<void>
  /** Applique une page de changements du référentiel. */
  integrerCatalogue(
    changements: readonly {
      seq: number
      entite: string
      entiteId: string
      operation: string
      donnees: Record<string, unknown> | null
    }[],
  ): Promise<void>
  lireCurseur(cle: 'catalogue' | 'evenements'): Promise<number>
  ecrireCurseur(cle: 'catalogue' | 'evenements', valeur: number): Promise<void>
  /** Compteurs du bandeau : opérations en attente et rejets. */
  compteurs(): Promise<{ enAttente: number; rejetes: number }>
}

export type EtatSync =
  | 'inactif'
  | 'en_cours'
  | 'a_jour'
  | 'hors_ligne'
  | 'erreur'
  | 'bloque'

export interface ResumeSync {
  readonly etat: EtatSync
  readonly enAttente: number
  readonly rejetes: number
  readonly curseurEvenements: number
  readonly curseurCatalogue: number
  readonly derniereSyncA: string | null
  readonly derniereErreur: string | null
  readonly tentatives: number
}

export type EcouteurSync = (resume: ResumeSync) => void

export interface OptionsMoteur {
  readonly transport: Transport
  readonly depot: DepotLocalSync
  readonly genererId: () => string
  /** Intervalle nominal entre deux cycles, réseau disponible. */
  readonly intervalleMs?: number
  readonly tailleLot?: number
  readonly politique?: PolitiqueRetentative
  readonly maintenant?: () => number
}

export class MoteurSync {
  private minuteur: ReturnType<typeof setTimeout> | null = null
  private enCours = false
  private tentatives = 0
  private readonly ecouteurs = new Set<EcouteurSync>()
  private resume: ResumeSync = {
    etat: 'inactif',
    enAttente: 0,
    rejetes: 0,
    curseurEvenements: 0,
    curseurCatalogue: 0,
    derniereSyncA: null,
    derniereErreur: null,
    tentatives: 0,
  }

  private readonly options: OptionsMoteur

  constructor(options: OptionsMoteur) {
    this.options = options
  }

  abonner(ecouteur: EcouteurSync): () => void {
    this.ecouteurs.add(ecouteur)
    ecouteur(this.resume)
    return () => this.ecouteurs.delete(ecouteur)
  }

  get etat(): ResumeSync {
    return this.resume
  }

  private async publier(modifications: Partial<ResumeSync>): Promise<void> {
    const compteurs = await this.options.depot.compteurs()
    this.resume = { ...this.resume, ...compteurs, ...modifications }
    for (const e of this.ecouteurs) e(this.resume)
  }

  /**
   * Un cycle complet. Sûr à appeler en concurrence : un second appel
   * pendant un cycle est ignoré, sinon deux boucles pousseraient le même lot.
   */
  async cycle(): Promise<ResumeSync> {
    if (this.enCours) return this.resume
    this.enCours = true
    await this.publier({ etat: 'en_cours' })

    try {
      await this.pousser()
      await this.tirer()
      this.tentatives = 0
      await this.publier({
        etat: 'a_jour',
        derniereSyncA: new Date(this.now()).toISOString(),
        derniereErreur: null,
        tentatives: 0,
      })
    } catch (erreur) {
      this.tentatives += 1
      const definitive = erreur instanceof ErreurTransport && erreur.definitive
      await this.publier({
        // « bloqué » ≠ « hors ligne » : le premier exige une action humaine,
        // le second se résout tout seul au retour du réseau.
        etat: definitive ? 'bloque' : erreur instanceof ErreurTransport ? 'hors_ligne' : 'erreur',
        derniereErreur: erreur instanceof Error ? erreur.message : String(erreur),
        tentatives: this.tentatives,
      })
    } finally {
      this.enCours = false
    }
    return this.resume
  }

  /** Étape 1 — nos ventes partent d'abord. */
  private async pousser(): Promise<void> {
    const taille = this.options.tailleLot ?? 200
    for (;;) {
      const lot = await this.options.depot.lotAPousser(taille)
      if (lot.length === 0) return

      const evenements = lot.map((l) => JSON.parse(l.payload) as EvenementCommande)
      const reponse = await this.options.transport.push(this.options.genererId(), evenements)

      // Acceptés = insérés + doublons. Dans les deux cas l'événement est
      // chez le serveur : l'outbox peut s'en séparer sans risque.
      if (reponse.acceptes.length > 0) {
        await this.options.depot.accuserReception(reponse.acceptes)
      }
      for (const rejet of reponse.rejetes) {
        await this.options.depot.marquerRejet(rejet.eventId, rejet.code, rejet.message)
      }
      await this.options.depot.ecrireCurseur('evenements', reponse.curseurEvenements)
      await this.publier({ curseurEvenements: reponse.curseurEvenements })

      // Ni accepté ni rejeté : le serveur n'a rien traité. Insister
      // boucherait la boucle à l'infini sur le même lot.
      if (reponse.acceptes.length === 0 && reponse.rejetes.length === 0) return
      if (lot.length < taille) return
    }
  }

  /** Étape 2 — on rattrape ce que les autres appareils ont produit. */
  private async tirer(): Promise<void> {
    // Borne dure : un appareil très en retard rattrape sur plusieurs cycles
    // plutôt que de monopoliser le processeur de la tablette en plein service.
    const PAGES_MAX = 20
    for (let page = 0; page < PAGES_MAX; page += 1) {
      const [curseurCatalogue, curseurEvenements] = await Promise.all([
        this.options.depot.lireCurseur('catalogue'),
        this.options.depot.lireCurseur('evenements'),
      ])
      const reponse = await this.options.transport.pull(curseurCatalogue, curseurEvenements)

      if (reponse.catalogue.length > 0) {
        await this.options.depot.integrerCatalogue(reponse.catalogue)
        await this.options.depot.ecrireCurseur('catalogue', reponse.curseurCatalogue)
      }
      if (reponse.evenements.length > 0) {
        await this.options.depot.integrerEvenements(reponse.evenements)
        await this.options.depot.ecrireCurseur('evenements', reponse.curseurEvenements)
      }
      await this.publier({
        curseurCatalogue: reponse.curseurCatalogue,
        curseurEvenements: reponse.curseurEvenements,
      })

      if (!reponse.encore) return
    }
  }

  /** Boucle de fond. Le délai s'allonge quand le réseau ne répond pas. */
  demarrer(): void {
    if (this.minuteur !== null) return
    const planifier = (delai: number) => {
      this.minuteur = setTimeout(() => {
        void this.cycle().finally(() => {
          if (this.minuteur === null) return
          planifier(this.prochainDelai())
        })
      }, delai)
    }
    planifier(0)
  }

  arreter(): void {
    if (this.minuteur !== null) {
      clearTimeout(this.minuteur)
      this.minuteur = null
    }
  }

  private prochainDelai(): number {
    if (this.tentatives === 0) return this.options.intervalleMs ?? 15_000
    // Recul exponentiel avec gigue : quarante tablettes qui se reconnectent
    // en même temps après une coupure de quartier ne doivent pas taper
    // toutes à la même seconde.
    return delaiRetentative(this.tentatives - 1, this.options.politique)
  }

  private now(): number {
    return this.options.maintenant?.() ?? Date.now()
  }
}

export { estReessayable }
