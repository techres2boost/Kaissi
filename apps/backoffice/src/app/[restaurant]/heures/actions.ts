'use server'

/**
 * « Heures travaillées » — corriger une sortie oubliée.
 *
 * Le cas normal d'une pointeuse : un serveur part sans pointer. Le domaine
 * ne compte pas ce pointage jusqu'à « maintenant » (il serait de trente
 * heures) ; il le signale. Le gérant, qui sait à quelle heure le service a
 * fini, saisit la sortie ici.
 *
 * Ce qui reste visible : `corrected_by` (le COMPTE qui a corrigé) et
 * `corrected_at`. Une heure saisie à la main n'est pas une heure pointée, et
 * l'écran le dit sur la ligne.
 *
 * Deux gardes : `exigerGestionnaire` pour un message lisible, RLS
 * (`time_entries_correction`, encadrement seulement) pour la vraie serrure.
 */

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie } from '../../../serveur/formulaire.js'
import { chargerFiche } from '../../../serveur/ventes.js'
import { instantLocal } from '../../../serveur/journee.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

export async function corrigerSortie(
  restaurantId: string,
  pointageId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const supabase = await supabaseServeur()
    const fiche = await chargerFiche(restaurantId)

    const brut = donnees.get('sortie')
    let sortie: Date
    try {
      sortie = instantLocal(typeof brut === 'string' ? brut : '', fiche.timezone)
    } catch {
      throw new ErreurSaisie('sortie', 'Heure de sortie illisible.')
    }

    const { data: pointage, error: lecture } = await supabase
      .from('time_entries')
      .select('clock_in_at')
      .eq('id', pointageId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle()
    if (lecture) throw new Error(lecture.message)
    if (!pointage) throw new ErreurSaisie('sortie', 'Pointage introuvable — rechargez la page.')
    if (sortie.getTime() <= new Date(pointage.clock_in_at).getTime()) {
      throw new ErreurSaisie('sortie', 'La sortie doit suivre l’arrivée.')
    }
    if (sortie.getTime() > Date.now()) {
      throw new ErreurSaisie('sortie', 'La sortie ne peut pas être dans le futur.')
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('time_entries')
      .update({
        clock_out_at: sortie.toISOString(),
        corrected_by: user?.id ?? null,
        corrected_at: new Date().toISOString(),
      })
      .eq('id', pointageId)
      .eq('restaurant_id', restaurantId)
      .select('id')
    if (error) throw new Error(error.message)
    // Zéro ligne : RLS a refusé. Le dire, plutôt qu'un succès silencieux.
    if (!data || data.length === 0) {
      throw new ErreurSaisie('sortie', 'Correction refusée : votre rôle ne le permet pas.')
    }
    revalidatePath(`/${restaurantId}/heures`)
    return { succes: 'Sortie corrigée.' }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}
