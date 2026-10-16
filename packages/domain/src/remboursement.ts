/**
 * Remboursement d'un ticket payé — la RÈGLE, à un seul endroit (RÈGLE 7).
 *
 * ── Ce qu'est un remboursement ici ────────────────────────────────────────
 *
 * Un ÉVÉNEMENT de plus dans le journal de la commande (`refund.recorded`),
 * jamais une modification de la vente. Le ticket encaissé reste encaissé :
 * l'historique ne perd rien, et le remboursement s'y AJOUTE, avec son
 * montant, son motif, et qui l'a autorisé. C'est la règle de l'annulation
 * appliquée à l'argent rendu.
 *
 * ── Ce que coûte une ligne, et pourquoi ce n'est pas son prix ─────────────
 *
 * Rembourser « le prix de la pizza » serait faux dès que le ticket porte une
 * remise globale, un service ou une TVA ajoutée au prix. Le client n'a pas
 * payé 14,500 : il a payé sa part de la remise en moins, sa part du service
 * en plus, et la TVA de son taux. On rembourse donc ce que la ligne a
 * RÉELLEMENT coûté — et aucun arrondi nouveau n'est inventé pour cela :
 *
 *   part(ligne) = base après remises          ← déjà calculée (étapes 3–4)
 *               + TVA exclusive imputée        ← déjà imputée par taux (étape 6)
 *               + part du service              ← répartie AU PRORATA des bases,
 *                                                 par la règle de l'étape 4
 *
 * Propriété garantie, et testée : la somme des parts de TOUTES les lignes,
 * plus le timbre, est EXACTEMENT le total du ticket. Rembourser un ticket
 * ligne par ligne, en trois fois, rend au millime ce qu'il a coûté.
 *
 * ⚠ LE TIMBRE n'est rendu qu'avec la DERNIÈRE ligne remboursée, c'est-à-dire
 *   quand le ticket l'est en entier. Un remboursement partiel laisse une
 *   vente debout, et le droit de timbre porte sur la vente. Ce traitement
 *   est à faire valider par un expert-comptable tunisien.
 *
 * ── Ce qui n'est pas couvert ──────────────────────────────────────────────
 *
 * On rembourse des LIGNES entières. Rendre un Coca sur une ligne de trois
 * demanderait une règle d'arrondi par unité qu'on n'invente pas en passant :
 * le cas se règle aujourd'hui en remboursant la ligne.
 */

import { ZERO, additionner, millimes, sommer, soustraire, type Millimes } from './monnaie.js'
import { repartirAuProrata } from './repartition.js'
import type { EtatCommande } from './reduction.js'
import type { TotauxCommande, Uuid } from './types.js'

export class ErreurRemboursement extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurRemboursement'
  }
}

/** Une ligne du ticket, telle qu'on peut la rembourser. */
export interface PartRemboursable {
  readonly ligneId: Uuid
  readonly designation: string
  readonly quantite: number
  /** Ce que cette ligne a réellement coûté au client, TTC, remises et service compris. */
  readonly montantMillimes: Millimes
  readonly dejaRemboursee: boolean
}

export interface CalculRemboursement {
  /** À rendre au client, timbre compris quand le ticket est soldé. */
  readonly montantMillimes: Millimes
  /** Le timbre inclus dans le montant — nul sauf pour la dernière ligne. */
  readonly timbreMillimes: Millimes
  /** `true` si, après ce remboursement, plus aucune ligne ne reste à rendre. */
  readonly ticketSolde: boolean
}

/**
 * Répartit `montant` au prorata de `poids`, même s'il les dépasse.
 *
 * `repartirAuProrata` refuse un montant supérieur à la somme des poids — à
 * juste titre pour une remise, qui ne peut pas dépasser ce qu'elle réduit.
 * Le service, lui, s'AJOUTE : à 100 % de service taxé, il dépasse la base.
 * On procède alors par passes entières (chaque passe rend exactement les
 * poids), puis on répartit le reste par la règle ordinaire. Même règle,
 * même déterminisme, aucune somme perdue.
 */
function repartirService(montant: Millimes, poids: readonly Millimes[]): Millimes[] {
  const total = sommer(poids)
  if (montant === 0 || total === 0) return poids.map(() => ZERO)
  const passes = Math.floor(montant / total)
  const reste = millimes(montant - passes * total)
  const fin = repartirAuProrata(reste, poids).parts
  return poids.map((p, i) => millimes(p * passes + (fin[i] ?? 0)))
}

/** Les lignes déjà remboursées, tous remboursements confondus. */
export function lignesRemboursees(etat: EtatCommande): ReadonlySet<Uuid> {
  const vues = new Set<Uuid>()
  for (const r of etat.remboursements) for (const id of r.ligneIds) vues.add(id)
  return vues
}

/** Somme de ce qui a déjà été rendu au client sur cette commande. */
export function totalRembourse(etat: EtatCommande): Millimes {
  return sommer(etat.remboursements.map((r) => r.montantMillimes))
}

/**
 * Les lignes du ticket et ce que chacune a coûté.
 *
 * Les lignes ANNULÉES avant l'encaissement n'y figurent pas : elles n'ont
 * rien coûté, il n'y a rien à rendre.
 */
export function partsRemboursables(
  etat: EtatCommande,
  totaux: TotauxCommande,
): PartRemboursable[] {
  // Taux inclus ou ajouté : lu dans la ventilation que le calcul a produite,
  // pour ne pas redemander la configuration — et ne pas risquer d'en lire
  // une autre que celle qui a servi au total.
  const incluse = new Map<Uuid, boolean>()
  for (const v of totaux.ventilationTaxes) incluse.set(v.tauxTaxeId, v.incluse)

  const calculees = totaux.lignes
  const bases = calculees.map((l) => l.baseApresRemisesMillimes)
  const lignesTtc = calculees.map((l) =>
    additionner(l.baseApresRemisesMillimes, incluse.get(l.tauxTaxeId) ? ZERO : l.taxeMillimes),
  )

  // Le service et sa TVA ajoutée : tout ce qui sépare le total des lignes,
  // timbre mis à part. Réparti sur les bases, comme il a été calculé.
  const service = soustraire(
    soustraire(totaux.totalMillimes, totaux.timbreFiscalMillimes),
    sommer(lignesTtc),
  )
  if (service < 0) {
    throw new ErreurRemboursement(
      'Totaux incohérents : la somme des lignes dépasse le total du ticket.',
    )
  }
  const partsService = repartirService(service, bases)

  const rendues = lignesRemboursees(etat)
  const designations = new Map(etat.lignes.map((l) => [l.id, l.designation]))

  return calculees.map((l, i) => ({
    ligneId: l.id,
    designation: designations.get(l.id) ?? '—',
    quantite: l.quantite,
    montantMillimes: additionner(lignesTtc[i] ?? ZERO, partsService[i] ?? ZERO),
    dejaRemboursee: rendues.has(l.id),
  }))
}

/**
 * Ce qu'il faut rendre pour ces lignes.
 *
 * Refuse ce qui n'a pas de sens — une ligne inconnue, une ligne déjà rendue,
 * une sélection vide, une commande non encaissée. Ces refus sont faits pour
 * l'INTERFACE : un remboursement déjà parti d'une autre caisse hors ligne
 * n'est pas refusé par la réduction, il y est signalé (voir `reduction.ts`).
 */
export function calculerRemboursement(
  etat: EtatCommande,
  totaux: TotauxCommande,
  ligneIds: readonly Uuid[],
): CalculRemboursement {
  if (etat.statut !== 'close') {
    throw new ErreurRemboursement(
      'Seul un ticket encaissé se rembourse. Une commande en cours se corrige en retirant la ligne.',
    )
  }
  if (ligneIds.length === 0) {
    throw new ErreurRemboursement('Choisissez au moins une ligne à rembourser.')
  }

  const parts = partsRemboursables(etat, totaux)
  const parId = new Map(parts.map((p) => [p.ligneId, p]))
  const choisies = new Set<Uuid>()
  for (const id of ligneIds) {
    const part = parId.get(id)
    if (!part) throw new ErreurRemboursement(`Ligne absente du ticket : ${id}`)
    if (part.dejaRemboursee) {
      throw new ErreurRemboursement(`« ${part.designation} » a déjà été remboursé.`)
    }
    choisies.add(id)
  }

  const ticketSolde = parts.every((p) => p.dejaRemboursee || choisies.has(p.ligneId))
  const timbre = ticketSolde ? totaux.timbreFiscalMillimes : ZERO
  const lignes = sommer(parts.filter((p) => choisies.has(p.ligneId)).map((p) => p.montantMillimes))

  return { montantMillimes: additionner(lignes, timbre), timbreMillimes: timbre, ticketSolde }
}

/** Ce qui peut encore être rendu sur ce ticket. Jamais négatif. */
export function resteRemboursable(etat: EtatCommande, totaux: TotauxCommande): Millimes {
  return millimes(Math.max(totaux.totalMillimes - totalRembourse(etat), 0))
}

/**
 * Le paiement auquel rattacher l'argent rendu.
 *
 * Le premier paiement vivant du mode choisi ; à défaut, le premier paiement
 * vivant tout court. Un remboursement qui ne se rattache à aucun paiement
 * n'a pas de sens — la commande n'a pas été payée.
 */
export function paiementARembourser(
  etat: EtatCommande,
  mode: string,
): { paiementId: Uuid; mode: EtatCommande['paiements'][number]['mode'] } | null {
  const vivants = etat.paiements.filter((p) => !p.annule)
  const choisi = vivants.find((p) => p.mode === mode) ?? vivants[0]
  return choisi ? { paiementId: choisi.id, mode: choisi.mode } : null
}
