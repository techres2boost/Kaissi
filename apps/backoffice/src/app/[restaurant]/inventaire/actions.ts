'use server'

/**
 * Articles → Inventaire avancé : les fiches FOURNISSEURS.
 *
 * ── Ce que ces fiches ajoutent, et ce qu'elles ne retirent pas ────────────
 *
 * La migration 0026 avait volontairement laissé le fournisseur en TEXTE
 * libre, et sa raison tient toujours : « une table imposerait de créer un
 * fournisseur avant de saisir une réception — donc un formulaire de plus au
 * moment où quelqu'un décharge des cageots ».
 *
 * Ces fiches ne changent donc rien à la saisie d'une réception. Le champ
 * reste libre ; il propose simplement les noms déjà connus, et la réception
 * se RATTACHE à la fiche quand le nom tapé correspond. Un nom inconnu passe
 * exactement comme avant.
 *
 * ── Deux gardes, et la seconde n'est pas ici ──────────────────────────────
 *
 * `exigerGestionnaire()` évite d'afficher un bouton qui échouerait. Ce qui
 * PROTÈGE, c'est RLS : `protege_referentiel('suppliers')` (migration 0041)
 * n'accorde l'écriture qu'à `est_gestionnaire(restaurant_id)`. Un oubli ici
 * ne rend donc rien du tout.
 *
 * ⚑ La garde de MODULE n'est pas dans ce fichier non plus. Elle est sur
 *   l'écran, qui montre l'invitation à s'abonner AU LIEU des fiches — on ne
 *   laisse pas une garde technique tenir lieu d'argumentaire commercial. Les
 *   actions restent protégées par RLS et par le rôle, comme partout ailleurs.
 */

import { revalidatePath } from 'next/cache'
import { uuidV7 } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie, texteFacultatif, texteObligatoire } from '../../../serveur/formulaire.js'

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
    revalidatePath(`/${restaurantId}/inventaire`)
    // L'écran Stock propose la liste des fiches dans sa saisie de réception :
    // sans cette seconde invalidation, un fournisseur créé à l'instant
    // n'apparaîtrait pas là où on vient précisément de le créer pour l'utiliser.
    revalidatePath(`/${restaurantId}/stock`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Traduit l'index unique partiel en une phrase lisible.
 *
 * Sans cela, créer deux fois « Sfax Primeurs » rend « duplicate key value
 * violates unique constraint "suppliers_nom_actif_idx" » — un message qui
 * envoie chercher la panne dans le logiciel.
 */
function messageBase(message: string): string {
  if (message.includes('suppliers_nom_actif_idx')) {
    return 'Une fiche active porte déjà ce nom. Les noms doivent être distincts.'
  }
  return message
}

export async function creerFournisseur(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const { error } = await supabase.from('suppliers').insert({
      // RÈGLE 2 : l'identifiant vient du code, jamais d'un « serial ».
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      name: texteObligatoire(donnees, 'nom', 'Le nom du fournisseur', 120),
      contact: texteFacultatif(donnees, 'contact', 120),
      phone: texteFacultatif(donnees, 'telephone', 40),
      note: texteFacultatif(donnees, 'note', 500),
    })
    if (error) throw new Error(messageBase(error.message))
    return 'Fournisseur ajouté.'
  })
}

export async function modifierFournisseur(
  restaurantId: string,
  fournisseurId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('suppliers')
      .update({
        name: texteObligatoire(donnees, 'nom', 'Le nom du fournisseur', 120),
        contact: texteFacultatif(donnees, 'contact', 120),
        phone: texteFacultatif(donnees, 'telephone', 40),
        note: texteFacultatif(donnees, 'note', 500),
      })
      .eq('id', fournisseurId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message))
    return 'Fournisseur enregistré.'
  })
}

/**
 * ARCHIVE une fiche — jamais de suppression.
 *
 * Ses réceptions restent dans l'historique du stock, et une fiche effacée les
 * rendrait illisibles. C'est la convention de tout le référentiel : produits,
 * taux, modes de paiement. Et l'index unique étant PARTIEL sur les fiches
 * actives, recréer plus tard un fournisseur du même nom reste possible.
 */
export async function archiverFournisseur(
  restaurantId: string,
  fournisseurId: string,
  archive: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('suppliers')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', fournisseurId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message))
    return archive ? 'Fournisseur archivé.' : 'Fournisseur réactivé.'
  })
}
