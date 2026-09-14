'use server'

/**
 * Paramètres → Taxes.
 *
 * ── Pourquoi cet écran existe MAINTENANT ──────────────────────────────────
 *
 * Un restaurant ouvert depuis la tablette (`POST /inscription`) reçoit un taux
 * à ZÉRO, nommé « À régler ». C'est délibéré : le serveur refuse d'écrire
 * « TVA 19 % » dans son code, ce serait affirmer une règle fiscale tunisienne.
 * Mais il n'existait alors AUCUN endroit pour le corriger — le gérant se
 * retrouvait avec une caisse qui facture sans taxe et rien pour y remédier.
 *
 * ── Ce qui rend cet écran sûr, et ce qui reste à la charge du gérant ──────
 *
 * Sûr : les taux descendent aux caisses par `change_log`, comme un changement
 * de prix. Aucune voie de synchronisation nouvelle, et les ventes DÉJÀ
 * encaissées ne bougent pas — elles portent leur ventilation, figée au moment
 * de la vente.
 *
 * ⚠ À la charge du gérant, et de son comptable : le TAUX lui-même. Ce dépôt
 *   n'affirme aucune règle fiscale — ni la valeur, ni le fait qu'elle
 *   s'applique à la restauration, ni le traitement du droit de timbre. Voir
 *   CLAUDE.md, « Points à valider avec un expert-comptable tunisien ».
 *
 * ── Pourquoi on ARCHIVE au lieu de supprimer ──────────────────────────────
 *
 * Chaque produit pointe son taux, et chaque vente passée porte la
 * ventilation calculée avec. Supprimer une ligne casserait les produits qui
 * s'y rattachent, pour gagner une ligne dans une liste.
 */

import { revalidatePath } from 'next/cache'
import { uuidV7 } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie, texteObligatoire } from '../../../serveur/formulaire.js'

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
    revalidatePath(`/${restaurantId}/taxes`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Lit un taux saisi en clair (« 19 », « 13,5 ») en POINTS DE BASE entiers.
 *
 * RÈGLE 1 : 19 % = 1900, jamais 0.19. Un flottant traînerait ensuite dans
 * tous les calculs de TVA, et l'écart ne se verrait qu'après des mois.
 *
 * Deux décimales au plus : au-delà, l'arrondi à l'entier de points de base
 * perdrait silencieusement ce que la personne vient de taper. Mieux vaut le
 * refuser que le tronquer sans le dire.
 */
function tauxEnPointsDeBase(donnees: FormData, champ: string): number {
  const brut = String(donnees.get(champ) ?? '').trim().replace(',', '.')
  if (brut === '') throw new ErreurSaisie(champ, 'Le taux est obligatoire.')
  const valeur = Number(brut)
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) {
    throw new ErreurSaisie(champ, 'Le taux doit être compris entre 0 et 100.')
  }
  const bp = valeur * 100
  if (!Number.isInteger(Math.round(bp * 1000) / 1000) || Math.abs(bp - Math.round(bp)) > 1e-9) {
    throw new ErreurSaisie(
      champ,
      'Le taux ne peut pas avoir plus de deux décimales — 19 ou 13,5, pas 13,567.',
    )
  }
  return Math.round(bp)
}

export async function creerTaux(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du taux', 60)
    const tauxBp = tauxEnPointsDeBase(donnees, 'taux')
    const incluse = donnees.get('incluse') === 'oui'

    const { error } = await supabase.from('tax_rates').insert({
      // RÈGLE 2 : l'identifiant vient du client, jamais d'un « serial ».
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      name: nom,
      rate_bp: tauxBp,
      is_included: incluse,
      // Jamais par défaut à la création : ce serait déplacer le taux de tous
      // les futurs produits en croyant n'en ajouter qu'un. Le geste est à
      // part, et il est explicite.
      is_default: false,
    })
    if (error) throw new Error(error.message)
    return (
      `Taux « ${nom} » créé. Les caisses l’auront à leur prochaine ` +
      'synchronisation ; les ventes déjà encaissées gardent la leur.'
    )
  })
}

export async function modifierTaux(
  restaurantId: string,
  tauxId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom du taux', 60)
    const tauxBp = tauxEnPointsDeBase(donnees, 'taux')
    const incluse = donnees.get('incluse') === 'oui'

    const { error } = await supabase
      .from('tax_rates')
      .update({ name: nom, rate_bp: tauxBp, is_included: incluse })
      .eq('id', tauxId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return (
      `Taux « ${nom} » mis à jour. Il s’applique aux ventes À VENIR : celles ` +
      'déjà encaissées portent la ventilation calculée au moment de la vente, ' +
      'et un rapport qui changerait en modifiant un réglage ne serait plus un historique.'
    )
  })
}

/**
 * Le taux par DÉFAUT — celui qu'un nouvel article reçoit.
 *
 * Un seul à la fois : on retire l'ancien dans la foulée. La base ne l'impose
 * pas (aucun index partiel sur `is_default`), donc c'est ici que la règle
 * tient — et deux taux par défaut rendraient le choix d'un nouvel article
 * imprévisible.
 */
export async function definirParDefaut(
  restaurantId: string,
  tauxId: string,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const retrait = await supabase
      .from('tax_rates')
      .update({ is_default: false })
      .eq('restaurant_id', restaurantId)
      .eq('is_default', true)
    if (retrait.error) throw new Error(retrait.error.message)

    const { error } = await supabase
      .from('tax_rates')
      .update({ is_default: true })
      .eq('id', tauxId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return 'Taux par défaut changé. Les articles EXISTANTS gardent le leur.'
  })
}

export async function archiverTaux(
  restaurantId: string,
  tauxId: string,
  archiver: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    if (archiver) {
      /*
       * On REFUSE d'archiver un taux encore utilisé, et on dit par combien
       * d'articles. Sans ce contrôle, la caisse recevrait un catalogue dont
       * des produits pointent un taux qu'elle n'a plus : elle ne saurait plus
       * calculer leur TVA, et cela ne se verrait qu'à la première vente.
       */
      const { count, error } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('tax_rate_id', tauxId)
        .is('archived_at', null)
      if (error) throw new Error(error.message)
      if ((count ?? 0) > 0) {
        throw new ErreurSaisie(
          'taux',
          `${count} article(s) utilisent encore ce taux. Changez-le sur ces ` +
            'articles avant de l’archiver — sinon la caisse ne saurait plus calculer leur taxe.',
        )
      }
    }

    const { error } = await supabase
      .from('tax_rates')
      .update({ archived_at: archiver ? new Date().toISOString() : null })
      .eq('id', tauxId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return archiver
      ? 'Taux archivé. Les ventes passées gardent leur ventilation.'
      : 'Taux remis en service.'
  })
}
