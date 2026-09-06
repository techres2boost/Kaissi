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
import {
  chargerFiche,
  chargerVentes,
  resoudrePeriode,
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
  readonly ventes: VentesChargees
  /** Les mêmes ventes, sur la période précédente de même longueur. */
  readonly precedent: VentesChargees
  readonly aujourdhui: string
  readonly employes: EmployeFiltre[]
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

  const [ventes, precedent, employes] = await Promise.all([
    chargerVentes(restaurantId, periode, fiche, filtres),
    chargerVentes(restaurantId, precedente, fiche, filtres),
    chargerEmployes(restaurantId),
  ])

  return {
    fiche,
    periode,
    filtres,
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
