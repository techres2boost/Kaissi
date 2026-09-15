'use server'

/**
 * Articles → Modificateurs.
 *
 * ── Pourquoi cet écran existe maintenant ──────────────────────────────────
 *
 * Les trois tables (`modifier_groups`, `modifiers`, `product_modifiers`)
 * existent depuis la migration 0003, avec RLS. La caisse sait les lire et les
 * appliquer au prix d'une ligne. Il ne manquait QUE l'écran — exactement comme
 * les postes de préparation avant qu'on les rende créables : un mécanisme
 * complet, et aucune porte pour y entrer. Un restaurateur qui voulait proposer
 * « + Fromage 1,500 » devait passer par une console SQL.
 *
 * ── Ce qu'un modificateur change, et ce qu'il ne change pas ───────────────
 *
 * Il change le PRIX DE LA LIGNE : `prixBase + Σ modificateurs`, c'est
 * l'étape 1 de l'ordre figé de `packages/domain/src/totaux.ts`. Il ne change
 * ni le taux de taxe — celui du produit s'applique au tout — ni le stock :
 * un supplément n'est pas un article vendu.
 *
 * ── Pourquoi on ARCHIVE au lieu de supprimer ──────────────────────────────
 *
 * Chaque ligne de commande recopie le NOM et le PRIX du modificateur au
 * moment de la vente (`order_items.modifiers`). Supprimer ne casserait donc
 * pas l'historique — mais archiver garde la trace de ce qui a existé, et
 * surtout permet de le remettre en service sans le ressaisir.
 */

import { revalidatePath } from 'next/cache'
import { uuidV7 } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import {
  ErreurSaisie,
  montantMillimes,
  texteObligatoire,
} from '../../../serveur/formulaire.js'

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
    revalidatePath(`/${restaurantId}/modificateurs`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/** Un entier de sélection, borné — 0 signifie « sans limite » pour le maximum. */
function entier(donnees: FormData, champ: string, libelle: string, max = 20): number {
  const valeur = donnees.get(champ)
  const brut = typeof valeur === 'string' ? valeur.trim() : ''
  if (brut === '') return 0
  const nombre = Number(brut)
  if (!Number.isInteger(nombre) || nombre < 0 || nombre > max) {
    throw new ErreurSaisie(champ, `${libelle} doit être un entier entre 0 et ${max}.`)
  }
  return nombre
}

// ── Les GROUPES ─────────────────────────────────────────────────────────────

export async function creerGroupe(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du groupe', 100)
    const min = entier(donnees, 'min', 'Le minimum')
    const max = entier(donnees, 'max', 'Le maximum')

    /*
     * La contrainte de base l'impose déjà (`max_select = 0 or max_select >=
     * min_select`), mais elle répondrait par un message que personne ne peut
     * lire. On le dit ici, dans les mots de l'écran.
     */
    if (max !== 0 && max < min) {
      throw new ErreurSaisie(
        'max',
        'Le maximum ne peut pas être inférieur au minimum. Laissez-le à 0 pour « sans limite ».',
      )
    }

    const { data: dernier } = await supabase
      .from('modifier_groups')
      .select('position')
      .eq('restaurant_id', restaurantId)
      .order('position', { ascending: false })
      .limit(1)

    const { error } = await supabase.from('modifier_groups').insert({
      // RÈGLE 2 : l'identifiant vient du client, jamais d'un « serial ».
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      name: nom,
      min_select: min,
      max_select: max,
      // Obligatoire se DÉDUIT du minimum : exiger au moins un choix EST le
      // sens de « obligatoire ». Deux réglages pour une seule idée finissent
      // par se contredire — un groupe « obligatoire » avec un minimum à zéro
      // ne veut plus rien dire.
      is_required: min > 0,
      position: ((dernier?.[0]?.position as number | undefined) ?? -1) + 1,
    })
    if (error) throw new Error(error.message)
    return `Groupe « ${nom} » créé. Reste à lui ajouter des choix, puis à le rattacher à des articles.`
  })
}

export async function modifierGroupe(
  restaurantId: string,
  groupeId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du groupe', 100)
    const min = entier(donnees, 'min', 'Le minimum')
    const max = entier(donnees, 'max', 'Le maximum')
    if (max !== 0 && max < min) {
      throw new ErreurSaisie(
        'max',
        'Le maximum ne peut pas être inférieur au minimum. Laissez-le à 0 pour « sans limite ».',
      )
    }

    const { error } = await supabase
      .from('modifier_groups')
      .update({
        name: nom,
        min_select: min,
        max_select: max,
        is_required: min > 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', groupeId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return (
      `Groupe « ${nom} » mis à jour. Les commandes DÉJÀ passées gardent le nom ` +
      'et le prix des suppléments au moment de la vente.'
    )
  })
}

export async function archiverGroupe(
  restaurantId: string,
  groupeId: string,
  archiver: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('modifier_groups')
      .update({ archived_at: archiver ? new Date().toISOString() : null })
      .eq('id', groupeId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)

    /*
     * On ne détache PAS les articles au passage.
     *
     * Un groupe archivé disparaît de la caisse parce que ses modificateurs
     * n'y remontent plus — la jointure filtre sur `modifiers.archived_at`.
     * Le rattachement, lui, reste : remettre le groupe en service le
     * rétablit tel quel, au lieu d'obliger à retrouver les douze articles
     * auxquels il s'appliquait.
     */
    return archiver
      ? 'Groupe archivé. Les articles restent rattachés — le remettre en service le rétablit tel quel.'
      : 'Groupe remis en service.'
  })
}

// ── Les MODIFICATEURS d'un groupe ───────────────────────────────────────────

export async function creerModificateur(
  restaurantId: string,
  groupeId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du choix', 100)
    /*
     * Le supplément peut être NÉGATIF : « sans fromage −0,500 » est un usage
     * réel, et le schéma l'autorise (`price_delta_millimes` n'a pas de
     * contrainte de positivité). Zéro l'est aussi — « Bien cuit » ne coûte
     * rien mais doit figurer sur le bon de cuisine.
     */
    const delta = montantMillimes(donnees, 'prix', 'Le supplément', {
      autoriseNegatif: true,
    })

    const { data: dernier } = await supabase
      .from('modifiers')
      .select('position')
      .eq('modifier_group_id', groupeId)
      .order('position', { ascending: false })
      .limit(1)

    const { error } = await supabase.from('modifiers').insert({
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      modifier_group_id: groupeId,
      name: nom,
      price_delta_millimes: delta,
      position: ((dernier?.[0]?.position as number | undefined) ?? -1) + 1,
      is_available: true,
    })
    if (error) throw new Error(error.message)
    return `Choix « ${nom} » ajouté.`
  })
}

export async function modifierModificateur(
  restaurantId: string,
  modificateurId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du choix', 100)
    const delta = montantMillimes(donnees, 'prix', 'Le supplément', {
      autoriseNegatif: true,
    })

    const { error } = await supabase
      .from('modifiers')
      .update({
        name: nom,
        price_delta_millimes: delta,
        updated_at: new Date().toISOString(),
      })
      .eq('id', modificateurId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return `Choix « ${nom} » mis à jour. Les ventes passées gardent leur prix.`
  })
}

export async function archiverModificateur(
  restaurantId: string,
  modificateurId: string,
  archiver: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('modifiers')
      .update({ archived_at: archiver ? new Date().toISOString() : null })
      .eq('id', modificateurId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return archiver
      ? 'Choix archivé. Les caisses cesseront de le proposer ; les ventes passées le mentionnent toujours.'
      : 'Choix remis en service.'
  })
}

// ── Le RATTACHEMENT aux articles ────────────────────────────────────────────

/**
 * Rattache ou détache un groupe d'un article.
 *
 * ── Ce que ce geste déclenche, et qui n'existait pas ──────────────────────
 *
 * L'écriture réveille le déclencheur `product_modifiers_change_log`
 * (migration 0037), qui journalise l'ENSEMBLE des groupes du produit. La
 * caisse remplace alors les siens : c'est ce qui fait qu'un groupe DÉTACHÉ
 * disparaît vraiment du terminal.
 *
 * Avant la 0037, cette table n'avait aucun déclencheur : le rattachement
 * n'atteignait jamais la caisse, et AUCUN produit ne proposait le moindre
 * supplément sur un terminal appairé.
 */
export async function rattacherGroupe(
  restaurantId: string,
  groupeId: string,
  produitId: string,
  rattacher: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    if (!rattacher) {
      const { error } = await supabase
        .from('product_modifiers')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('product_id', produitId)
        .eq('modifier_group_id', groupeId)
      if (error) throw new Error(error.message)
      return 'Groupe détaché. Les caisses cesseront de le proposer sur cet article à leur prochaine synchronisation.'
    }

    const { error } = await supabase.from('product_modifiers').insert({
      organization_id: organizationId,
      restaurant_id: restaurantId,
      product_id: produitId,
      modifier_group_id: groupeId,
      position: 0,
    })
    // `23505` = doublon. Rattacher deux fois n'est pas une faute : c'est un
    // double clic, ou deux onglets. On le traite comme un succès.
    if (error && error.code !== '23505') throw new Error(error.message)
    return 'Groupe rattaché. Les caisses le proposeront à leur prochaine synchronisation.'
  })
}
