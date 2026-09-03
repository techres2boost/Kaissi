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
 * Réaligne la carte sur le stock, pour les produits touchés.
 *
 * Tout geste qui change une quantité doit passer par ici : sans cela, un
 * produit resterait hors carte après la réception qui le remet en stock, et
 * il faudrait attendre la prochaine vente pour que le service de
 * synchronisation s'en aperçoive.
 *
 * Un échec ne fait JAMAIS échouer le geste de gestion : le mouvement est
 * enregistré, c'est l'essentiel ; l'alignement se rattrapera à la vente
 * suivante.
 */
async function realignerCarte(
  supabase: Awaited<ReturnType<typeof supabaseServeur>>,
  restaurantId: string,
  produitId: string,
): Promise<void> {
  const { error } = await supabase.rpc('appliquer_rupture_auto', {
    p_restaurant: restaurantId,
    p_produits: [produitId],
  })
  if (error) console.warn('[stock] rupture automatique non appliquée :', error.message)
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
    await realignerCarte(supabase, restaurantId, produitId)
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
    // Le suivi s'arrête : la rupture automatique n'a plus de base pour
    // maintenir ce produit hors carte, donc on l'y remet — sauf si le gérant
    // l'avait retiré à la main, décision qui lui appartient.
    await supabase
      .from('products')
      .update({ track_stock: false, is_available: true, unavailable_reason: null })
      .eq('id', produitId)
      .eq('unavailable_reason', 'stock')
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
    await realignerCarte(supabase, restaurantId, produitId)
    return 'Mouvement enregistré.'
  })
}

/**
 * Retire un produit de la carte de la caisse, ou l'y remet — À LA MAIN.
 *
 * Depuis la migration 0023, le serveur retire déjà tout seul un produit dont
 * le stock suivi tombe à zéro. Ce geste-ci reste nécessaire pour tout ce que
 * le stock ne sait pas : « la machine à café est en panne », « on ne fait plus
 * de brik ce soir », un produit qu'on ne compte pas.
 *
 * Une décision manuelle est MARQUÉE comme telle (`unavailable_reason`), et
 * l'automatisme ne la défait jamais : sans cette distinction, une réception
 * remettrait en vente un produit que le gérant avait délibérément arrêté.
 *
 * Le chemin reste celui du catalogue : `products.is_available` est journalisé
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
      .update({
        is_available: disponible,
        unavailable_reason: disponible ? null : 'manuel',
      })
      .eq('id', produitId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)

    if (!disponible) {
      return 'Produit marqué en rupture. Il disparaîtra des caisses à leur prochaine synchronisation.'
    }

    // Remettre en vente un produit dont le stock est à zéro est légitime — un
    // réassort peut être arrivé sans avoir été saisi — mais il faut le dire :
    // la rupture automatique le retirera de nouveau à la prochaine vente.
    const { data } = await supabase
      .from('stock_actuel')
      .select('qty_on_hand')
      .eq('product_id', produitId)
      .maybeSingle()
    const { data: suivi } = await supabase
      .from('stock_items')
      .select('auto_rupture')
      .eq('product_id', produitId)
      .maybeSingle()

    if (data && Number(data.qty_on_hand) <= 0 && suivi?.auto_rupture) {
      return (
        'Produit remis en vente — mais son stock est à ' +
        `${Number(data.qty_on_hand)} : il repassera en rupture à la prochaine vente. ` +
        'Saisissez la réception, ou décochez « Rupture auto » pour le garder en vente.'
      )
    }
    return 'Produit remis en vente. Les caisses le retrouveront à leur prochaine synchronisation.'
  })
}

/**
 * Active ou coupe la rupture automatique pour un produit.
 *
 * La couper est un choix assumé : « je compte ce produit pour savoir où j'en
 * suis, mais je ne veux pas qu'une erreur d'inventaire le fasse disparaître
 * de la carte en plein service ». C'est notamment le bon réglage pour un plat
 * dont on suit les ingrédients de loin.
 */
export async function basculerRuptureAuto(
  restaurantId: string,
  produitId: string,
  actif: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const { error } = await supabase
      .from('stock_items')
      .update({ auto_rupture: actif })
      .eq('product_id', produitId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)

    if (actif) {
      await realignerCarte(supabase, restaurantId, produitId)
      return 'Rupture automatique activée : le produit sortira de la carte à zéro.'
    }
    // Couper l'automatisme remet en vente ce que l'automatisme avait retiré —
    // et lui seul : un arrêt manuel reste un arrêt.
    await supabase
      .from('products')
      .update({ is_available: true, unavailable_reason: null })
      .eq('id', produitId)
      .eq('restaurant_id', restaurantId)
      .eq('unavailable_reason', 'stock')
    return 'Rupture automatique coupée : ce produit reste vendable même à zéro.'
  })
}
