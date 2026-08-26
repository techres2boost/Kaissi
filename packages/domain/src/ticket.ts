/**
 * Modèle du ticket à imprimer — PUR, sans un octet d'ESC/POS.
 *
 * Séparer le « quoi » du « comment » : `packages/domain` décide ce qui
 * figure sur le ticket et avec quels montants, `packages/printing` décide
 * comment l'encoder pour une imprimante thermique. On peut ainsi tester le
 * contenu d'un ticket sans imprimante, et changer de format d'impression
 * sans retoucher un seul calcul.
 */

import { formaterTND, type Millimes } from './monnaie.js'
import type { EtatCommande } from './reduction.js'
import type { TotauxCommande, Uuid } from './types.js'
import type { ResumeShift } from './shift.js'

export interface EnteteEtablissement {
  readonly nom: string
  readonly adresse: string | null
  readonly telephone: string | null
  /** ⚠ Mentions fiscales à faire valider par un expert-comptable tunisien. */
  readonly identifiantFiscal: string | null
}

export interface LigneTicket {
  readonly quantite: number
  readonly designation: string
  /** Modificateurs et variante, affichés en retrait sous la ligne. */
  readonly details: readonly string[]
  readonly note: string | null
  readonly totalMillimes: Millimes
  readonly remiseMillimes: Millimes
}

export interface TicketClient {
  readonly type: 'ticket'
  readonly etablissement: EnteteEtablissement
  readonly numeroTicket: string
  readonly numeroFiscal: string | null
  readonly dateHeure: string
  readonly employe: string | null
  readonly table: string | null
  readonly typeCommande: string
  readonly couverts: number | null
  readonly lignes: readonly LigneTicket[]
  readonly sousTotalMillimes: Millimes
  readonly remisesMillimes: Millimes
  readonly serviceMillimes: Millimes
  readonly timbreMillimes: Millimes
  readonly ventilation: readonly {
    nom: string
    tauxBp: number
    incluse: boolean
    baseMillimes: Millimes
    taxeMillimes: Millimes
  }[]
  readonly totalMillimes: Millimes
  readonly paiements: readonly { libelle: string; montantMillimes: Millimes }[]
  readonly renduMillimes: Millimes
  readonly piedDePage: readonly string[]
}

export interface TicketCuisine {
  readonly type: 'kot'
  readonly station: string
  readonly numeroTicket: string
  readonly dateHeure: string
  readonly table: string | null
  readonly typeCommande: string
  readonly couverts: number | null
  readonly employe: string | null
  /** `true` pour une tournée supplémentaire sur une commande déjà envoyée. */
  readonly rappel: boolean
  readonly lignes: readonly {
    quantite: number
    designation: string
    details: readonly string[]
    note: string | null
  }[]
}

export interface TicketShift {
  readonly type: 'shift'
  readonly etablissement: EnteteEtablissement
  readonly employe: string | null
  readonly ouvertA: string
  readonly closA: string | null
  readonly resume: ResumeShift
}

export type Ticket = TicketClient | TicketCuisine | TicketShift

/** Horodatage lisible en français, sans dépendre d'Intl (variable selon l'appareil). */
export function formaterDateHeure(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const LIBELLES_TYPE: Readonly<Record<string, string>> = {
  dine_in: 'Sur place',
  takeaway: 'À emporter',
  delivery: 'Livraison',
}

export function libelleTypeCommande(type: string): string {
  return LIBELLES_TYPE[type] ?? type
}

export interface ContexteTicket {
  readonly etablissement: EnteteEtablissement
  readonly employe: string | null
  readonly libelleTable: string | null
  readonly numeroFiscal: string | null
  readonly libellesPaiement: Readonly<Record<Uuid, string>>
  readonly piedDePage?: readonly string[]
}

/**
 * Construit le ticket client depuis l'état réduit et les totaux.
 * Les deux viennent du même journal d'événements : le ticket imprimé et la
 * projection en base ne peuvent pas diverger.
 */
export function construireTicketClient(
  etat: EtatCommande,
  totaux: TotauxCommande,
  contexte: ContexteTicket,
): TicketClient {
  const lignes: LigneTicket[] = etat.lignes
    .filter((l) => !l.annulee)
    .map((l) => {
      const calculee = totaux.lignes.find((c) => c.id === l.id)
      return {
        quantite: l.quantite,
        designation: l.designation,
        details: l.modificateurs.map((m) =>
          m.prixDeltaMillimes === 0
            ? m.nom
            : `${m.nom} ${formaterTND(m.prixDeltaMillimes, { symbole: false })}`,
        ),
        note: l.note,
        totalMillimes: calculee?.totalBrutMillimes ?? (0 as Millimes),
        remiseMillimes: calculee?.remiseLigneMillimes ?? (0 as Millimes),
      }
    })

  const paiements = etat.paiements
    .filter((p) => !p.annule)
    .map((p) => ({
      libelle: contexte.libellesPaiement[p.methodeId] ?? p.mode,
      montantMillimes: p.montantMillimes,
    }))

  const verse = etat.paiements
    .filter((p) => !p.annule)
    .reduce<number>((total, p) => total + p.montantMillimes, 0)

  return {
    type: 'ticket',
    etablissement: contexte.etablissement,
    numeroTicket: etat.numeroTicket ?? '—',
    numeroFiscal: contexte.numeroFiscal,
    dateHeure: formaterDateHeure(etat.closeA ?? etat.ouverteA ?? new Date().toISOString()),
    employe: contexte.employe,
    table: contexte.libelleTable,
    typeCommande: libelleTypeCommande(etat.type),
    couverts: etat.couverts,
    lignes,
    sousTotalMillimes: totaux.sousTotalMillimes,
    remisesMillimes: totaux.totalRemisesMillimes,
    serviceMillimes: totaux.serviceMillimes,
    timbreMillimes: totaux.timbreFiscalMillimes,
    ventilation: totaux.ventilationTaxes.map((v) => ({
      nom: v.nom,
      tauxBp: v.tauxBp,
      incluse: v.incluse,
      baseMillimes: v.baseHtMillimes,
      taxeMillimes: v.taxeMillimes,
    })),
    totalMillimes: totaux.totalMillimes,
    paiements,
    renduMillimes: Math.max(verse - totaux.totalMillimes, 0) as Millimes,
    piedDePage: contexte.piedDePage ?? ['Merci de votre visite !'],
  }
}

/**
 * Construit un bon de cuisine pour une station.
 * `lignesId` limite le bon aux lignes NON encore envoyées : réimprimer une
 * ligne déjà partie ferait préparer le plat en double.
 */
export function construireTicketCuisine(
  etat: EtatCommande,
  options: {
    readonly station: string
    readonly lignesId: ReadonlySet<string>
    readonly employe: string | null
    readonly libelleTable: string | null
    readonly rappel: boolean
  },
): TicketCuisine {
  return {
    type: 'kot',
    station: options.station,
    numeroTicket: etat.numeroTicket ?? '—',
    dateHeure: formaterDateHeure(new Date().toISOString()),
    table: options.libelleTable,
    typeCommande: libelleTypeCommande(etat.type),
    couverts: etat.couverts,
    employe: options.employe,
    rappel: options.rappel,
    lignes: etat.lignes
      .filter((l) => !l.annulee && options.lignesId.has(l.id))
      .map((l) => ({
        quantite: l.quantite,
        designation: l.designation,
        details: l.modificateurs.map((m) => m.nom),
        note: l.note,
      })),
  }
}
