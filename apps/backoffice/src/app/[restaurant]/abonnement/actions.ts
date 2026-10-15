'use server'

/**
 * Changer la formule d'un client — réservé à l'ÉDITEUR (Res2Boost).
 *
 * La table `subscriptions` n'a aucune politique d'écriture (migration 0040) :
 * le back-office, qui ne parle qu'avec la clé publique, ne PEUT pas écrire la
 * formule. Il demande au service de synchronisation, qui relit la liste des
 * éditeurs (`KAISSI_EDITEURS`) à chaque appel. Un administrateur de
 * restaurant est le CLIENT : s'il pouvait cliquer « Payant », la formule
 * payante serait offerte.
 */

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire } from '../../../serveur/session.js'
import { appelerService } from '../../../serveur/service-sync.js'
import { ErreurSaisie } from '../../../serveur/formulaire.js'

export interface ResultatFormule {
  erreur?: string
  succes?: string
}

/** Ce compte est-il éditeur ? Faux si le service ne répond pas : on n'ouvre rien par défaut. */
export async function estEditeur(): Promise<boolean> {
  try {
    const reponse = await appelerService('/admin/editeur', {})
    return reponse['editeur'] === true
  } catch {
    return false
  }
}

export async function changerFormule(
  restaurantId: string,
  formule: 'gratuit' | 'pro',
): Promise<ResultatFormule> {
  await etablissementObligatoire(restaurantId)
  try {
    const { message } = await appelerService('/admin/abonnement', { restaurantId, formule })
    revalidatePath(`/${restaurantId}`, 'layout')
    return { succes: message ?? 'Formule changée.' }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    throw erreur
  }
}
