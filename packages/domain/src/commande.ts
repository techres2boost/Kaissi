/**
 * Assemblage : journal d'événements → état → totaux.
 *
 * C'est l'entrée unique utilisée par l'écran de caisse, par le rendu du
 * ticket et par la projection serveur. Une seule fonction, un seul résultat.
 */

import { pointsDeBase } from './monnaie.js'
import { calculerRendu, calculerTotaux, type ResultatEncaissement } from './totaux.js'
import { reduireEvenements, totalVerse, type EtatCommande } from './reduction.js'
import type { EvenementCommande } from './evenements.js'
import type { ConfigCalcul, TotauxCommande } from './types.js'

export interface CommandeComplete {
  readonly etat: EtatCommande
  readonly totaux: TotauxCommande
  readonly encaissement: ResultatEncaissement
}

/**
 * Reconstruit une commande complète depuis son journal.
 *
 * La configuration de service portée par la commande (`service.set`) prime
 * sur la configuration par défaut de l'établissement : un serveur peut
 * retirer le service sur une commande à emporter.
 */
export function reconstruireCommande(
  evenements: readonly EvenementCommande[],
  config: ConfigCalcul,
): CommandeComplete {
  const etat = reduireEvenements(evenements)
  const configEffective: ConfigCalcul = etat.service
    ? {
        ...config,
        service: {
          tauxBp: pointsDeBase(etat.service.tauxBp),
          taxable: etat.service.taxable,
          tauxTaxeId: etat.service.tauxTaxeId ?? undefined,
        },
      }
    : config

  const totaux = calculerTotaux({
    lignes: etat.lignes,
    remiseGlobale: etat.remiseGlobale ?? undefined,
    config: configEffective,
  })

  return {
    etat,
    totaux,
    encaissement: calculerRendu(totaux.totalMillimes, totalVerse(etat)),
  }
}
