/**
 * Calcul des totaux d'une commande — LE module critique de Kaissi.
 *
 * Ce code est importé À L'IDENTIQUE par le POS (tablette, hors ligne) et par
 * l'API de synchronisation (serveur, à la réconciliation). Toute duplication
 * de cette logique ailleurs produirait des écarts de caisse inexplicables.
 *
 * ORDRE DE CALCUL FIGÉ — ne jamais réordonner :
 *   1. ligne_brute      = (prix_base + Σ modificateurs) × quantité
 *   2. sous_total       = Σ ligne_brute
 *   3. remise_ligne     appliquée AVANT la remise globale
 *   4. remise_globale   répartie AU PRORATA sur les lignes
 *                       ⚑ sans répartition, la TVA par taux est fausse
 *   5. base_taxable     regroupée PAR TAUX
 *   6. tva              = arrondi(base × tauxBp / 10000), ARRONDI PAR TAUX
 *                       ⚑ arrondir par taux puis sommer — jamais l'inverse
 *   7. service          appliqué sur la base après remises
 *   8. total            = base après remises + tva exclusive + service + timbre
 *   9. rendu            = reçu − total          (voir `calculerRendu`)
 *  10. écart d'arrondi  de la répartition → DERNIÈRE ligne, déterministe
 */

import {
  ZERO,
  additionner,
  appliquerPointsDeBase,
  extraireTaxeIncluse,
  millimes,
  multiplier,
  sommer,
  soustraire,
  type Millimes,
} from './monnaie.js'
import { bornerRemise, repartirAuProrata } from './repartition.js'
import type {
  ConfigCalcul,
  LigneCalculable,
  LigneCalculee,
  Remise,
  TotauxCommande,
  Uuid,
  VentilationTaxe,
} from './types.js'

export class ErreurCalcul extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurCalcul'
  }
}

/**
 * Convertit une remise (montant ou pourcentage) en millimes sur une base donnée.
 * Le résultat n'est PAS plafonné à la base : c'est `bornerRemise` qui tranche,
 * afin que le plafonnement soit visible dans le résultat du calcul et affiché
 * à l'utilisateur au lieu d'être avalé en silence.
 */
export function evaluerRemise(remise: Remise | undefined, base: Millimes): Millimes {
  if (!remise) return ZERO
  const brute =
    remise.type === 'montant'
      ? remise.valeurMillimes
      : appliquerPointsDeBase(base, remise.valeurBp)
  // Une remise négative n'a aucun sens : on la neutralise.
  return millimes(Math.max(brute, 0))
}

export interface EntreeCalcul {
  readonly lignes: readonly LigneCalculable[]
  /** Remise appliquée à la commande entière, répartie au prorata (étape 4). */
  readonly remiseGlobale?: Remise
  readonly config: ConfigCalcul
}

/**
 * Calcule les totaux d'une commande. Fonction PURE : mêmes entrées → mêmes
 * sorties, sur tablette comme sur serveur, quel que soit le fuseau horaire,
 * la locale ou la version du moteur JS.
 */
export function calculerTotaux(entree: EntreeCalcul): TotauxCommande {
  const { config } = entree
  // Les lignes annulées restent dans le journal d'événements mais ne comptent
  // plus dans les totaux — l'annulation n'efface jamais, elle neutralise.
  const lignesActives = entree.lignes.filter((l) => !l.annulee)

  // ── Étape 1 : montant brut de chaque ligne ────────────────────────────────
  const brutes = lignesActives.map((ligne) => {
    if (!Number.isSafeInteger(ligne.quantite) || ligne.quantite < 0) {
      throw new ErreurCalcul(
        `Quantité invalide sur la ligne ${ligne.id} : ${ligne.quantite}`,
      )
    }
    const prixUnitaire = additionner(ligne.prixBaseMillimes, ligne.modificateursMillimes)
    return { ligne, prixUnitaire, brut: multiplier(prixUnitaire, ligne.quantite) }
  })

  // ── Étape 2 : sous-total ──────────────────────────────────────────────────
  const sousTotal = sommer(brutes.map((b) => b.brut))

  // ── Étape 3 : remises de ligne, AVANT la remise globale ───────────────────
  let remiseLignePlafonnee = false
  const apresRemiseLigne = brutes.map((b) => {
    const borne = bornerRemise(evaluerRemise(b.ligne.remise, b.brut), b.brut)
    if (borne.plafonnee) remiseLignePlafonnee = true
    return { ...b, remiseLigne: borne.remise, base: soustraire(b.brut, borne.remise) }
  })
  const remisesLignes = sommer(apresRemiseLigne.map((l) => l.remiseLigne))
  const baseAvantRemiseGlobale = sommer(apresRemiseLigne.map((l) => l.base))

  // ── Étape 4 : remise globale répartie AU PRORATA ──────────────────────────
  const remiseGlobaleBrute = evaluerRemise(entree.remiseGlobale, baseAvantRemiseGlobale)
  const { remise: remiseGlobale, plafonnee: remiseGlobalePlafonnee } = bornerRemise(
    remiseGlobaleBrute,
    baseAvantRemiseGlobale,
  )
  const repartition = repartirAuProrata(
    remiseGlobale,
    apresRemiseLigne.map((l) => l.base),
  )

  const apresRemises = apresRemiseLigne.map((l, index) => {
    const part = repartition.parts[index] ?? ZERO
    return {
      ...l,
      remiseGlobaleRepartie: part,
      baseApresRemises: soustraire(l.base, part),
      absorbeEcartResiduel: repartition.indicesAbsorbeurs.includes(index),
    }
  })

  // ── Étape 5 : regroupement des bases PAR TAUX ─────────────────────────────
  const groupes = new Map<Uuid, Millimes>()
  for (const l of apresRemises) {
    const tauxId = l.ligne.tauxTaxeId
    if (!config.tauxTaxes[tauxId]) {
      throw new ErreurCalcul(
        `Taux de taxe inconnu « ${tauxId} » sur la ligne ${l.ligne.id}. ` +
          `Le catalogue local est peut-être désynchronisé.`,
      )
    }
    groupes.set(tauxId, additionner(groupes.get(tauxId) ?? ZERO, l.baseApresRemises))
  }

  // ── Étape 6 : TVA arrondie PAR TAUX, puis sommée ──────────────────────────
  const ventilation: VentilationTaxe[] = []
  const taxeParTaux = new Map<Uuid, { taxe: Millimes; baseHt: Millimes }>()
  // On parcourt les taux dans un ordre stable (tri par identifiant) afin que
  // la ventilation imprimée soit identique d'un appareil à l'autre.
  const tauxTries = [...groupes.keys()].sort()
  for (const tauxId of tauxTries) {
    const taux = config.tauxTaxes[tauxId]!
    const base = groupes.get(tauxId)!
    let baseHt: Millimes
    let taxe: Millimes
    if (taux.incluse) {
      const extrait = extraireTaxeIncluse(base, taux.tauxBp)
      baseHt = extrait.baseHT
      taxe = extrait.taxe
    } else {
      baseHt = base
      taxe = appliquerPointsDeBase(base, taux.tauxBp)
    }
    taxeParTaux.set(tauxId, { taxe, baseHt })
    ventilation.push({
      tauxTaxeId: tauxId,
      nom: taux.nom,
      tauxBp: taux.tauxBp,
      incluse: taux.incluse,
      baseHtMillimes: baseHt,
      taxeMillimes: taxe,
    })
  }

  // Imputation de la taxe du groupe aux lignes, pour l'affichage détaillé.
  // Même règle de répartition : plancher au prorata, résidu sur la dernière.
  const taxeLigne = new Map<Uuid, { taxe: Millimes; baseHt: Millimes }>()
  for (const tauxId of tauxTries) {
    const lignesDuTaux = apresRemises.filter((l) => l.ligne.tauxTaxeId === tauxId)
    const agrege = taxeParTaux.get(tauxId)!
    const poids = lignesDuTaux.map((l) => l.baseApresRemises)
    const partsTaxe = repartirAuProrata(agrege.taxe, poids).parts
    const partsBase = repartirAuProrata(agrege.baseHt, poids).parts
    lignesDuTaux.forEach((l, i) => {
      taxeLigne.set(l.ligne.id, {
        taxe: partsTaxe[i] ?? ZERO,
        baseHt: partsBase[i] ?? ZERO,
      })
    })
  }

  const lignesCalculees: LigneCalculee[] = apresRemises.map((l) => {
    const imputation = taxeLigne.get(l.ligne.id) ?? { taxe: ZERO, baseHt: l.baseApresRemises }
    return {
      id: l.ligne.id,
      quantite: l.ligne.quantite,
      prixUnitaireMillimes: l.prixUnitaire,
      totalBrutMillimes: l.brut,
      remiseLigneMillimes: l.remiseLigne,
      remiseGlobaleRepartieMillimes: l.remiseGlobaleRepartie,
      baseApresRemisesMillimes: l.baseApresRemises,
      tauxTaxeId: l.ligne.tauxTaxeId,
      baseHtMillimes: imputation.baseHt,
      taxeMillimes: imputation.taxe,
      absorbeEcartResiduel: l.absorbeEcartResiduel,
    }
  })

  const baseApresRemises = sommer(apresRemises.map((l) => l.baseApresRemises))
  const taxeTotale = sommer(ventilation.map((v) => v.taxeMillimes))
  const taxeExclusive = sommer(
    ventilation.filter((v) => !v.incluse).map((v) => v.taxeMillimes),
  )

  // ── Étape 7 : frais de service ────────────────────────────────────────────
  let service = ZERO
  let taxeService = ZERO
  if (config.service && config.service.tauxBp > 0) {
    // Le service se calcule sur la base après remises : un client qui bénéficie
    // d'une remise ne paie pas le service sur le prix plein.
    service = appliquerPointsDeBase(baseApresRemises, config.service.tauxBp)
    if (config.service.taxable && config.service.tauxTaxeId) {
      const tauxServ = config.tauxTaxes[config.service.tauxTaxeId]
      if (!tauxServ) {
        throw new ErreurCalcul(
          `Taux de taxe du service inconnu : « ${config.service.tauxTaxeId} »`,
        )
      }
      if (tauxServ.incluse) {
        const extrait = extraireTaxeIncluse(service, tauxServ.tauxBp)
        taxeService = extrait.taxe
        ventilation.push({
          tauxTaxeId: tauxServ.id,
          nom: `${tauxServ.nom} (service)`,
          tauxBp: tauxServ.tauxBp,
          incluse: true,
          baseHtMillimes: extrait.baseHT,
          taxeMillimes: extrait.taxe,
        })
      } else {
        taxeService = appliquerPointsDeBase(service, tauxServ.tauxBp)
        ventilation.push({
          tauxTaxeId: tauxServ.id,
          nom: `${tauxServ.nom} (service)`,
          tauxBp: tauxServ.tauxBp,
          incluse: false,
          baseHtMillimes: service,
          taxeMillimes: taxeService,
        })
      }
    }
  }
  const taxeServiceExclusive =
    config.service?.taxable && config.service.tauxTaxeId
      ? config.tauxTaxes[config.service.tauxTaxeId]?.incluse
        ? ZERO
        : taxeService
      : ZERO

  // ── Étape 8 : total ───────────────────────────────────────────────────────
  const timbre = config.timbreFiscalMillimes ?? ZERO
  const total = additionner(
    baseApresRemises,
    taxeExclusive,
    service,
    taxeServiceExclusive,
    timbre,
  )

  return {
    lignes: lignesCalculees,
    sousTotalMillimes: sousTotal,
    remisesLignesMillimes: remisesLignes,
    remiseGlobaleMillimes: remiseGlobale,
    totalRemisesMillimes: additionner(remisesLignes, remiseGlobale),
    baseApresRemisesMillimes: baseApresRemises,
    ventilationTaxes: ventilation,
    taxeMillimes: additionner(taxeTotale, taxeService),
    taxeExclusiveMillimes: additionner(taxeExclusive, taxeServiceExclusive),
    serviceMillimes: service,
    taxeServiceMillimes: taxeService,
    timbreFiscalMillimes: timbre,
    totalMillimes: total,
    ecartRepartitionMillimes: repartition.ecartResiduel,
    remiseGlobalePlafonnee,
    remiseLignePlafonnee,
  }
}

/** Résultat d'un encaissement : reste dû ou monnaie à rendre. */
export interface ResultatEncaissement {
  readonly totalMillimes: Millimes
  readonly verseMillimes: Millimes
  /** Monnaie à rendre au client (0 si le versement ne couvre pas le total). */
  readonly rendreMillimes: Millimes
  /** Reste à encaisser (0 si le total est couvert). */
  readonly resteDuMillimes: Millimes
  readonly solde: boolean
}

/**
 * Étape 9 : rendu de monnaie.
 * `verse` est la somme des paiements enregistrés, tous modes confondus.
 */
export function calculerRendu(total: Millimes, verse: Millimes): ResultatEncaissement {
  const difference = verse - total
  return {
    totalMillimes: total,
    verseMillimes: verse,
    rendreMillimes: millimes(Math.max(difference, 0)),
    resteDuMillimes: millimes(Math.max(-difference, 0)),
    solde: difference >= 0,
  }
}

/**
 * Contrôle d'intégrité : la somme des bases de ligne + taxes + service + timbre
 * doit être exactement égale au total. Utilisé par les tests et par la
 * réconciliation serveur pour détecter un écart appareil ↔ serveur.
 */
export function verifierCoherence(totaux: TotauxCommande): boolean {
  const sommeLignes = sommer(totaux.lignes.map((l) => l.baseApresRemisesMillimes))
  if (sommeLignes !== totaux.baseApresRemisesMillimes) return false
  const recompose = additionner(
    totaux.baseApresRemisesMillimes,
    totaux.taxeExclusiveMillimes,
    totaux.serviceMillimes,
    totaux.timbreFiscalMillimes,
  )
  return recompose === totaux.totalMillimes
}
