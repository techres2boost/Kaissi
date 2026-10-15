'use server'

/**
 * L'écran de l'ÉDITEUR (Res2Boost) — tous les clients, leur formule.
 *
 * L'éditeur n'est membre d'AUCUN restaurant client : il ne peut donc pas
 * passer par « Paramètres → Abonnement » d'un établissement qu'il ne voit
 * pas. Et le back-office, qui ne parle qu'avec la clé publique, ne lit rien
 * au-delà de ses propres établissements (RLS). La liste vient donc du service
 * de synchronisation, qui relit `KAISSI_EDITEURS` à chaque appel.
 */

import { revalidatePath } from 'next/cache'
import { sessionObligatoire } from '../../serveur/session.js'
import { appelerService } from '../../serveur/service-sync.js'
import { ErreurSaisie } from '../../serveur/formulaire.js'

export interface ClientEditeur {
  organizationId: string
  nom: string
  plan: string
  depuis: string | null
  note: string | null
  etablissements: { nom: string; ferme: boolean }[]
}

export async function listerClients(): Promise<ClientEditeur[] | null> {
  await sessionObligatoire()
  try {
    const reponse = await appelerService('/admin/editeur/clients', {})
    return (reponse['clients'] as ClientEditeur[] | undefined) ?? []
  } catch {
    // Pas éditeur, ou service injoignable : la page n'existe pas.
    return null
  }
}

export async function changerFormuleClient(
  organizationId: string,
  formule: 'gratuit' | 'pro',
): Promise<{ erreur?: string; succes?: string }> {
  await sessionObligatoire()
  try {
    const { message } = await appelerService('/admin/abonnement', { organizationId, formule })
    revalidatePath('/editeur')
    return { succes: message ?? 'Formule changée.' }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    throw erreur
  }
}
