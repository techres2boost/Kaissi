'use server'

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'

export interface Resultat {
  erreur?: string
}

/**
 * Annonce une commande prête.
 *
 * Réservé à AUCUN rôle en particulier : quiconque est membre du restaurant
 * peut le faire, cuisine comprise. C'est RLS qui le vérifie
 * (`kitchen_ready_insertion`), pas ce fichier — un contrôle applicatif
 * oublié ici ne peut donc rien ouvrir.
 *
 * `upsert` et non `insert` : deux cuisiniers qui cliquent sur le même
 * plateau à une seconde d'intervalle ne doivent pas produire une erreur de
 * clé dupliquée à l'écran. Le premier clic fait foi.
 */
export async function marquerPrete(
  restaurantId: string,
  orderId: string,
): Promise<Resultat> {
  try {
    const { session, etablissement } = await etablissementObligatoire(restaurantId)
    const supabase = await supabaseServeur()
    const { error } = await supabase.from('kitchen_ready').upsert(
      {
        order_id: orderId,
        organization_id: etablissement.organizationId,
        restaurant_id: restaurantId,
        ready_by: session.employeId,
      },
      { onConflict: 'order_id', ignoreDuplicates: true },
    )
    if (error) return { erreur: error.message }
    revalidatePath(`/${restaurantId}/cuisine`)
    return {}
  } catch (erreur) {
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Retire un « prêt » posé par erreur.
 *
 * Rien n'est perdu : ce marqueur n'est pas de la comptabilité. L'historique
 * de la vente vit dans `order_events`, qui reste en insertion seule.
 */
export async function retirerPrete(
  restaurantId: string,
  orderId: string,
): Promise<Resultat> {
  try {
    await etablissementObligatoire(restaurantId)
    const supabase = await supabaseServeur()
    const { error } = await supabase
      .from('kitchen_ready')
      .delete()
      .eq('order_id', orderId)
      .eq('restaurant_id', restaurantId)
    if (error) return { erreur: error.message }
    revalidatePath(`/${restaurantId}/cuisine`)
    return {}
  } catch (erreur) {
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}
