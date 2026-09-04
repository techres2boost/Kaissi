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
 * clé dupliquée à l'écran.
 *
 * Il ÉCRASE la ligne au lieu de l'ignorer (0029) : c'est ce qui permet de
 * remarquer prêt une commande dont le « prêt » avait été retiré. Ignorer le
 * conflit laisserait `cleared_at` posé, et le plat resterait éteint sur la
 * tablette du serveur alors que la cuisine vient de le déclarer prêt.
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
        ready_at: new Date().toISOString(),
        ready_by: session.employeId,
        cleared_at: null,
        cleared_by: null,
      },
      { onConflict: 'order_id' },
    )
    if (error) return { erreur: error.message }
    revalidatePath(`/${restaurantId}/preparation`)
    return {}
  } catch (erreur) {
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Retire un « prêt » posé par erreur.
 *
 * MARQUE la ligne, ne la supprime plus (migration 0029). Une suppression est
 * invisible pour la tablette du serveur en salle : rien ne descendrait, et
 * son badge « Prêt » resterait allumé sur un plat qui ne l'est pas. C'est la
 * règle 6 appliquée à un marqueur — une annulation ajoute une information,
 * elle n'en retire jamais.
 */
export async function retirerPrete(
  restaurantId: string,
  orderId: string,
): Promise<Resultat> {
  try {
    const { session } = await etablissementObligatoire(restaurantId)
    const supabase = await supabaseServeur()
    const { error } = await supabase
      .from('kitchen_ready')
      .update({ cleared_at: new Date().toISOString(), cleared_by: session.employeId })
      .eq('order_id', orderId)
      .eq('restaurant_id', restaurantId)
      .is('cleared_at', null)
    if (error) return { erreur: error.message }
    revalidatePath(`/${restaurantId}/preparation`)
    return {}
  } catch (erreur) {
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}
