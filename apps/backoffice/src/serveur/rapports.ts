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
  /** TVA de la ligne, telle que la projection l'a calculée. */
  readonly taxeMillimes: number
  /** Coût unitaire du produit au catalogue, fractionnaire, ou `null`. */
  readonly coutUnitaire: number | null
  readonly categorieId: string | null
  readonly categorieNom: string | null
  /** La réduction de LIGNE, et son nom figé au moment de la vente (0030). */
  readonly reductionId: string | null
  readonly reductionNom: string | null
}

export interface CommandeVendue {
  readonly id: string
  readonly totalMillimes: number
  readonly vendeurId: string | null
  readonly closeA: string | null
  /** La réduction GLOBALE de la commande, et son nom figé (0030). */
  readonly reductionId?: string | null
  readonly reductionNom?: string | null
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
  /*
   * Le détail que réclame un export comptable, et que l'écran masque par
   * défaut : ventes BRUTES, réductions, taxes. Sans elles, on ne peut pas
   * refaire à la main le chemin du brut au net — et un rapport qu'on ne peut
   * pas vérifier n'est pas un rapport, c'est une affirmation.
   */
  readonly brutMillimes: Millimes
  readonly remisesMillimes: Millimes
  readonly taxesMillimes: Millimes
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
        brutMillimes: sommeMillimes(groupe.lignes.map((l) => l.brutMillimes)),
        remisesMillimes: sommeMillimes(
          groupe.lignes.map((l) => l.remiseLigneMillimes + l.remiseGlobaleMillimes),
        ),
        taxesMillimes: sommeMillimes(groupe.lignes.map((l) => l.taxeMillimes)),
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

/** Ce qu'une réduction a coûté sur la période. */
export interface VentilationReduction {
  readonly cle: string
  readonly libelle: string
  readonly montantMillimes: Millimes
  /** Nombre de VENTES concernées, pas de lignes. */
  readonly ventes: number
}

/**
 * Ce que chaque réduction a coûté, par MOTIF.
 *
 * ── Pourquoi une fonction à part, et pas `ventiler()` ─────────────────────
 *
 * Les autres ventilations partagent un chiffre d'affaires : chaque ligne
 * appartient à un article, à une catégorie, à un employé. Une réduction, non
 * — une vente peut n'en porter aucune, et deux réductions peuvent coexister
 * sur la même vente (une de ligne, une globale). On additionne donc des
 * MONTANTS REMISÉS, jamais un CA, et la somme des parts ne fait pas 100 %.
 *
 * ── « Sans motif » est une ligne, pas un trou ─────────────────────────────
 *
 * Une remise saisie à la main n'invente pas de nom. La ranger sous « Sans
 * motif » dit la vérité — et rend visible le jour où elle devient
 * l'habitude, ce qu'un total muet cacherait.
 */
export function ventilerParReduction(
  lignes: readonly LigneVendue[],
  commandes: readonly CommandeVendue[],
): VentilationReduction[] {
  const groupes = new Map<string, { libelle: string; montants: number[]; ventes: Set<string> }>()

  const ajouter = (
    cle: string | null | undefined,
    libelle: string | null | undefined,
    montant: number,
    orderId: string,
  ) => {
    if (montant <= 0) return
    // La clé est l'identifiant du référentiel s'il existe, sinon le libellé
    // figé, sinon « sans motif ». Une réduction supprimée du référentiel ne
    // doit pas faire disparaître ce qu'elle a coûté.
    const identifiant = cle ?? (libelle ? `libelle:${libelle}` : 'sans-motif')
    const groupe = groupes.get(identifiant) ?? {
      libelle: libelle ?? 'Sans motif',
      montants: [],
      ventes: new Set<string>(),
    }
    groupe.montants.push(montant)
    groupe.ventes.add(orderId)
    groupes.set(identifiant, groupe)
  }

  for (const ligne of lignes) {
    ajouter(ligne.reductionId, ligne.reductionNom, ligne.remiseLigneMillimes, ligne.orderId)
  }

  // La remise GLOBALE est portée par la commande : ses quotes-parts sont
  // réparties sur les lignes, mais le motif, lui, est unique.
  const globaleParCommande = new Map<string, number>()
  for (const ligne of lignes) {
    globaleParCommande.set(
      ligne.orderId,
      (globaleParCommande.get(ligne.orderId) ?? 0) + ligne.remiseGlobaleMillimes,
    )
  }
  for (const commande of commandes) {
    ajouter(
      commande.reductionId,
      commande.reductionNom,
      globaleParCommande.get(commande.id) ?? 0,
      commande.id,
    )
  }

  return [...groupes.entries()]
    .map(([cle, g]) => ({
      cle,
      libelle: g.libelle,
      montantMillimes: sommeMillimes(g.montants),
      ventes: g.ventes.size,
    }))
    .sort((a, b) => b.montantMillimes - a.montantMillimes)
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

/** Le pas de temps d'un graphique de rapport. */
export type Granularite = 'jours' | 'semaines' | 'mois'

export interface PointSerie {
  /** Clé stable du seau — sert de `key` React et d'ordre de tri. */
  readonly cle: string
  /** Ce qui s'affiche sous la colonne : « lun. 1 », « 31 août – 6 sept. ». */
  readonly libelle: string
  readonly caMillimes: Millimes
  readonly tickets: number
}

/** Lundi de la semaine d'une journée « AAAA-MM-JJ ». */
function lundiDe(journee: string): string {
  const [a, m, j] = journee.split('-').map(Number)
  const date = new Date(Date.UTC(a!, m! - 1, j!))
  // `getUTCDay()` rend 0 pour dimanche : on le ramène à 7 pour que la semaine
  // commence le lundi, comme partout en Tunisie et dans Loyverse.
  const jourSemaine = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (jourSemaine - 1))
  return date.toISOString().slice(0, 10)
}

function libelleCourt(journee: string): string {
  const [a, m, j] = journee.split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(a!, m! - 1, j!)))
}

/**
 * Agrège des journées en SEMAINES ou en MOIS.
 *
 * ── Pourquoi partir des journées déjà ventilées ───────────────────────────
 *
 * `ventilerParJournee` porte déjà la seule règle difficile : une vente
 * encaissée à 1 h du matin appartient à la soirée de la veille. Regrouper
 * ensuite des journées, c'est de l'arithmétique. Repartir des commandes
 * réécrirait cette règle une deuxième fois — et deux écritures d'une même
 * règle finissent toujours par diverger.
 *
 * Les seaux VIDES sont conservés : une semaine de fermeture doit se voir en
 * creux, pas disparaître en resserrant le graphique.
 */
export function agregerSerie(
  journees: readonly JourneeCA[],
  granularite: Granularite,
): PointSerie[] {
  if (granularite === 'jours') {
    return journees.map((j) => ({
      cle: j.journee,
      libelle: libelleCourt(j.journee),
      caMillimes: j.caMillimes,
      tickets: j.tickets,
    }))
  }

  const cumul = new Map<string, { total: number[]; tickets: number; premiere: string; derniere: string }>()
  for (const j of journees) {
    const cle = granularite === 'semaines' ? lundiDe(j.journee) : j.journee.slice(0, 7)
    const seau = cumul.get(cle) ?? { total: [], tickets: 0, premiere: j.journee, derniere: j.journee }
    seau.total.push(j.caMillimes)
    seau.tickets += j.tickets
    seau.derniere = j.journee
    cumul.set(cle, seau)
  }

  return [...cumul.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cle, seau]) => ({
      cle,
      libelle:
        granularite === 'semaines'
          ? `${libelleCourt(seau.premiere)} – ${libelleCourt(seau.derniere)}`
          : new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
              .format(new Date(`${cle}-01T00:00:00Z`)),
      caMillimes: sommeMillimes(seau.total),
      tickets: seau.tickets,
    }))
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
