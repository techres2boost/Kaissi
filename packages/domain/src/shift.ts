/**
 * Shift de caisse — ouverture, mouvements d'espèces, clôture.
 *
 * L'écart de caisse est LE chiffre que le patron regarde. Il doit être
 * calculé de façon identique sur la tablette et dans le rapport du
 * back-office, sinon la discussion avec l'employé devient impossible.
 *
 *   attendu = fond de caisse
 *           + encaissements en ESPÈCES
 *           − rendus de monnaie          (déjà déduits des encaissements)
 *           + entrées d'espèces
 *           − sorties, prélèvements, dépenses
 *           − remboursements rendus en ESPÈCES pendant ce service
 *
 *   écart   = compté − attendu           ⚑ PEUT être négatif
 *
 * Seules les espèces entrent dans ce calcul : la carte et les tickets
 * restaurant ne passent pas par le tiroir.
 */

import { ZERO, millimes, sommer, soustraire, type Millimes } from './monnaie.js'
import type { ModePaiement } from './evenements.js'
import type { Uuid, VentilationTaxe } from './types.js'

export type TypeMouvement = 'in' | 'out' | 'drop' | 'payout'

export interface MouvementCaisse {
  readonly id: Uuid
  readonly type: TypeMouvement
  readonly montantMillimes: Millimes
  readonly motif: string
  readonly creeA: string
  readonly creePar: Uuid | null
}

/** Un encaissement tel qu'il compte pour la caisse. */
export interface EncaissementShift {
  readonly paiementId: Uuid
  readonly mode: ModePaiement
  /** Montant imputé à la commande, hors monnaie rendue. */
  readonly montantMillimes: Millimes
  readonly annule: boolean
}

export interface Shift {
  readonly id: Uuid
  readonly restaurantId: Uuid
  readonly organizationId: Uuid
  readonly deviceId: Uuid | null
  readonly employeId: Uuid | null
  readonly ouvertA: string
  readonly fondDeCaisseMillimes: Millimes
  readonly closA: string | null
  readonly compteMillimes: Millimes | null
  readonly noteCloture: string | null
}

export interface ResumeShift {
  readonly fondDeCaisseMillimes: Millimes
  /** Encaissements en espèces, hors paiements annulés. */
  readonly especesMillimes: Millimes
  readonly carteMillimes: Millimes
  readonly autresMillimes: Millimes
  readonly entreesMillimes: Millimes
  readonly sortiesMillimes: Millimes
  /**
   * Espèces RENDUES à des clients pendant ce service — quel que soit le jour
   * de la vente remboursée. C'est le tiroir d'aujourd'hui qui a donné l'argent.
   */
  readonly remboursementsEspecesMillimes: Millimes
  /** Ce que le tiroir DEVRAIT contenir. */
  readonly attenduMillimes: Millimes
  /** Ce que l'employé a compté, `null` tant que le shift est ouvert. */
  readonly compteMillimes: Millimes | null
  /** compté − attendu. Négatif = il manque de l'argent. */
  readonly ecartMillimes: Millimes | null
  readonly nombreCommandes: number
  readonly chiffreAffairesMillimes: Millimes
  readonly ouvert: boolean
}

/** Les types de mouvement qui SORTENT de la caisse. */
const SORTIES: readonly TypeMouvement[] = ['out', 'drop', 'payout']

export interface EntreeResumeShift {
  readonly shift: Shift
  readonly encaissements: readonly EncaissementShift[]
  readonly mouvements: readonly MouvementCaisse[]
  readonly nombreCommandes: number
  /** Chiffre d'affaires TTC des commandes encaissées sur ce shift. */
  readonly chiffreAffairesMillimes: Millimes
  /**
   * L'argent rendu pendant ce service. Facultatif : un appelant antérieur au
   * remboursement n'en a pas, et zéro est alors la vérité.
   */
  readonly remboursements?: readonly { readonly mode: ModePaiement; readonly montantMillimes: Millimes }[]
}

export function resumerShift(entree: EntreeResumeShift): ResumeShift {
  const vivants = entree.encaissements.filter((e) => !e.annule)
  const parMode = (mode: ModePaiement): Millimes =>
    sommer(vivants.filter((e) => e.mode === mode).map((e) => e.montantMillimes))

  const especes = parMode('cash')
  const carte = parMode('card')
  const autres = sommer(
    vivants
      .filter((e) => e.mode !== 'cash' && e.mode !== 'card')
      .map((e) => e.montantMillimes),
  )

  const entrees = sommer(
    entree.mouvements.filter((m) => m.type === 'in').map((m) => m.montantMillimes),
  )
  const sorties = sommer(
    entree.mouvements.filter((m) => SORTIES.includes(m.type)).map((m) => m.montantMillimes),
  )

  // Seul ce qui est rendu en ESPÈCES sort du tiroir : un remboursement sur
  // carte passe par le terminal de la banque, pas par la caisse.
  const rembourse = sommer(
    (entree.remboursements ?? []).filter((r) => r.mode === 'cash').map((r) => r.montantMillimes),
  )

  const attendu = millimes(
    entree.shift.fondDeCaisseMillimes + especes + entrees - sorties - rembourse,
  )
  const compte = entree.shift.compteMillimes

  return {
    fondDeCaisseMillimes: entree.shift.fondDeCaisseMillimes,
    especesMillimes: especes,
    carteMillimes: carte,
    autresMillimes: autres,
    entreesMillimes: entrees,
    sortiesMillimes: sorties,
    remboursementsEspecesMillimes: rembourse,
    attenduMillimes: attendu,
    compteMillimes: compte,
    // L'écart PEUT être négatif : aucune borne à zéro, c'est tout son intérêt.
    ecartMillimes: compte === null ? null : soustraire(compte, attendu),
    nombreCommandes: entree.nombreCommandes,
    chiffreAffairesMillimes: entree.chiffreAffairesMillimes,
    ouvert: entree.shift.closA === null,
  }
}

/**
 * Seuil au-delà duquel un écart de caisse exige une justification écrite et
 * remonte dans le tableau de bord anti-fraude. 1 dinar : en dessous, c'est
 * de l'arrondi de monnaie ; au-dessus, c'est une question à poser.
 */
export const SEUIL_ECART_SIGNIFICATIF: Millimes = millimes(1000)

export function ecartSignificatif(ecart: Millimes | null): boolean {
  return ecart !== null && Math.abs(ecart) >= SEUIL_ECART_SIGNIFICATIF
}

/**
 * Coupures du dinar tunisien, des plus grosses aux plus petites.
 * Sert au comptage assisté de la caisse et aux suggestions de rendu.
 * ⚠ Les coupures en circulation évoluent : à confirmer auprès de la BCT.
 */
export const COUPURES_TND: readonly Millimes[] = [
  50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
].map((v) => millimes(v))

/** Total d'un comptage détaillé par coupure. */
export function totaliserComptage(
  comptage: Readonly<Record<number, number>>,
): Millimes {
  let total = 0
  for (const [valeur, nombre] of Object.entries(comptage)) {
    if (!Number.isSafeInteger(nombre) || nombre < 0) {
      throw new Error(`Nombre de coupures invalide pour ${valeur} : ${nombre}`)
    }
    total += Number(valeur) * nombre
  }
  return millimes(total)
}

/**
 * Billets en circulation, du plus petit au plus grand.
 * ⚠ Les coupures évoluent : à confirmer auprès de la BCT avant déploiement.
 */
const BILLETS_TND: readonly number[] = [5_000, 10_000, 20_000, 50_000]

/**
 * Suggestions de montant reçu pour l'encaissement en espèces.
 *
 * On propose ce qu'un client TEND RÉELLEMENT, pas des multiples arbitraires :
 * le compte juste, l'arrondi au dinar, au cinq et au dix dinars, et le plus
 * petit billet qui couvre le total. Un palier à 40 dinars n'a aucun sens —
 * il n'existe pas de billet de 40, personne ne tend cette somme.
 *
 * Pour 24,500 TND → 24,500 · 25,000 · 30,000 · 50,000.
 */
export function suggestionsEspeces(total: Millimes, combien = 4): Millimes[] {
  if (total <= 0) return []

  const candidats = new Set<number>([total])
  for (const palier of [1_000, 5_000, 10_000]) {
    candidats.add(Math.ceil(total / palier) * palier)
  }
  const billet = BILLETS_TND.find((b) => b >= total)
  if (billet !== undefined) candidats.add(billet)

  return [...candidats]
    .sort((a, b) => a - b)
    .slice(0, combien)
    .map((v) => millimes(v))
}

// ─── Rapport de clôture (« ticket Z ») ──────────────────────────────────────

/**
 * Une vente encaissée pendant le service, telle que la projection l'a déjà
 * calculée. Rien ici n'est RECALCULÉ : le rapport additionne des entiers
 * déjà décidés par `calculerTotaux` (RÈGLE 7 — une somme n'est pas une
 * règle). Recalculer la TVA d'une journée à partir des bases cumulées
 * donnerait un autre chiffre que la somme des tickets, à l'arrondi près —
 * et c'est la somme des tickets que le client a payée.
 */
export interface VenteZ {
  readonly numeroTicket: string | null
  readonly totalMillimes: Millimes
  readonly remisesMillimes: Millimes
  readonly serviceMillimes: Millimes
  readonly timbreMillimes: Millimes
  readonly ventilationTaxes: readonly VentilationTaxe[]
}

export interface LigneTvaZ {
  readonly nom: string
  readonly tauxBp: number
  readonly incluse: boolean
  readonly baseHtMillimes: Millimes
  readonly taxeMillimes: Millimes
}

/**
 * Le détail d'un rapport de clôture — ce que le ticket de caisse ne dit pas.
 *
 * ⚠ Ce n'est PAS un « Z » fiscal. Un Z au sens d'une caisse homologuée
 *   (NACEF) porte probablement des compteurs CUMULÉS inaltérables, un
 *   numéro séquentiel de clôture et une signature ; leur forme exacte vient
 *   du cahier des charges, pas de nous. Ce rapport sert le gérant : ce
 *   qu'on a vendu, à quels taux, et ce qu'on a corrigé.
 */
export interface DetailZ {
  readonly premierTicket: string | null
  readonly dernierTicket: string | null
  readonly remisesMillimes: Millimes
  readonly serviceMillimes: Millimes
  readonly timbreMillimes: Millimes
  /** Par taux, dans l'ordre des taux croissants. */
  readonly tva: readonly LigneTvaZ[]
  readonly totalTvaMillimes: Millimes
  /** Commandes annulées pendant ce service — ouvertes puis abandonnées. */
  readonly commandesAnnulees: number
  /** Lignes retirées d'une commande ENCAISSÉE : le geste à surveiller. */
  readonly lignesRetirees: number
  readonly remboursements: { readonly nombre: number; readonly montantMillimes: Millimes }
}

export function detaillerZ(entree: {
  readonly ventes: readonly VenteZ[]
  readonly commandesAnnulees: number
  readonly lignesRetirees: number
  readonly remboursements: readonly { readonly montantMillimes: Millimes }[]
}): DetailZ {
  const parTaux = new Map<string, { nom: string; tauxBp: number; incluse: boolean; base: number; taxe: number }>()
  for (const v of entree.ventes) {
    for (const t of v.ventilationTaxes) {
      // Regroupé par NOM et taux, pas par identifiant : deux taux « TVA 19 % »
      // recréés au back-office restent une seule ligne pour le comptable.
      const cle = `${t.nom}|${t.tauxBp}|${t.incluse}`
      const cumul = parTaux.get(cle) ?? { nom: t.nom, tauxBp: t.tauxBp, incluse: t.incluse, base: 0, taxe: 0 }
      cumul.base += t.baseHtMillimes
      cumul.taxe += t.taxeMillimes
      parTaux.set(cle, cumul)
    }
  }
  const tva = [...parTaux.values()]
    .sort((a, b) => a.tauxBp - b.tauxBp || a.nom.localeCompare(b.nom))
    .map((t) => ({
      nom: t.nom,
      tauxBp: t.tauxBp,
      incluse: t.incluse,
      baseHtMillimes: millimes(t.base),
      taxeMillimes: millimes(t.taxe),
    }))

  // Les numéros : premier et dernier dans l'ordre du numéro, qui est
  // croissant par caisse (préfixe-séquence). Un trou entre les deux se voit.
  const numeros = entree.ventes
    .map((v) => v.numeroTicket)
    .filter((n): n is string => n !== null)
    .sort()

  return {
    premierTicket: numeros[0] ?? null,
    dernierTicket: numeros[numeros.length - 1] ?? null,
    remisesMillimes: sommer(entree.ventes.map((v) => v.remisesMillimes)),
    serviceMillimes: sommer(entree.ventes.map((v) => v.serviceMillimes)),
    timbreMillimes: sommer(entree.ventes.map((v) => v.timbreMillimes)),
    tva,
    totalTvaMillimes: sommer(tva.map((t) => t.taxeMillimes)),
    commandesAnnulees: entree.commandesAnnulees,
    lignesRetirees: entree.lignesRetirees,
    remboursements: {
      nombre: entree.remboursements.length,
      montantMillimes: sommer(entree.remboursements.map((r) => r.montantMillimes)),
    },
  }
}

export { ZERO }
