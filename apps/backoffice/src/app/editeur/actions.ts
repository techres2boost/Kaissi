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

/**
 * L'état du service de synchronisation — l'écran Surveillance.
 *
 * Même régime que la liste des clients : ces chiffres traversent tous les
 * restaurants, le service relit `KAISSI_EDITEURS` à chaque appel, et la
 * page n'existe pas (404) pour un autre compte.
 */
export interface Surveillance {
  horodatage: string
  demarreLe: string
  dureeVieSecondes: number
  processus: {
    node: string
    coeurs: number
    chargeSysteme: number[]
    memoireSystemeOctets: number
    memoireLibreOctets: number
    rssOctets: number
    tasOctets: number
    tasTotalOctets: number
    historique: { instant: string; cpuPourcent: number; rssOctets: number; tasOctets: number; boucleP99Ms: number }[]
  }
  requetes: {
    parMinute: { minute: string; total: number; erreurs5xx: number; erreurs4xx: number; dureeMoyenneMs: number }[]
    familles15min: {
      famille: string
      requetes: number
      erreurs5xx: number
      erreurs4xx: number
      p50Ms: number
      p95Ms: number
      p99Ms: number
      maxMs: number
    }[]
  }
  erreursRecentes: { instant: string; famille: string; statut: number; message: string }[]
  base: {
    latenceMs: number
    tailleOctets: number
    connexions: number
    connexionsActives: number
    connexionsMax: number
    attentesVerrou: number
    requetePlusLongueSecondes: number
    cachePourcent: number | null
    validations: number
    annulations: number
    interblocages: number
    tables: { nom: string; tailleOctets: number; lignesEstimees: number }[]
    pool: { total: number; libres: number; enAttente: number; max: number }
    metier: {
      evenements1h: number
      evenements24h: number
      commandes1h: number
      rejets24h: number
      caisses: number
      caissesVues15min: number
      caissesMuettes24h: number
      projectionsManquantes: number
    }
  } | null
  erreurBase: string | null
  migrationsManquantes: string[]
  alertes: { niveau: 'critique' | 'attention'; sujet: string; message: string }[]
}

/** `null` : pas éditeur. Une chaîne : le service n'a pas répondu, et pourquoi. */
export async function lireSurveillance(): Promise<Surveillance | null | string> {
  await sessionObligatoire()
  try {
    return (await appelerService('/admin/surveillance', {})) as unknown as Surveillance
  } catch (erreur) {
    // Un refus d'accès se distingue d'une panne : le premier rend la page
    // inexistante, la seconde est précisément ce que l'écran doit montrer.
    if (erreur instanceof ErreurSaisie && /éditeur|Accès|refus/i.test(erreur.message)) return null
    return erreur instanceof Error ? erreur.message : String(erreur)
  }
}
