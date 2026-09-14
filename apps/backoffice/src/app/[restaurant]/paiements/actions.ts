'use server'

/**
 * Paramètres → Modes de paiement.
 *
 * ── Ce qu'un mode de paiement décide, et ce qu'il ne décide pas ───────────
 *
 * Il décide ce que le caissier peut choisir à l'encaissement, et si le tiroir
 * s'ouvre. Il ne décide RIEN du montant : un paiement est un montant en
 * millimes rattaché à un libellé, et les totaux se calculent ailleurs — dans
 * `packages/domain`, à un seul endroit.
 *
 * ── Pourquoi on ARCHIVE au lieu de supprimer ──────────────────────────────
 *
 * Chaque paiement encaissé pointe son mode. Le supprimer viderait le libellé
 * de toutes les ventes passées et casserait le rapport « Ventes par mode de
 * paiement » sur tout l'historique, pour gagner une ligne dans une liste.
 */

import { revalidatePath } from 'next/cache'
import { uuidV7 } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { choix, ErreurSaisie, texteObligatoire } from '../../../serveur/formulaire.js'
// Un module « use server » ne peut EXPORTER que des fonctions async : la
// liste des types vit donc à côté. Voir `types-paiement.ts`.
import { TYPES_PAIEMENT } from './types-paiement.js'

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
    revalidatePath(`/${restaurantId}/paiements`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

export async function creerModePaiement(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du mode de paiement', 60)
    const type = choix(donnees, 'type', 'Le type', TYPES_PAIEMENT)

    /*
     * La position se déduit, elle ne se saisit pas. Demander un numéro
     * d'ordre à chaque ajout est un champ que personne ne sait remplir, pour
     * une valeur qui n'apparaît nulle part — on met le nouveau en dernier.
     */
    const { data: dernier } = await supabase
      .from('payment_methods')
      .select('position')
      .eq('restaurant_id', restaurantId)
      .order('position', { ascending: false })
      .limit(1)

    const { error } = await supabase.from('payment_methods').insert({
      // RÈGLE 2 : l'identifiant vient du client, jamais d'un « serial ».
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      name: nom,
      type,
      opens_drawer: donnees.get('tiroir') === 'oui',
      position: ((dernier?.[0]?.position as number | undefined) ?? -1) + 1,
      is_active: true,
    })
    if (error) throw new Error(error.message)
    return `Mode « ${nom} » créé. Les caisses le proposeront à leur prochaine synchronisation.`
  })
}

export async function modifierModePaiement(
  restaurantId: string,
  modeId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du mode de paiement', 60)
    const type = choix(donnees, 'type', 'Le type', TYPES_PAIEMENT)

    const { error } = await supabase
      .from('payment_methods')
      .update({ name: nom, type, opens_drawer: donnees.get('tiroir') === 'oui' })
      .eq('id', modeId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return (
      `Mode « ${nom} » mis à jour. Les paiements DÉJÀ encaissés gardent leur ` +
      'libellé : un rapport qui change quand on renomme un réglage ne serait plus un historique.'
    )
  })
}

export async function archiverModePaiement(
  restaurantId: string,
  modeId: string,
  archiver: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    if (archiver) {
      /*
       * On REFUSE d'archiver le dernier mode actif. Sans aucun mode, la
       * caisse ne peut plus rien encaisser : elle refuserait la vente
       * suivante sans expliquer pourquoi, et le gérant chercherait la panne
       * partout sauf ici.
       */
      const { count, error } = await supabase
        .from('payment_methods')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .is('archived_at', null)
        .neq('id', modeId)
      if (error) throw new Error(error.message)
      if ((count ?? 0) === 0) {
        throw new ErreurSaisie(
          'mode',
          'C’est le dernier mode de paiement actif. Sans lui, la caisse ne ' +
            'peut plus rien encaisser — créez-en un autre d’abord.',
        )
      }
    }

    const { error } = await supabase
      .from('payment_methods')
      .update({ archived_at: archiver ? new Date().toISOString() : null })
      .eq('id', modeId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return archiver
      ? 'Mode archivé. Les caisses cesseront de le proposer ; les ventes passées le mentionnent toujours.'
      : 'Mode remis en service.'
  })
}
