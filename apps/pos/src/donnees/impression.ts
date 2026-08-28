/**
 * Service d'impression — draine la file persistante.
 *
 * Principe directeur : l'impression ne bloque JAMAIS la caisse. On met en
 * file, on rend la main immédiatement, et le drainage se fait en arrière-plan.
 * Une imprimante éteinte ne doit pas empêcher d'encaisser le client suivant —
 * elle doit allumer un badge rouge que le serveur voit.
 */

import { depuisBase64, versBase64 } from '@kaissi/printing'
import type { DepotImpression, TravailImpression } from '@kaissi/db-local'
import { ImprimanteReseau } from '../plugins/imprimante.js'
import { estNatif } from './sqlite.js'

export interface EtatImpression {
  readonly enAttente: number
  readonly echecs: number
  readonly enCours: boolean
}

export type EcouteurImpression = (etat: EtatImpression) => void

/**
 * Boucle de drainage. Une seule instance par application : deux boucles
 * concurrentes tenteraient le même travail et imprimeraient en double.
 */
export class ServiceImpression {
  private enCours = false
  private minuteur: ReturnType<typeof setTimeout> | null = null
  private readonly ecouteurs = new Set<EcouteurImpression>()

  constructor(
    private readonly file: DepotImpression,
    private readonly intervalleMs = 5_000,
  ) {}

  abonner(ecouteur: EcouteurImpression): () => void {
    this.ecouteurs.add(ecouteur)
    void this.notifier()
    return () => this.ecouteurs.delete(ecouteur)
  }

  private async notifier(): Promise<void> {
    const compteurs = await this.file.compteurs()
    const etat: EtatImpression = { ...compteurs, enCours: this.enCours }
    for (const e of this.ecouteurs) e(etat)
  }

  /** Met une charge en file et déclenche un drainage immédiat. */
  async mettreEnFile(travail: {
    id: string
    restaurantId: string
    orderId?: string | null
    stationId?: string | null
    kind: TravailImpression['kind']
    charge: Uint8Array
    hote: string | null
    port?: number
  }): Promise<void> {
    await this.file.mettreEnFile({ ...travail, chargeB64: versBase64(travail.charge) })
    void this.drainer()
  }

  /**
   * Tente d'imprimer les travaux en attente.
   * Réentrance protégée : un second appel pendant un drainage ne fait rien.
   */
  async drainer(): Promise<void> {
    if (this.enCours) return
    this.enCours = true
    void this.notifier()
    try {
      const travaux = await this.file.aImprimer()

      // Imprimantes déjà tombées DANS CETTE PASSE, avec leur erreur.
      //
      // Une imprimante éteinte fait échouer tous ses travaux de la même
      // façon. Sans cette mémoire, dix bons pour la même cuisine, c'est dix
      // `connect()` de quatre secondes : quarante secondes de travail
      // strictement inutile, toutes les cinq secondes, sur une tablette
      // d'entrée de gamme. On ne tente qu'UNE fois par imprimante et par
      // passe ; la suivante réessaiera.
      const tombees = new Map<string, string>()

      for (const travail of travaux) {
        if (!travail.hote) {
          await this.file.marquerEchec(
            travail.id,
            "Aucune adresse d'imprimante configurée pour cette station.",
          )
          continue
        }
        if (!estNatif()) {
          await this.file.marquerEchec(
            travail.id,
            "L'impression réseau n'existe que dans l'application Android.",
          )
          continue
        }

        const cible = `${travail.hote}:${travail.port}`
        const dejaTombee = tombees.get(cible)
        if (dejaTombee !== undefined) {
          // Le travail RESTE en file — il n'est ni perdu, ni compté comme
          // une tentative supplémentaire : c'est l'imprimante qui est en
          // panne, pas ce ticket-là.
          await this.file.marquerEchec(travail.id, dejaTombee)
          continue
        }

        await this.file.marquerEnCours(travail.id)
        try {
          await ImprimanteReseau.imprimer({
            hote: travail.hote,
            port: travail.port,
            charge: travail.chargeB64,
          })
          await this.file.marquerImprime(travail.id)
        } catch (erreur) {
          const message = erreur instanceof Error ? erreur.message : String(erreur)
          tombees.set(cible, message)
          await this.file.marquerEchec(travail.id, message)
        }
      }
    } finally {
      this.enCours = false
      void this.notifier()
    }
  }

  /** Réessaie périodiquement : une imprimante rallumée reprend seule. */
  demarrer(): void {
    if (this.minuteur !== null) return
    const boucle = () => {
      void this.drainer().finally(() => {
        this.minuteur = setTimeout(boucle, this.intervalleMs)
      })
    }
    this.minuteur = setTimeout(boucle, this.intervalleMs)
  }

  arreter(): void {
    if (this.minuteur !== null) {
      clearTimeout(this.minuteur)
      this.minuteur = null
    }
  }

  /** Aperçu texte d'un travail en file, pour l'écran « tickets non imprimés ». */
  static apercu(travail: TravailImpression): Uint8Array {
    return depuisBase64(travail.chargeB64)
  }
}
