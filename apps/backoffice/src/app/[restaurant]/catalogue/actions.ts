'use server'

import { revalidatePath } from 'next/cache'
import { uuidV7 } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import {
  caseCochee,
  choix,
  choixFacultatif,
  ErreurSaisie,
  montantMillimes,
  position,
  texteFacultatif,
  texteObligatoire,
} from '../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  champ?: string
  succes?: string
}

/**
 * Enveloppe commune : garde d'accès, traduction des erreurs, rafraîchissement.
 *
 * Un message PostgreSQL brut (« new row violates row-level security policy »)
 * ne dit rien à un gérant. Ce qui lui est utile, c'est : vous n'avez pas le
 * rôle, ou ce nom existe déjà.
 */
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
    const supabase = await supabaseServeur()
    const succes = await travail({ supabase, organizationId: etablissement.organizationId })
    revalidatePath(`/${restaurantId}/catalogue`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) {
      return { erreur: erreur.message, champ: erreur.champ }
    }
    // `redirect()` de Next.js passe par une exception : la relancer, sinon la
    // redirection serait avalée et l'utilisateur resterait bloqué.
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/** Traduit les violations de contrainte les plus fréquentes. */
function messageBase(message: string, code?: string): string {
  if (code === '23505') return 'Ce nom ou ce code existe déjà dans cet établissement.'
  if (code === '42501' || message.includes('row-level security')) {
    return "Votre rôle ne permet pas cette modification. Seul un gérant peut modifier le catalogue."
  }
  if (code === '23503') return 'Une référence liée est introuvable — rechargez la page.'
  return message
}

// ── Catégories ──────────────────────────────────────────────────────────────

export async function creerCategorie(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom de la catégorie', 100)
    const { error } = await supabase.from('categories').insert({
      // RÈGLE 2 : l'identifiant vient du client, jamais d'un « serial ».
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      name: nom,
      position: position(donnees, 'position'),
    })
    if (error) throw new Error(messageBase(error.message, error.code))
    return `Catégorie « ${nom} » créée.`
  })
}

export async function archiverCategorie(
  restaurantId: string,
  categorieId: string,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    // Archivage, jamais suppression : les commandes déjà passées portent cette
    // catégorie, et un historique amputé ne se reconstitue pas.
    const { error } = await supabase
      .from('categories')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', categorieId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message, error.code))
    return 'Catégorie archivée. Les produits qu’elle contenait restent en vente.'
  })
}

// ── Produits ────────────────────────────────────────────────────────────────

export async function enregistrerProduit(
  restaurantId: string,
  categoriesAutorisees: readonly string[],
  stationsAutorisees: readonly string[],
  tauxAutorises: readonly string[],
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const idExistant = texteFacultatif(donnees, 'id')
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du produit', 200)

    const champs = {
      organization_id: organizationId,
      restaurant_id: restaurantId,
      name: nom,
      description: texteFacultatif(donnees, 'description'),
      category_id: choixFacultatif(donnees, 'categorie', 'La catégorie', categoriesAutorisees),
      station_id: choixFacultatif(donnees, 'station', 'La station', stationsAutorisees),
      tax_rate_id: choix(donnees, 'taux', 'Le taux de TVA', tauxAutorises),
      // Le prix passe par depuisDecimal : « 24,5 » devient 24500 millimes.
      base_price_millimes: montantMillimes(donnees, 'prix', 'Le prix'),
      position: position(donnees, 'position'),
      is_available: caseCochee(donnees, 'disponible'),
      updated_at: new Date().toISOString(),
    }

    if (idExistant) {
      const { error } = await supabase
        .from('products')
        .update(champs)
        .eq('id', idExistant)
        .eq('restaurant_id', restaurantId)
      if (error) throw new Error(messageBase(error.message, error.code))
      return `« ${nom} » enregistré. Les tablettes le recevront à leur prochaine synchronisation.`
    }

    const { error } = await supabase.from('products').insert({ id: uuidV7(), ...champs })
    if (error) throw new Error(messageBase(error.message, error.code))
    return `« ${nom} » créé. Les tablettes le recevront à leur prochaine synchronisation.`
  })
}

export async function basculerDisponibilite(
  restaurantId: string,
  produitId: string,
  disponible: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('products')
      .update({ is_available: disponible, updated_at: new Date().toISOString() })
      .eq('id', produitId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message, error.code))
    return disponible ? 'Produit remis en vente.' : 'Produit retiré de la vente.'
  })
}

export async function archiverProduit(restaurantId: string, produitId: string): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('products')
      .update({ archived_at: new Date().toISOString(), is_available: false })
      .eq('id', produitId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message, error.code))
    return 'Produit archivé. Les commandes passées le mentionnent toujours.'
  })
}
