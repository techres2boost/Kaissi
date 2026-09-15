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
 * La configuration RÉELLEMENT appliquée à une commande.
 *
 * Le service porté par la commande (`service.set`) prime sur celui de
 * l'établissement : un serveur peut le retirer sur une commande à emporter.
 * Absent, c'est le réglage de l'établissement qui s'applique — celui que
 * « Paramètres → Options de restauration » pose, et que `change_log` fait
 * descendre.
 *
 * ── Pourquoi cette fonction est EXPORTÉE ──────────────────────────────────
 *
 * Parce que trois endroits reconstruisent une commande : l'écran de caisse,
 * le projecteur local (`@kaissi/db-local`) et la reprojection serveur
 * (`apps/sync`). Les trois recopiaient ces huit lignes — et le serveur, lui,
 * ne les recopiait PAS : il passait `config` tel quel.
 *
 * Conséquence, si une commande portait un `service.set` : la tablette
 * imprimait un ticket AVEC service, le serveur reprojetait la même vente
 * SANS, et le back-office affichait un total inférieur à celui que le client
 * avait payé. Aucune erreur nulle part — juste deux chiffres qui ne se
 * rejoignent jamais, et c'est exactement l'écart de caisse que la RÈGLE 7
 * interdit. Une seule copie, donc, et les trois appellent celle-ci.
 */
export function configEffective(
  config: ConfigCalcul,
  etat: Pick<EtatCommande, 'service'>,
): ConfigCalcul {
  if (!etat.service) return config
  return {
    ...config,
    service: {
      tauxBp: pointsDeBase(etat.service.tauxBp),
      taxable: etat.service.taxable,
      tauxTaxeId: etat.service.tauxTaxeId ?? undefined,
    },
  }
}

/**
 * Reconstruit une commande complète depuis son journal.
 *
 * C'est l'entrée unique : état, totaux et encaissement en un appel, avec la
 * configuration effective déjà résolue.
 */
export function reconstruireCommande(
  evenements: readonly EvenementCommande[],
  config: ConfigCalcul,
): CommandeComplete {
  const etat = reduireEvenements(evenements)

  const totaux = calculerTotaux({
    lignes: etat.lignes,
    remiseGlobale: etat.remiseGlobale ?? undefined,
    config: configEffective(config, etat),
  })

  return {
    etat,
    totaux,
    encaissement: calculerRendu(totaux.totalMillimes, totalVerse(etat)),
  }
}
