/**
 * Agrégation des ventes — PUR, sans accès à la base.
 *
 * Toutes les sommes d'argent passent par `@kaissi/domain` : ce sont les
 * MÊMES fonctions que la caisse. Refaire ces additions en SQL produirait un
 * second endroit où l'argent se calcule, donc un jour un écart entre l'écran
 * du gérant et le ticket du client (RÈGLE 7).
 *
 * ── Quelle grandeur pour quel usage ──────────────────────────────────────
 *
 * Trois montants coexistent, et les confondre fausse tout :
 *
 *   • BRUT      `line_gross`   — avant remise, hors taxe.
 *   • NET       `line_total`   — après remises, hors taxe exclusive. C'est la
 *                                SEULE grandeur comparable au coût d'achat,
 *                                lui aussi hors taxe. Le CA des rapports.
 *   • ENCAISSÉ  `payments`     — ce qui est entré en caisse, TTC.
 *
 * La marge se calcule sur le NET. Mélanger un CA TTC et un coût HT la
 * gonflerait d'un point de TVA — une erreur qui ne se voit pas, et qui fait
 * croire à une rentabilité qu'on n'a pas.
 */

import {
  additionner,
  calculerMarge,
  coutLigneExact,
  millimes,
  panierMoyen,
  totaliserCouts,
  type Marge,
  type Millimes,
} from '@kaissi/domain'
// La bascule de journée commerciale vit dans UN seul module : deux
// définitions du « jour » dans un même produit garantissent deux chiffres
// différents pour la même soirée.
import { journeeCourante, journeeDecalee } from './journee.js'

/** Une ligne vendue, telle que les rapports la lisent. */
export interface LigneVendue {
  readonly orderId: string
  readonly produitId: string | null
  readonly designation: string
  readonly quantite: number
  readonly brutMillimes: number
  readonly remiseLigneMillimes: number
  readonly remiseGlobaleMillimes: number
  readonly netMillimes: number
  /** Coût unitaire du produit au catalogue, fractionnaire, ou `null`. */
  readonly coutUnitaire: number | null
  readonly categorieId: string | null
  readonly categorieNom: string | null
}

export interface CommandeVendue {
  readonly id: string
  readonly totalMillimes: number
  readonly vendeurId: string | null
  readonly closeA: string | null
}

export interface PaiementEncaisse {
  readonly type: string
  readonly montantMillimes: number
}

export interface Remboursement {
  readonly montantMillimes: number
}

/** Les indicateurs de tête — ceux du tableau de bord. */
export interface Indicateurs {
  readonly caNetMillimes: Millimes
  readonly caBrutMillimes: Millimes
  readonly remisesMillimes: Millimes
  readonly remboursementsMillimes: Millimes
  readonly coutMillimes: Millimes
  readonly marge: Marge
  readonly nombreTickets: number
  readonly panierMoyenMillimes: Millimes | null
  readonly articlesVendus: number
  /**
   * Lignes dont le produit n'a AUCUN coût saisi. Le coût total est donc
   * sous-estimé, et la marge surestimée d'autant. On le compte pour le dire,
   * plutôt que de présenter un total faux comme s'il était juste.
   */
  readonly lignesSansCout: number
}

function sommeMillimes(valeurs: readonly number[]): Millimes {
  return additionner(...valeurs.map((v) => millimes(Math.round(v || 0))))
}

export function calculerIndicateurs(
  lignes: readonly LigneVendue[],
  commandes: readonly CommandeVendue[],
  remboursements: readonly Remboursement[] = [],
): Indicateurs {
  const caNet = sommeMillimes(lignes.map((l) => l.netMillimes))
  const caBrut = sommeMillimes(lignes.map((l) => l.brutMillimes))
  const remises = sommeMillimes(
    lignes.map((l) => l.remiseLigneMillimes + l.remiseGlobaleMillimes),
  )
  // Coûts EXACTS accumulés, arrondis UNE fois : arrondir chaque ligne ferait
  // dériver le total de plusieurs dinars sur un service.
  const cout = totaliserCouts(lignes.map((l) => coutLigneExact(l.coutUnitaire, l.quantite)))

  return {
    caNetMillimes: caNet,
    caBrutMillimes: caBrut,
    remisesMillimes: remises,
    remboursementsMillimes: sommeMillimes(remboursements.map((r) => r.montantMillimes)),
    coutMillimes: cout,
    marge: calculerMarge(caNet, cout),
    nombreTickets: commandes.length,
    panierMoyenMillimes: panierMoyen(caNet, commandes.length),
    articlesVendus: lignes.reduce((total, l) => total + l.quantite, 0),
    lignesSansCout: lignes.filter(
      (l) => l.coutUnitaire === null || l.coutUnitaire === undefined,
    ).length,
  }
}

/** Une ventilation : un libellé, ses volumes, son CA, son coût, sa marge. */
export interface Ventilation {
  readonly cle: string
  readonly libelle: string
  readonly quantite: number
  readonly marge: Marge
  readonly part: number
}

/**
 * Regroupe des lignes selon une clé, et classe par CA décroissant.
 *
 * `part` est la fraction du CA total, en points de base — c'est ce qui
 * répond à « qu'est-ce qui fait mon chiffre ? » d'un coup d'œil.
 */
function ventiler(
  lignes: readonly LigneVendue[],
  cleDe: (l: LigneVendue) => { cle: string; libelle: string },
): Ventilation[] {
  const groupes = new Map<string, { libelle: string; lignes: LigneVendue[] }>()
  for (const ligne of lignes) {
    const { cle, libelle } = cleDe(ligne)
    const groupe = groupes.get(cle) ?? { libelle, lignes: [] }
    groupe.lignes.push(ligne)
    groupes.set(cle, groupe)
  }

  const total = lignes.reduce((t, l) => t + l.netMillimes, 0)

  return [...groupes.entries()]
    .map(([cle, groupe]) => {
      const net = sommeMillimes(groupe.lignes.map((l) => l.netMillimes))
      const cout = totaliserCouts(
        groupe.lignes.map((l) => coutLigneExact(l.coutUnitaire, l.quantite)),
      )
      return {
        cle,
        libelle: groupe.libelle,
        quantite: groupe.lignes.reduce((t, l) => t + l.quantite, 0),
        marge: calculerMarge(net, cout),
        part: total === 0 ? 0 : Math.round((net / total) * 10000),
      }
    })
    .sort((a, b) => b.marge.caMillimes - a.marge.caMillimes)
}

export function ventilerParProduit(lignes: readonly LigneVendue[]): Ventilation[] {
  // La clé est le produit s'il existe encore au catalogue, sinon la
  // désignation FIGÉE sur la ligne : un produit supprimé ne doit pas faire
  // disparaître son chiffre d'affaires du rapport.
  return ventiler(lignes, (l) => ({
    cle: l.produitId ?? `designation:${l.designation}`,
    libelle: l.designation,
  }))
}

export function ventilerParCategorie(lignes: readonly LigneVendue[]): Ventilation[] {
  return ventiler(lignes, (l) => ({
    cle: l.categorieId ?? 'sans-categorie',
    libelle: l.categorieNom ?? 'Sans catégorie',
  }))
}

/**
 * Ventilation par employé. Elle porte sur les COMMANDES, pas sur les lignes :
 * c'est la vente entière qu'on attribue à celui qui l'a encaissée.
 */
export function ventilerParEmploye(
  lignes: readonly LigneVendue[],
  commandes: readonly CommandeVendue[],
  nomDe: (id: string | null) => string,
): Ventilation[] {
  const vendeurParCommande = new Map(commandes.map((c) => [c.id, c.vendeurId ?? null]))
  return ventiler(lignes, (l) => {
    const vendeur = vendeurParCommande.get(l.orderId) ?? null
    return { cle: vendeur ?? 'inconnu', libelle: nomDe(vendeur) }
  })
}

export interface VentilationPaiement {
  readonly type: string
  readonly libelle: string
  readonly montantMillimes: Millimes
  readonly nombre: number
}

const LIBELLE_PAIEMENT: Record<string, string> = {
  cash: 'Espèces',
  card: 'Carte',
  online: 'En ligne',
  other: 'Autre',
}

export function ventilerParPaiement(
  paiements: readonly PaiementEncaisse[],
): VentilationPaiement[] {
  const groupes = new Map<string, number[]>()
  for (const p of paiements) {
    groupes.set(p.type, [...(groupes.get(p.type) ?? []), p.montantMillimes])
  }
  return [...groupes.entries()]
    .map(([type, montants]) => ({
      type,
      libelle: LIBELLE_PAIEMENT[type] ?? type,
      montantMillimes: sommeMillimes(montants),
      nombre: montants.length,
    }))
    .sort((a, b) => b.montantMillimes - a.montantMillimes)
}

export interface JourneeCA {
  readonly journee: string
  readonly caMillimes: Millimes
  readonly tickets: number
}

/**
 * Regroupe les commandes par JOURNÉE COMMERCIALE.
 *
 * ── Le piège, et il coûte cher ────────────────────────────────────────────
 *
 * Une vente encaissée à 1 h du matin appartient à la soirée de la VEILLE.
 * Grouper sur la date de calendrier couperait chaque service en deux à
 * minuit : le samedi soir paraîtrait moitié moins bon qu'il ne l'a été, et
 * le dimanche matin inexplicablement bon. C'est la même bascule que l'écran
 * Journée, et elle doit rester la même partout — deux définitions du « jour »
 * dans un même produit garantissent deux chiffres différents pour la même
 * soirée.
 *
 * Les journées SANS vente sont rendues à zéro, pas omises. Un graphique qui
 * saute les jours creux resserre les colonnes et fait disparaître le lundi
 * de fermeture : on lirait une semaine régulière là où il y a un trou.
 */
export function ventilerParJournee(
  commandes: readonly CommandeVendue[],
  fuseau: string,
  bascule: string,
  bornes: { du: string; au: string },
): JourneeCA[] {
  const cumul = new Map<string, { total: number[]; tickets: number }>()

  for (const c of commandes) {
    if (!c.closeA) continue
    const journee = journeeCourante(fuseau, bascule, new Date(c.closeA))
    const seau = cumul.get(journee) ?? { total: [], tickets: 0 }
    seau.total.push(c.totalMillimes)
    seau.tickets += 1
    cumul.set(journee, seau)
  }

  const jours: JourneeCA[] = []
  // Borne de sécurité : une période absurde (« du 2020 au 2030 ») produirait
  // des milliers de colonnes et figerait la page. `resoudrePeriode` rabote
  // déjà la demande, ceci ne fait qu'empêcher la boucle infinie si un jour
  // ce n'était plus le cas.
  for (let jour = bornes.du, garde = 0; garde < 400; garde += 1) {
    const seau = cumul.get(jour)
    jours.push({
      journee: jour,
      caMillimes: sommeMillimes(seau?.total ?? []),
      tickets: seau?.tickets ?? 0,
    })
    if (jour === bornes.au) break
    jour = journeeDecalee(jour, 1)
  }
  return jours
}

/** L'état d'un produit au regard de son seuil — ce que la pastille affiche. */
export type EtatStock = 'rupture' | 'faible' | 'ok' | 'non_suivi'

export function etatStock(
  quantite: number | null | undefined,
  seuil: number | null | undefined,
): EtatStock {
  if (quantite === null || quantite === undefined) return 'non_suivi'
  // Zéro ET négatif : un stock négatif est une rupture doublée d'une
  // réception oubliée, jamais un « presque en rupture ».
  if (quantite <= 0) return 'rupture'
  if (seuil !== null && seuil !== undefined && quantite <= seuil) return 'faible'
  return 'ok'
}
