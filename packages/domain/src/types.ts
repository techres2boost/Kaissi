/**
 * Types métier partagés — POS, API de synchronisation et back-office
 * importent EXACTEMENT ces définitions. Aucune duplication ailleurs.
 */

import type { Millimes, PointsDeBase } from './monnaie.js'

/** Identifiant d'entité : UUIDv7 généré côté client (voir `uuid.ts`). */
export type Uuid = string

/** Un taux de taxe tel que configuré pour un établissement. */
export interface TauxTaxe {
  readonly id: Uuid
  readonly nom: string
  /** Points de base entiers : 19 % = 1900. */
  readonly tauxBp: PointsDeBase
  /**
   * `true` : le prix affiché est TTC, la taxe est extraite du prix.
   * `false` : le prix est HT, la taxe s'ajoute au total.
   */
  readonly incluse: boolean
}

/** Une remise, exprimée soit en montant fixe, soit en pourcentage (bp). */
export type Remise =
  | { readonly type: 'montant'; readonly valeurMillimes: Millimes; readonly motif?: string }
  | { readonly type: 'pourcentage'; readonly valeurBp: PointsDeBase; readonly motif?: string }

/** Une ligne de commande, telle qu'elle entre dans le calcul des totaux. */
export interface LigneCalculable {
  readonly id: Uuid
  /** Prix unitaire de base du produit (ou du variant). */
  readonly prixBaseMillimes: Millimes
  /** Somme des deltas des modificateurs, PAR UNITÉ. */
  readonly modificateursMillimes: Millimes
  /** Quantité entière. Les quantités fractionnaires sont hors périmètre POS. */
  readonly quantite: number
  /** Identifiant du taux de taxe applicable à cette ligne. */
  readonly tauxTaxeId: Uuid
  /** Remise appliquée à CETTE ligne, avant la remise globale. */
  readonly remise?: Remise
  /** Une ligne annulée reste dans le journal mais ne compte plus. */
  readonly annulee?: boolean
}

/** Frais de service (« service compris »), configurable par établissement. */
export interface ConfigService {
  /** Taux en points de base : 10 % = 1000. */
  readonly tauxBp: PointsDeBase
  /** `true` : le service est lui-même soumis à la TVA. */
  readonly taxable: boolean
  /** Taux de TVA applicable au service, si `taxable`. */
  readonly tauxTaxeId?: Uuid
}

/** Configuration de calcul d'un établissement. */
export interface ConfigCalcul {
  /** Table des taux, indexée par identifiant. */
  readonly tauxTaxes: Readonly<Record<Uuid, TauxTaxe>>
  /** Frais de service, absent si l'établissement n'en pratique pas. */
  readonly service?: ConfigService
  /**
   * Droit de timbre fiscal : montant FIXE ajouté au total.
   * ⚠ Le montant et les conditions d'application doivent être validés par un
   * expert-comptable tunisien — voir docs/architecture.md, partie « Argent ».
   */
  readonly timbreFiscalMillimes?: Millimes
}

/** Détail calculé d'une ligne, tel qu'il est imprimé et projeté en base. */
export interface LigneCalculee {
  readonly id: Uuid
  readonly quantite: number
  /** prixBase + modificateurs, par unité. */
  readonly prixUnitaireMillimes: Millimes
  /** prixUnitaire × quantité, avant toute remise. */
  readonly totalBrutMillimes: Millimes
  /** Remise propre à la ligne (étape 3). */
  readonly remiseLigneMillimes: Millimes
  /** Quote-part de la remise globale attribuée à la ligne (étape 4). */
  readonly remiseGlobaleRepartieMillimes: Millimes
  /** totalBrut − remiseLigne − remiseGlobaleRepartie. */
  readonly baseApresRemisesMillimes: Millimes
  readonly tauxTaxeId: Uuid
  /** Base hors taxe de la ligne (= base après remises si le taux est exclusif). */
  readonly baseHtMillimes: Millimes
  /** Part de TVA imputée à la ligne. */
  readonly taxeMillimes: Millimes
  /** `true` si cette ligne a absorbé l'écart résiduel de répartition. */
  readonly absorbeEcartResiduel: boolean
}

/** Une ligne de la ventilation de TVA, imprimée en pied de ticket. */
export interface VentilationTaxe {
  readonly tauxTaxeId: Uuid
  readonly nom: string
  readonly tauxBp: PointsDeBase
  readonly incluse: boolean
  readonly baseHtMillimes: Millimes
  readonly taxeMillimes: Millimes
}

/** Résultat complet du calcul d'une commande. */
export interface TotauxCommande {
  readonly lignes: readonly LigneCalculee[]
  /** Σ totalBrut — étape 2. */
  readonly sousTotalMillimes: Millimes
  /** Σ des remises de ligne — étape 3. */
  readonly remisesLignesMillimes: Millimes
  /** Remise globale effectivement appliquée (éventuellement plafonnée) — étape 4. */
  readonly remiseGlobaleMillimes: Millimes
  readonly totalRemisesMillimes: Millimes
  /** Σ base après remises, toutes lignes confondues. */
  readonly baseApresRemisesMillimes: Millimes
  /** Ventilation par taux — étape 5 et 6. */
  readonly ventilationTaxes: readonly VentilationTaxe[]
  /** Σ des taxes, incluses ET exclusives. */
  readonly taxeMillimes: Millimes
  /** Part des taxes qui S'AJOUTE au total (taux exclusifs uniquement). */
  readonly taxeExclusiveMillimes: Millimes
  /** Frais de service — étape 7. */
  readonly serviceMillimes: Millimes
  readonly taxeServiceMillimes: Millimes
  /** Droit de timbre fiscal. */
  readonly timbreFiscalMillimes: Millimes
  /** Total à payer — étape 8. */
  readonly totalMillimes: Millimes
  /** Écart d'arrondi absorbé par la dernière ligne, pour traçabilité. */
  readonly ecartRepartitionMillimes: Millimes
  /** `true` si la remise globale a dû être plafonnée à la base disponible. */
  readonly remiseGlobalePlafonnee: boolean
  /** `true` si au moins une remise de ligne a dû être plafonnée. */
  readonly remiseLignePlafonnee: boolean
}
