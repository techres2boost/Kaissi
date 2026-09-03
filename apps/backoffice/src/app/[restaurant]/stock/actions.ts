'use server'

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie, texteFacultatif } from '../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

/**
 * Lit une quantité de stock.
 *
 * NUMÉRIQUE, jamais un entier : 0,25 kg de farine existe (RÈGLE 1). C'est
 * l'inverse de l'argent, qui est en entiers de millimes — une quantité
 * physique se divise, un dinar non.
 */
function quantite(donnees: FormData, champ: string, libelle: string): number {
  const brut = String(donnees.get(champ) ?? '').trim().replace(',', '.')
  if (brut === '') throw new ErreurSaisie(champ, `${libelle} est obligatoire.`)
  const valeur = Number(brut)
  if (!Number.isFinite(valeur)) {
    throw new ErreurSaisie(champ, `${libelle} doit être un nombre.`)
  }
  return valeur
}

function quantiteFacultative(donnees: FormData, champ: string, libelle: string): number | null {
  const brut = String(donnees.get(champ) ?? '').trim()
  if (brut === '') return null
  const valeur = Number(brut.replace(',', '.'))
  if (!Number.isFinite(valeur) || valeur < 0) {
    throw new ErreurSaisie(champ, `${libelle} doit être un nombre positif, ou vide.`)
  }
  return valeur
}

async function agir(
  restaurantId: string,
  travail: (
    supabase: Awaited<ReturnType<typeof supabaseServeur>>,
    organizationId: string,
    employeId: string | null,
  ) => Promise<string>,
): Promise<Resultat> {
  try {
    const { session, etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const succes = await travail(
      await supabaseServeur(),
      etablissement.organizationId,
      session.employeId,
    )
    revalidatePath(`/${restaurantId}/stock`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Active le suivi de stock d'un produit, ou le désactive.
 *
 * Activer, c'est POSER UN COMPTAGE : une quantité constatée, à maintenant.
 * Les ventes antérieures sont réputées déjà déduites — sans quoi activer le
 * suivi un mardi soustrairait tout l'historique du restaurant d'un coup.
 */
export async function activerSuivi(
  restaurantId: string,
  produitId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase, organizationId) => {
    const qty = quantite(donnees, 'quantite', 'La quantité en stock')
    const seuil = quantiteFacultative(donnees, 'seuil', 'Le seuil d’alerte')

    const { error } = await supabase.from('stock_items').upsert(
      {
        product_id: produitId,
        organization_id: organizationId,
        restaurant_id: restaurantId,
        qty_reference: qty,
        counted_at: new Date().toISOString(),
        min_qty: seuil,
      },
      { onConflict: 'product_id' },
    )
    if (error) throw new Error(error.message)

    // `track_stock` reste le drapeau visible au catalogue : on le garde
    // aligné, sinon le produit apparaîtrait suivi ici et pas là-bas.
    await supabase.from('products').update({ track_stock: true }).eq('id', produitId)
    return 'Stock enregistré. Les ventes à venir le décrémenteront automatiquement.'
  })
}

export async function arreterSuivi(
  restaurantId: string,
  produitId: string,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const { error } = await supabase.from('stock_items').delete().eq('product_id', produitId)
    if (error) throw new Error(error.message)
    await supabase.from('products').update({ track_stock: false }).eq('id', produitId)
    return 'Suivi de stock désactivé pour ce produit.'
  })
}

/**
 * Enregistre un mouvement manuel : réception, perte, correction.
 *
 * Un mouvement s'AJOUTE, il ne remplace pas : l'historique dit pourquoi le
 * stock a bougé. Pour repartir d'un comptage propre après un inventaire,
 * c'est `activerSuivi` qui repose la référence.
 */
export async function enregistrerMouvement(
  restaurantId: string,
  produitId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase, organizationId, employeId) => {
    const delta = quantite(donnees, 'delta', 'La quantité')
    if (delta === 0) {
      throw new ErreurSaisie('delta', 'Un mouvement de zéro ne change rien.')
    }
    const raison = String(donnees.get('raison') ?? 'correction')
    if (!['reception', 'perte', 'correction'].includes(raison)) {
      throw new ErreurSaisie('raison', 'Motif inconnu.')
    }
    // Une perte se saisit en positif et se stocke en négatif : demander à un
    // gérant de taper « −3 » invite à la faute de signe.
    const signe = raison === 'perte' ? -Math.abs(delta) : delta

    const { error } = await supabase.from('stock_movements').insert({
      organization_id: organizationId,
      restaurant_id: restaurantId,
      product_id: produitId,
      qty_delta: signe,
      reason: raison,
      note: texteFacultatif(donnees, 'note'),
      created_by: employeId,
    })
    if (error) throw new Error(error.message)
    return 'Mouvement enregistré.'
  })
}

/**
 * Retire un produit de la carte de la caisse, ou l'y remet.
 *
 * ⚑ C'est le SEUL mécanisme par lequel un produit disparaît du POS pour cause
 * de rupture, et il est délibérément MANUEL.
 *
 * Le stock calculé, lui, ne retire jamais rien tout seul. Hors ligne, la
 * quantité que la tablette connaît peut avoir des heures : la laisser
 * masquer un produit reviendrait à refuser de vendre une pizza qui est en
 * cuisine — le pire des deux mondes (règle du dépôt : « le stock n'est jamais
 * autoritaire hors ligne »). Une décision humaine, elle, est vraie au moment
 * où elle est prise : « on n'a plus de pâte, arrête la Margherita ».
 *
 * Le chemin est celui du catalogue : `products.is_available` est journalisé
 * dans `change_log` (migration 0005), donc toutes les tablettes l'apprennent
 * à leur prochaine synchronisation, sans rien réinstaller.
 */
export async function basculerDisponibilite(
  restaurantId: string,
  produitId: string,
  disponible: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const { error } = await supabase
      .from('products')
      .update({ is_available: disponible })
      .eq('id', produitId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)
    return disponible
      ? 'Produit remis en vente. Les caisses le retrouveront à leur prochaine synchronisation.'
      : 'Produit marqué en rupture. Il disparaîtra des caisses à leur prochaine synchronisation.'
  })
}
