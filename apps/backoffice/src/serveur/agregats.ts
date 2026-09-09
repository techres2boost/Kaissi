/**
 * Les rapports agrégés PAR PostgreSQL — et rendus au domaine pour le reste.
 *
 * ── Le problème que ce module résout ──────────────────────────────────────
 *
 * `chargerVentes()` (voir `ventes.ts`) tire la LIGNE À LIGNE : sur 92 jours
 * à 200 ventes par jour, ~18 000 commandes et ~55 000 lignes traversent le
 * réseau, sont désérialisées en objets JavaScript dans une fonction
 * serverless, puis additionnées — pour afficher une trentaine de nombres.
 * L'audit l'a mesuré au point de rupture (C-2) : 73 000 commandes, un tri
 * SUR DISQUE, et une erreur 500 sur l'écran des chiffres d'affaires. Le
 * plafond de 50 000 posé alors est un garde-fou, pas une architecture.
 *
 * Ici, les sommes se font là où sont les lignes, et il ne remonte qu'un
 * objet JSON de quelques kilo-octets. Le plafond n'a plus d'objet sur les
 * écrans qui n'affichent que des totaux.
 *
 * ── Et la RÈGLE 7 ? La frontière, exactement ─────────────────────────────
 *
 * « Les totaux se calculent à UN SEUL endroit », `packages/domain`. Ce
 * module a l'air d'être ce que le dépôt interdit. Il ne l'est pas :
 *
 *   • Une RÈGLE est une décision — arrondir la TVA par taux puis sommer,
 *     répartir la remise globale au prorata, rapporter la marge au CA,
 *     n'arrondir les coûts qu'une fois au total. Aucune n'est ici.
 *   • Une SOMME d'entiers déjà décidés n'est pas une décision. `sum()` est
 *     associative et exacte : les mêmes millimes additionnés dans un autre
 *     ordre donnent le même total.
 *
 * En pratique, tout ce qui sort de SQL repasse par le domaine avant d'être
 * affiché : `millimes()` valide que c'est bien un entier sûr,
 * `totaliserCouts()` fait l'unique arrondi des coûts, `calculerMarge()`
 * décide de la base et du pourcentage. La fonction SQL ne rend d'ailleurs
 * PAS les coûts arrondis, justement pour ne pas pouvoir le décider.
 *
 * ⚑ Un test compare les deux chemins sur le même jeu de ventes et exige
 *   l'égalité AU MILLIME (`apps/sync/test/rapports-agreges.test.ts`).
 *   C'est du calcul d'argent : ça se valide par comparaison, jamais par
 *   relecture.
 */

import {
  calculerMarge,
  millimes,
  panierMoyen,
  totaliserCouts,
  type Marge,
  type Millimes,
} from '@kaissi/domain'
import { journeeDecalee } from './journee.js'
import { FILTRES_PAR_DEFAUT, type FiltresRapport } from './filtres.js'
import { supabaseServeur } from './supabase.js'
import type {
  Indicateurs,
  JourneeCA,
  Ventilation,
  VentilationPaiement,
  VentilationReduction,
} from './rapports.js'
import type { FicheRestaurant, Periode } from './ventes.js'

/* ─────────────────────────────────────────────────────────────────────────
 * Ce que la fonction SQL rend, tel quel.
 *
 * Les noms sont ceux des colonnes (`snake_case`) : c'est volontaire. Voir
 * un `net_millimes` dans le code dit qu'on est encore du côté brut de la
 * frontière, et qu'aucune règle du domaine ne s'y est appliquée.
 * ───────────────────────────────────────────────────────────────────────── */

interface SommeVentilation {
  cle: string
  libelle?: string
  /** Nombre de VENTES — rendu par la seule ventilation par employé. */
  tickets?: number
  /** Rendu par la seule ventilation par produit. */
  categorie_nom?: string | null
  quantite: number
  net_millimes: number
  brut_millimes: number
  remises_millimes: number
  taxes_millimes: number
  /** NON arrondi — c'est `totaliserCouts()` qui décidera. */
  cout_exact: number
}

interface ReponseAgregats {
  nombreTickets: number
  indicateurs: {
    ca_net_millimes: number
    ca_brut_millimes: number
    remises_millimes: number
    taxes_millimes: number
    cout_exact: number
    articles_vendus: number
    lignes_sans_cout: number
  }
  remboursementsMillimes: number
  parProduit: SommeVentilation[]
  parCategorie: SommeVentilation[]
  parEmploye: SommeVentilation[]
  parReduction: { cle: string; libelle: string; montant_millimes: number; ventes: number }[]
  parPaiement: { type: string; montant_millimes: number; nombre: number }[]
  parJournee: SommeJournee[]
}

/**
 * Une journée commerciale.
 *
 * `total_millimes` est le total TTC des commandes — la hauteur des barres du
 * graphique. Les autres champs sont le détail HORS TAXE des lignes, qui
 * alimente le tableau sous ce même graphique. Les deux viennent de la MÊME
 * requête et donc du même découpage du « jour » : deux découpages sur un
 * même écran garantissent qu'on additionnera les colonnes de l'un en lisant
 * les barres de l'autre.
 */
interface SommeJournee {
  journee: string
  total_millimes: number
  tickets: number
  net_millimes: number
  brut_millimes: number
  remises_millimes: number
  taxes_millimes: number
  cout_exact: number
}

/** Ce que les écrans consomment — les mêmes types que le chemin ligne à ligne. */
export interface RapportAgrege {
  readonly indicateurs: Indicateurs
  /** Par article, avec sa catégorie — la colonne secondaire de l'écran. */
  readonly parProduit: (Ventilation & { readonly categorieNom: string | null })[]
  readonly parCategorie: Ventilation[]
  /**
   * Par employé, avec le nombre de TICKETS encaissés — la vente entière
   * s'attribue à qui l'a conclue, pas la ligne.
   */
  readonly parEmploye: (Ventilation & { readonly tickets: number })[]
  readonly parReduction: VentilationReduction[]
  readonly parPaiement: VentilationPaiement[]
  readonly parJournee: JourneeCA[]
  /** Le détail hors taxe de chaque journée — le tableau sous le graphique. */
  readonly detailParJournee: DetailJournee[]
  readonly erreur: string | null
}

/** Une journée avec sa marge — ce que le tableau « Détail par journée » lit. */
export interface DetailJournee {
  readonly journee: string
  readonly tickets: number
  readonly netMillimes: Millimes
  readonly brutMillimes: Millimes
  readonly remisesMillimes: Millimes
  readonly taxesMillimes: Millimes
  readonly marge: Marge
}

const LIBELLE_PAIEMENT: Record<string, string> = {
  cash: 'Espèces',
  card: 'Carte',
  online: 'En ligne',
  other: 'Autre',
}

/**
 * Repasse une somme SQL par le domaine.
 *
 * `Math.round` avant `millimes()` : PostgreSQL rend un `bigint` que JSON
 * transporte en nombre — entier par construction, mais `millimes()` LÈVE
 * sur un non-entier, et un garde-fou qui fait tomber la page n'aide
 * personne. On normalise donc, comme le fait déjà `sommeMillimes()` du
 * chemin ligne à ligne.
 */
function m(valeur: number | null | undefined): Millimes {
  return millimes(Math.round(valeur ?? 0))
}

/**
 * Reconstruit une ventilation complète depuis des sommes brutes.
 *
 * Trois choses restent au domaine, et ce sont les trois qui décident :
 * l'arrondi UNIQUE du coût, la marge, et la part du CA — une division, donc
 * un arrondi, donc jamais du SQL.
 */
function versVentilation(
  sommes: readonly SommeVentilation[],
  caTotal: number,
  libelleDe: (s: SommeVentilation) => string,
): Ventilation[] {
  return sommes
    .map((s) => {
      const net = m(s.net_millimes)
      // Le coût arrive EXACT et fractionnaire ; il n'est arrondi qu'ici,
      // une seule fois — arrondir chaque ligne ferait dériver le total de
      // plusieurs dinars sur un service.
      const cout = totaliserCouts([s.cout_exact])
      return {
        cle: s.cle,
        libelle: libelleDe(s),
        quantite: s.quantite,
        marge: calculerMarge(net, cout),
        part: caTotal === 0 ? 0 : Math.round((net / caTotal) * 10000),
        brutMillimes: m(s.brut_millimes),
        remisesMillimes: m(s.remises_millimes),
        taxesMillimes: m(s.taxes_millimes),
      }
    })
    .sort((a, b) => b.marge.caMillimes - a.marge.caMillimes)
}

/**
 * Ajoute les journées SANS vente, à zéro.
 *
 * SQL ne rend que les journées où quelque chose a été encaissé — c'est la
 * bonne réponse à « group by ». Mais un graphique qui saute les jours
 * creux resserre les colonnes et fait disparaître le lundi de fermeture :
 * on lirait une semaine régulière là où il y a un trou. Le remplissage se
 * fait donc ici, où les bornes demandées sont connues.
 */
function completerJournees(
  seaux: readonly SommeJournee[],
  bornes: { du: string; au: string },
): JourneeCA[] {
  const parJour = new Map(seaux.map((s) => [s.journee, s]))
  const jours: JourneeCA[] = []
  // Même borne de sécurité que le chemin ligne à ligne : une période absurde
  // ne doit pas produire une boucle infinie, même si `resoudrePeriode` la
  // rabote déjà.
  for (let jour = bornes.du, garde = 0; garde < 400; garde += 1) {
    const seau = parJour.get(jour)
    jours.push({
      journee: jour,
      caMillimes: m(seau?.total_millimes ?? 0),
      tickets: seau?.tickets ?? 0,
    })
    if (jour === bornes.au) break
    jour = journeeDecalee(jour, 1)
  }
  return jours
}

const VIDE = (erreur: string | null): RapportAgrege => ({
  indicateurs: {
    caNetMillimes: millimes(0),
    caBrutMillimes: millimes(0),
    remisesMillimes: millimes(0),
    remboursementsMillimes: millimes(0),
    coutMillimes: millimes(0),
    marge: calculerMarge(millimes(0), millimes(0)),
    nombreTickets: 0,
    panierMoyenMillimes: null,
    articlesVendus: 0,
    lignesSansCout: 0,
  },
  parProduit: [], parCategorie: [], parEmploye: [],
  parReduction: [], parPaiement: [], parJournee: [], detailParJournee: [],
  erreur,
})

/**
 * Charge les agrégats d'une période — une seule requête, aucun plafond.
 *
 * Le fuseau et l'heure de bascule descendent depuis `chargerFiche()` : la
 * fonction SQL ne relit PAS la fiche de l'établissement, sans quoi elle
 * deviendrait un second endroit où se décide « quel jour est cette vente ».
 */
export async function chargerAgregats(
  restaurantId: string,
  periode: Periode,
  fiche: FicheRestaurant,
  filtres: FiltresRapport = FILTRES_PAR_DEFAUT,
  /** Résout le nom d'un employé — l'agrégat SQL ne rend que son identifiant. */
  nomEmploye: (id: string | null) => string = () => 'Inconnu',
): Promise<RapportAgrege> {
  const supabase = await supabaseServeur()
  const { data, error } = await supabase.rpc('rapport_ventes', {
    p_restaurant: restaurantId,
    p_debut: periode.bornes.debut.toISOString(),
    p_fin: periode.bornes.fin.toISOString(),
    p_timezone: fiche.timezone,
    p_bascule: fiche.bascule,
    p_employe: filtres.employeId,
    p_heure_debut: filtres.heureDebut,
    p_heure_fin: filtres.heureFin,
  })

  if (error) return VIDE(error.message)
  const brut = data as unknown as ReponseAgregats | null
  if (!brut) return VIDE(null)

  const i = brut.indicateurs
  const caNet = m(i.ca_net_millimes)
  const cout = totaliserCouts([i.cout_exact])

  return {
    indicateurs: {
      caNetMillimes: caNet,
      caBrutMillimes: m(i.ca_brut_millimes),
      remisesMillimes: m(i.remises_millimes),
      remboursementsMillimes: m(brut.remboursementsMillimes),
      coutMillimes: cout,
      marge: calculerMarge(caNet, cout),
      nombreTickets: brut.nombreTickets,
      panierMoyenMillimes: panierMoyen(caNet, brut.nombreTickets),
      articlesVendus: i.articles_vendus,
      lignesSansCout: i.lignes_sans_cout,
    },
    parProduit: versVentilation(brut.parProduit, i.ca_net_millimes, (s) => s.libelle ?? '—').map(
      (v) => ({
        ...v,
        categorieNom: brut.parProduit.find((s) => s.cle === v.cle)?.categorie_nom ?? null,
      }),
    ),
    parCategorie: versVentilation(brut.parCategorie, i.ca_net_millimes, (s) => s.libelle ?? '—'),
    // Le nom se résout ICI, où la liste des employés est déjà chargée : le
    // faire en SQL en ferait un second endroit où « Inconnu » se décide.
    parEmploye: versVentilation(brut.parEmploye, i.ca_net_millimes, (s) =>
      nomEmploye(s.cle === 'inconnu' ? null : s.cle),
    ).map((v) => ({
      ...v,
      // `versVentilation` trie par CA : on retrouve le compteur par la clé,
      // jamais par la position — elle ne veut plus rien dire après le tri.
      tickets: brut.parEmploye.find((s) => s.cle === v.cle)?.tickets ?? 0,
    })),
    parReduction: brut.parReduction
      .map((r) => ({
        cle: r.cle,
        libelle: r.libelle,
        montantMillimes: m(r.montant_millimes),
        ventes: r.ventes,
      }))
      .sort((a, b) => b.montantMillimes - a.montantMillimes),
    parPaiement: brut.parPaiement
      .map((p) => ({
        type: p.type,
        libelle: LIBELLE_PAIEMENT[p.type] ?? p.type,
        montantMillimes: m(p.montant_millimes),
        nombre: p.nombre,
      }))
      .sort((a, b) => b.montantMillimes - a.montantMillimes),
    parJournee: completerJournees(brut.parJournee, { du: periode.du, au: periode.au }),
    detailParJournee: brut.parJournee.map((j) => {
      const net = m(j.net_millimes)
      return {
        journee: j.journee,
        tickets: j.tickets,
        netMillimes: net,
        brutMillimes: m(j.brut_millimes),
        remisesMillimes: m(j.remises_millimes),
        taxesMillimes: m(j.taxes_millimes),
        // Une marge PAR JOUR, arrondie une fois pour ce jour-là. La somme
        // des marges journalières peut donc différer de la marge de la
        // période d'un millime ou deux — c'est l'arithmétique de l'arrondi,
        // pas une erreur, et c'était déjà le cas du chemin ligne à ligne.
        marge: calculerMarge(net, totaliserCouts([j.cout_exact])),
      }
    }),
    erreur: null,
  }
}
