/**
 * Chargement des ventes d'une période — la source unique des rapports.
 *
 * Toutes les pages de reporting (tableau de bord, ventes, tickets) lisent
 * ICI. Une seule définition de « ce qui compte comme une vente », donc une
 * seule réponse à « pourquoi le tableau de bord et l'écran Ventes ne disent
 * pas la même chose ». Les calculs, eux, vivent dans `rapports.ts`.
 *
 * ── Ce qui compte comme une vente ─────────────────────────────────────────
 *
 * Une commande CLOSE, rattachée au jour commercial où elle a été ENCAISSÉE
 * (`closed_at`) — la même convention que l'écran Journée. Une commande
 * ouverte n'est pas encore une vente ; une commande annulée n'en est plus
 * une. Les lignes annulées d'une commande encaissée sont exclues : le client
 * ne les a pas payées.
 */

import {
  bornesJourneeCommerciale,
  journeeCourante,
  type BornesJournee,
} from './journee.js'
import { supabaseServeur } from './supabase.js'
import type {
  CommandeVendue,
  LigneVendue,
  PaiementEncaisse,
  Remboursement,
} from './rapports.js'

/** Au-delà, ce n'est plus un rapport de gestion mais un export comptable. */
export const JOURS_MAX = 92

export interface Periode {
  readonly du: string
  readonly au: string
  readonly bornes: BornesJournee
  /** Vrai si la demande a été rabotée au plafond ci-dessus. */
  readonly tronquee: boolean
}

export interface FicheRestaurant {
  readonly timezone: string
  readonly bascule: string
  readonly serviceRateBp: number
  readonly timbreMillimes: number
}

/**
 * Résout la période demandée en bornes d'instants.
 *
 * La borne haute est EXCLUE et vaut la bascule du LENDEMAIN du dernier jour :
 * une vente encaissée à 1 h du matin appartient à la soirée de la veille,
 * exactement comme sur l'écran Journée.
 */
export function resoudrePeriode(
  fiche: FicheRestaurant,
  du: string | undefined,
  au: string | undefined,
  maintenant = new Date(),
): Periode {
  const aujourdhui = journeeCourante(fiche.timezone, fiche.bascule, maintenant)
  const finDemandee = au ?? du ?? aujourdhui
  let debutDemande = du ?? finDemandee

  // Une période à l'envers est une faute de frappe, pas une demande vide.
  if (debutDemande > finDemandee) debutDemande = finDemandee

  const joursDemandes = Math.round(
    (Date.parse(`${finDemandee}T00:00:00Z`) - Date.parse(`${debutDemande}T00:00:00Z`)) /
      86_400_000,
  ) + 1

  let debut = debutDemande
  const tronquee = joursDemandes > JOURS_MAX
  if (tronquee) {
    const limite = new Date(Date.parse(`${finDemandee}T00:00:00Z`))
    limite.setUTCDate(limite.getUTCDate() - (JOURS_MAX - 1))
    debut = limite.toISOString().slice(0, 10)
  }

  return {
    du: debut,
    au: finDemandee,
    bornes: {
      debut: bornesJourneeCommerciale(debut, fiche.timezone, fiche.bascule).debut,
      fin: bornesJourneeCommerciale(finDemandee, fiche.timezone, fiche.bascule).fin,
    },
    tronquee,
  }
}

/** Une ligne telle que PostgREST la rend, avant enrichissement. */
interface LigneBrute {
  id: string
  order_id: string
  product_id: string | null
  designation: string
  qty: number
  line_gross_millimes: number
  line_discount_millimes: number
  global_discount_share_millimes: number
  line_total_millimes: number
  voided_at: string | null
}

export interface TicketResume {
  readonly id: string
  readonly numero: string | null
  readonly totalMillimes: number
  readonly closeA: string | null
  readonly vendeur: string
  readonly couverts: number | null
  readonly nombreArticles: number
}

export interface VentesChargees {
  readonly lignes: LigneVendue[]
  readonly commandes: CommandeVendue[]
  readonly paiements: PaiementEncaisse[]
  readonly remboursements: Remboursement[]
  readonly tickets: TicketResume[]
  readonly nomEmploye: (id: string | null) => string
  readonly erreur: string | null
}

const VIDE = (erreur: string | null): VentesChargees => ({
  lignes: [], commandes: [], paiements: [], remboursements: [], tickets: [],
  nomEmploye: () => 'Inconnu',
  erreur,
})

/** Charge la fiche de l'établissement — fuseau et heure de bascule. */
export async function chargerFiche(restaurantId: string): Promise<FicheRestaurant> {
  const supabase = await supabaseServeur()
  const { data } = await supabase
    .from('restaurants')
    .select('timezone, business_day_start, service_rate_bp, stamp_duty_millimes')
    .eq('id', restaurantId)
    .maybeSingle()
  return {
    timezone: data?.timezone ?? 'Africa/Tunis',
    bascule: data?.business_day_start ?? '04:00:00',
    serviceRateBp: data?.service_rate_bp ?? 0,
    timbreMillimes: data?.stamp_duty_millimes ?? 0,
  }
}

export async function chargerVentes(
  restaurantId: string,
  periode: Periode,
): Promise<VentesChargees> {
  const supabase = await supabaseServeur()
  const debut = periode.bornes.debut.toISOString()
  const fin = periode.bornes.fin.toISOString()

  const [commandesRes, produitsRes, categoriesRes, employesRes, paiementsRes, remboursementsRes] =
    await Promise.all([
      supabase
        .from('orders')
        .select(
          'id, status, ticket_number, total_millimes, closed_at, covers, opened_by, closed_by',
        )
        .eq('restaurant_id', restaurantId)
        .eq('status', 'close')
        .gte('closed_at', debut)
        .lt('closed_at', fin)
        .order('closed_at', { ascending: false }),
      supabase
        .from('products')
        .select('id, name, cost_per_unit, category_id')
        .eq('restaurant_id', restaurantId),
      supabase.from('categories').select('id, name').eq('restaurant_id', restaurantId),
      supabase.from('users').select('id, full_name'),
      supabase
        .from('payments')
        .select('type, amount_millimes, voided_at, created_at')
        .eq('restaurant_id', restaurantId)
        .is('voided_at', null)
        .gte('created_at', debut)
        .lt('created_at', fin),
      supabase
        .from('refunds')
        .select('amount_millimes, created_at')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', debut)
        .lt('created_at', fin),
    ])

  if (commandesRes.error) return VIDE(commandesRes.error.message)

  /*
   * Les lignes en une SECONDE requête, par tranches d'identifiants.
   *
   * L'imbrication PostgREST (`orders(…, order_items(…))`) serait plus élégante,
   * mais `schema.ts` est écrit à la main et ne porte pas les relations
   * inverses : le type se résout alors en `GenericStringError` et rien ne
   * compile. Le découpage, lui, borne aussi la longueur de l'URL — un mois de
   * ventes fait des centaines de commandes, et un `in(...)` d'un seul tenant
   * finirait par être rejeté par le serveur.
   */
  const TRANCHE = 200
  const idsCommandes = (commandesRes.data ?? []).map((c) => c.id)
  const lignesBrutes: LigneBrute[] = []
  for (let i = 0; i < idsCommandes.length; i += TRANCHE) {
    const { data, error } = await supabase
      .from('order_items')
      // Un SEUL littéral, jamais une concaténation : supabase-js infère le
      // type du résultat en LISANT cette chaîne. Un `'a' + 'b'` se résout en
      // `string`, et toute la requête retombe sur `GenericStringError`.
      .select(
        'id, order_id, product_id, designation, qty, line_gross_millimes, line_discount_millimes, global_discount_share_millimes, line_total_millimes, voided_at',
      )
      .in('order_id', idsCommandes.slice(i, i + TRANCHE))
      .is('voided_at', null)
      .order('position', { ascending: true })
    if (error) return VIDE(error.message)
    lignesBrutes.push(...(data ?? []))
  }

  const lignesParCommande = new Map<string, LigneBrute[]>()
  for (const l of lignesBrutes) {
    lignesParCommande.set(l.order_id, [...(lignesParCommande.get(l.order_id) ?? []), l])
  }

  const produits = new Map(
    (produitsRes.data ?? []).map((p) => [
      p.id,
      { cout: p.cost_per_unit, categorieId: p.category_id },
    ]),
  )
  const categories = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.name]))
  const employes = new Map((employesRes.data ?? []).map((u) => [u.id, u.full_name]))
  const nomEmploye = (id: string | null) => (id && employes.get(id)) || 'Inconnu'

  const lignes: LigneVendue[] = []
  const commandes: CommandeVendue[] = []
  const tickets: TicketResume[] = []

  for (const commande of commandesRes.data ?? []) {
    // `closed_by` d'abord : la vente s'attribue à qui l'a ENCAISSÉE. Un
    // serveur ouvre la table, c'est le caissier qui conclut la vente.
    const vendeurId = commande.closed_by ?? commande.opened_by ?? null
    commandes.push({
      id: commande.id,
      totalMillimes: commande.total_millimes,
      vendeurId,
      closeA: commande.closed_at,
    })

    // Les lignes annulées sont déjà écartées par la requête : le client ne
    // les a pas payées, elles ne sont ni du chiffre, ni du coût.
    const brutes = lignesParCommande.get(commande.id) ?? []
    for (const l of brutes) {
      const produit = l.product_id ? produits.get(l.product_id) : undefined
      const categorieId = produit?.categorieId ?? null
      lignes.push({
        orderId: commande.id,
        produitId: l.product_id,
        designation: l.designation,
        quantite: l.qty,
        brutMillimes: l.line_gross_millimes,
        remiseLigneMillimes: l.line_discount_millimes,
        remiseGlobaleMillimes: l.global_discount_share_millimes,
        netMillimes: l.line_total_millimes,
        // `undefined` deviendrait « pas de coût » comme `null` ; on normalise
        // pour que `lignesSansCout` compte juste.
        coutUnitaire: produit?.cout ?? null,
        categorieId,
        categorieNom: categorieId ? (categories.get(categorieId) ?? null) : null,
      })
    }

    tickets.push({
      id: commande.id,
      numero: commande.ticket_number,
      totalMillimes: commande.total_millimes,
      closeA: commande.closed_at,
      vendeur: nomEmploye(vendeurId),
      couverts: commande.covers,
      nombreArticles: brutes.reduce((t, l) => t + l.qty, 0),
    })
  }

  return {
    lignes,
    commandes,
    tickets,
    paiements: (paiementsRes.data ?? []).map((p) => ({
      type: p.type,
      montantMillimes: p.amount_millimes,
    })),
    remboursements: (remboursementsRes.data ?? []).map((r) => ({
      montantMillimes: r.amount_millimes,
    })),
    nomEmploye,
    erreur: null,
  }
}
