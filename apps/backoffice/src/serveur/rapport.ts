/**
 * Le socle commun de tous les écrans de rapport.
 *
 * ── Pourquoi un socle, et pas six pages qui se ressemblent ────────────────
 *
 * Chaque rapport a besoin des mêmes quatre choses : la période, les filtres,
 * les ventes de cette période, et les MÊMES ventes sur la période
 * précédente pour l'écart. Six écrans qui refont ce chargement, c'est six
 * occasions de définir « une vente » différemment — et le jour où deux
 * écrans se contredisent, personne ne sait lequel a tort.
 *
 * ── La période précédente est de MÊME LONGUEUR ────────────────────────────
 *
 * Sept jours se comparent aux sept jours d'avant, un mois au mois d'avant.
 * Comparer à une durée différente donnerait un pourcentage qui aurait l'air
 * juste — le pire genre d'erreur.
 */

import { journeeCourante, journeeDecalee } from './journee.js'
import { resoudreFiltres, type FiltresRapport } from './filtres.js'
import { chargerAgregats, type RapportAgrege } from './agregats.js'
import {
  chargerFiche,
  chargerNomsEmployes,
  chargerVentes,
  resoudrePeriode,
  VENTES_NON_CHARGEES,
  type FicheRestaurant,
  type Periode,
  type VentesChargees,
} from './ventes.js'
import { supabaseServeur } from './supabase.js'

export interface EmployeFiltre {
  readonly id: string
  readonly nom: string
}

export interface SocleRapport {
  readonly fiche: FicheRestaurant
  readonly periode: Periode
  readonly filtres: FiltresRapport
  /** Les totaux, agrégés PAR PostgreSQL. Toujours chargés. */
  readonly agregats: RapportAgrege
  /** Les mêmes totaux, sur la période précédente de même longueur. */
  readonly agregatsPrecedent: RapportAgrege
  /**
   * Les ventes LIGNE À LIGNE — chargées uniquement sur demande.
   *
   * Deux écrans en ont réellement besoin : la liste des reçus, et le détail
   * des tickets remisés. Ce sont des LISTES, où une ligne écrite est une
   * ligne lue. Partout ailleurs on n'affiche que des totaux, et les
   * remonter pour les additionner en JavaScript est le défaut que la
   * migration 0033 corrige.
   */
  readonly ventes: VentesChargees
  readonly precedent: VentesChargees
  readonly aujourdhui: string
  readonly employes: EmployeFiltre[]
}

/** Ce dont un écran a besoin en plus des totaux. */
export interface BesoinsRapport {
  /**
   * Charger aussi les ventes ligne à ligne. `false` par défaut, et c'est
   * l'essentiel de R-1 : un écran qui n'affiche que des totaux ne doit plus
   * rien télécharger de proportionnel au nombre de ventes.
   */
  readonly lignes?: boolean
  /** Charger aussi la période précédente ligne à ligne. Rare. */
  readonly lignesPrecedent?: boolean
}

/** Nombre de journées d'une période, bornes incluses. */
function longueurEnJours(du: string, au: string): number {
  return (
    Math.round(
      (Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86_400_000,
    ) + 1
  )
}

export async function chargerRapport(
  restaurantId: string,
  params: Record<string, string | undefined>,
  besoins: BesoinsRapport = {},
): Promise<SocleRapport> {
  const fiche = await chargerFiche(restaurantId)
  const periode = resoudrePeriode(fiche, params['du'], params['au'])
  const filtres = resoudreFiltres(params)

  const jours = longueurEnJours(periode.du, periode.au)
  const precedente = resoudrePeriode(
    fiche,
    journeeDecalee(periode.du, -jours),
    journeeDecalee(periode.du, -1),
  )

  /*
   * Les noms d'abord : les agrégats par employé ne rendent qu'un
   * identifiant, et c'est ici qu'on sait le nommer.
   *
   * Deux listes distinctes, et ce n'est pas une redite. `employes` alimente
   * le SÉLECTEUR de filtre — les appartenances actives, celles qu'on a un
   * sens à choisir. `nomEmploye` alimente l'AFFICHAGE — tous les employés
   * visibles, y compris ceux qui sont partis, parce que leurs ventes sont
   * toujours dans les rapports.
   */
  const [employes, nomEmploye] = await Promise.all([
    chargerEmployes(restaurantId),
    chargerNomsEmployes(),
  ])

  const [agregats, agregatsPrecedent, ventes, precedent] = await Promise.all([
    chargerAgregats(restaurantId, periode, fiche, filtres, nomEmploye),
    chargerAgregats(restaurantId, precedente, fiche, filtres, nomEmploye),
    besoins.lignes
      ? chargerVentes(restaurantId, periode, fiche, filtres)
      : Promise.resolve(VENTES_NON_CHARGEES),
    besoins.lignesPrecedent
      ? chargerVentes(restaurantId, precedente, fiche, filtres)
      : Promise.resolve(VENTES_NON_CHARGEES),
  ])

  return {
    fiche,
    periode,
    filtres,
    agregats,
    agregatsPrecedent,
    ventes,
    precedent,
    aujourdhui: journeeCourante(fiche.timezone, fiche.bascule),
    employes,
  }
}

/**
 * Les employés proposés au filtre.
 *
 * Ceux de l'ÉTABLISSEMENT, pas de l'organisation : un gérant de deux
 * restaurants n'a rien à faire du personnel de l'autre dans cette liste.
 * Les appartenances révoquées sont exclues, mais pas les employés suspendus
 * — leurs ventes passées existent toujours, et c'est souvent celles-là qu'on
 * vient regarder.
 */
async function chargerEmployes(restaurantId: string): Promise<EmployeFiltre[]> {
  const supabase = await supabaseServeur()
  const { data } = await supabase
    .from('memberships')
    .select('user_id, users(id, full_name, email)')
    .eq('restaurant_id', restaurantId)
    .is('revoked_at', null)

  return (data ?? [])
    .map((ligne) => {
      const u = ligne.users as { id: string; full_name: string; email: string | null } | null
      return u ? { id: u.id, nom: u.full_name || u.email || '—' } : null
    })
    .filter((e): e is EmployeFiltre => e !== null)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}
