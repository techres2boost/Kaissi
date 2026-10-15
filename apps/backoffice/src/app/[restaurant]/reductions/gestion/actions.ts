'use server'

/**
 * Le référentiel de réductions (migration 0030).
 *
 * ── Ce que ces réductions changent, et ce qu'elles ne changent pas ────────
 *
 * Elles ne créent aucun droit : le plafond de remise reste celui du RÔLE, et
 * une réduction de 50 % demandera toujours l'autorisation d'un responsable.
 * Elles nomment la décision, rien de plus — et c'est ce nom qui manquait au
 * rapport.
 *
 * ── Pourquoi elles s'archivent au lieu de se supprimer ────────────────────
 *
 * Les ventes passées portent l'identifiant. Le supprimer casserait le
 * regroupement du rapport sur tout l'historique, pour gagner une ligne dans
 * une liste.
 */

import { revalidatePath } from 'next/cache'
import { uuidV7 } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../../serveur/session.js'
import { supabaseServeur } from '../../../../serveur/supabase.js'
import {
  choix,
  ErreurSaisie,
  montantMillimes,
  texteObligatoire,
} from '../../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

async function agir(
  restaurantId: string,
  travail: (contexte: {
    supabase: Awaited<ReturnType<typeof supabaseServeur>>
    organizationId: string
  }) => Promise<string>,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const succes = await travail({
      supabase: await supabaseServeur(),
      organizationId: etablissement.organizationId,
    })
    revalidatePath(`/${restaurantId}/reductions/gestion`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Lit un pourcentage saisi en clair (« 10 », « 12,5 ») en points de base.
 *
 * RÈGLE 1 : le taux est un ENTIER de points de base — 10 % = 1000. Un
 * flottant `0.1` traînerait ensuite dans tous les calculs.
 */
function pourcentageEnBp(donnees: FormData, champ: string): number {
  const brut = String(donnees.get(champ) ?? '').trim().replace(',', '.')
  if (brut === '') throw new ErreurSaisie(champ, 'Le pourcentage est obligatoire.')
  const valeur = Number(brut)
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) {
    throw new ErreurSaisie(champ, 'Le pourcentage doit être compris entre 0 et 100.')
  }
  return Math.round(valeur * 100)
}

export async function creerReduction(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom de la réduction', 60)
    const type = choix(donnees, 'type', 'Le type', ['pourcentage', 'montant'] as const)
    const { error } = await supabase.from('discounts').insert({
      // RÈGLE 2 : l'identifiant vient du client, jamais d'un « serial ».
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      name: nom,
      kind: type,
      // Exactement l'une des deux valeurs : la contrainte de base refuse le
      // reste, et cette forme-ci évite d'y arriver.
      value_bp: type === 'pourcentage' ? pourcentageEnBp(donnees, 'pourcentage') : null,
      amount_millimes:
        type === 'montant' ? montantMillimes(donnees, 'montant', 'Le montant') : null,
      position: Number(donnees.get('position') ?? 0) || 0,
    })
    if (error) throw new Error(error.message)
    return `Réduction « ${nom} » créée. Les caisses la proposeront à leur prochaine synchronisation.`
  })
}

/**
 * Renomme une réduction ET change sa valeur — pas son type.
 *
 * Changer la valeur est sans danger pour l'historique : chaque vente porte,
 * dans son événement `discount.applied`, le pourcentage ou le montant
 * RÉELLEMENT appliqué, et son libellé recopié. Passer « Happy hour » de 10 à
 * 15 % ne réécrit donc aucun ticket déjà remis ; les caisses proposent la
 * nouvelle valeur après leur prochaine synchronisation.
 *
 * Le TYPE, lui, ne change pas : « 10 » voudrait dire 10 % avant et 10 TND
 * après, sur la même ligne du rapport. Pour passer d'un pourcentage à un
 * montant, on archive et on crée.
 */
export async function modifierReduction(
  restaurantId: string,
  reductionId: string,
  type: 'pourcentage' | 'montant',
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom de la réduction', 60)
    const valeur =
      type === 'pourcentage'
        ? { value_bp: pourcentageEnBp(donnees, 'valeur') }
        : { amount_millimes: montantMillimes(donnees, 'valeur', 'Le montant') }
    const { error } = await supabase
      .from('discounts')
      .update({ name: nom, ...valeur })
      .eq('id', reductionId)
      .eq('restaurant_id', restaurantId)
      // Le type est relu en base : un formulaire resté ouvert sur une
      // ancienne version ne doit pas écrire un montant dans un pourcentage.
      .eq('kind', type)
    if (error) throw new Error(error.message)
    return (
      `Réduction « ${nom} » enregistrée. Les caisses la proposeront ainsi à leur ` +
      'prochaine synchronisation ; les ventes déjà encaissées gardent ce qui a été accordé.'
    )
  })
}

export async function archiverReduction(
  restaurantId: string,
  reductionId: string,
  archiver: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('discounts')
      .update({ archived_at: archiver ? new Date().toISOString() : null })
      .eq('id', reductionId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return archiver
      ? 'Réduction archivée. Les caisses cesseront de la proposer ; les ventes passées la mentionnent toujours.'
      : 'Réduction remise en service.'
  })
}
