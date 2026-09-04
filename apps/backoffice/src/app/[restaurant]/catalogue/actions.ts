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

/**
 * Renomme une catégorie et lui donne son POSTE de préparation.
 *
 * Le poste est porté ici, et non sur chaque produit (migration 0025) : les
 * boissons vont au bar, les plats à la cuisine, et un produit ajouté demain
 * dans « Boissons » en hérite sans que personne y pense. Réglé une fois par
 * catégorie, il ne peut plus être oublié à la création d'un produit — un
 * oubli qui rendait la ligne invisible sur TOUS les écrans de préparation,
 * et ne se voyait qu'en plein service.
 */
export async function modifierCategorie(
  restaurantId: string,
  categorieId: string,
  stationsAutorisees: readonly string[],
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom de la catégorie', 100)
    const { error } = await supabase
      .from('categories')
      .update({
        name: nom,
        station_id: choixFacultatif(donnees, 'station', 'Le poste', stationsAutorisees),
        updated_at: new Date().toISOString(),
      })
      .eq('id', categorieId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message, error.code))
    return `Catégorie « ${nom} » enregistrée.`
  })
}

/**
 * Déplace une ligne d'un cran dans la grille, en ÉCHANGEANT deux positions.
 *
 * ── Pourquoi des flèches et non un champ « position » ─────────────────────
 *
 * Le formulaire demandait un nombre. Un gérant qui veut mettre « Pizza » en
 * premier doit alors deviner quel entier est libre, et renuméroter tout ce
 * qui suit — un travail d'informaticien pour un geste qui devrait prendre
 * une seconde. Et deux lignes finissaient régulièrement sur le même numéro,
 * où l'ordre devenait celui du hasard.
 *
 * On échange donc les positions des deux voisines. L'ordre reste total, sans
 * trou et sans doublon, quoi qu'on clique.
 */
/**
 * Cherche la voisine et échange les deux positions.
 *
 * Écrit DEUX fois — une pour les catégories, une pour les produits — plutôt
 * qu'une fois avec un nom de table en paramètre. La version générique
 * compilait mal, et pour une bonne raison : `category_id` n'existe pas sur
 * `categories`, et le schéma typé écrit à la main a raison de le refuser.
 * Deux fonctions courtes valent mieux qu'une abstraction qui ment.
 */
async function deplacerLigne(
  supabase: Awaited<ReturnType<typeof supabaseServeur>>,
  restaurantId: string,
  id: string,
  sens: 'haut' | 'bas',
  table: 'categories',
): Promise<string>
async function deplacerLigne(
  supabase: Awaited<ReturnType<typeof supabaseServeur>>,
  restaurantId: string,
  id: string,
  sens: 'haut' | 'bas',
  table: 'products',
): Promise<string>
async function deplacerLigne(
  supabase: Awaited<ReturnType<typeof supabaseServeur>>,
  restaurantId: string,
  id: string,
  sens: 'haut' | 'bas',
  table: 'categories' | 'products',
): Promise<string> {
  const position =
    table === 'categories'
      ? await positionCategorie(supabase, restaurantId, id, sens)
      : await positionProduit(supabase, restaurantId, id, sens)
  if (!position) return 'Déjà à cette extrémité.'

  const maintenant = new Date().toISOString()
  // Les deux écritures, dans l'ordre. Un échec entre les deux laisserait
  // deux lignes sur la même position : l'ordre deviendrait celui du hasard,
  // sans rien casser d'autre. Un clic de plus le répare.
  for (const [cible, valeur] of [
    [id, position.voisinePosition],
    [position.voisineId, position.courantePosition],
  ] as const) {
    const { error } =
      table === 'categories'
        ? await supabase
            .from('categories')
            .update({ position: valeur, updated_at: maintenant })
            .eq('id', cible)
            .eq('restaurant_id', restaurantId)
        : await supabase
            .from('products')
            .update({ position: valeur, updated_at: maintenant })
            .eq('id', cible)
            .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message, error.code))
  }
  return sens === 'haut' ? 'Déplacé vers le haut.' : 'Déplacé vers le bas.'
}

interface Voisine {
  courantePosition: number
  voisineId: string
  voisinePosition: number
}

async function positionCategorie(
  supabase: Awaited<ReturnType<typeof supabaseServeur>>,
  restaurantId: string,
  id: string,
  sens: 'haut' | 'bas',
): Promise<Voisine | null> {
  const { data: courante, error } = await supabase
    .from('categories')
    .select('position')
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(messageBase(error.message, error.code))
  if (!courante) throw new Error('Catégorie introuvable — rechargez la page.')

  const base = supabase
    .from('categories')
    .select('id, position')
    .eq('restaurant_id', restaurantId)
    .is('archived_at', null)

  const { data: voisine, error: e2 } =
    sens === 'haut'
      ? await base
          .lt('position', courante.position)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle()
      : await base
          .gt('position', courante.position)
          .order('position', { ascending: true })
          .limit(1)
          .maybeSingle()
  if (e2) throw new Error(messageBase(e2.message, e2.code))
  if (!voisine) return null
  return {
    courantePosition: courante.position,
    voisineId: voisine.id,
    voisinePosition: voisine.position,
  }
}

async function positionProduit(
  supabase: Awaited<ReturnType<typeof supabaseServeur>>,
  restaurantId: string,
  id: string,
  sens: 'haut' | 'bas',
): Promise<Voisine | null> {
  const { data: courant, error } = await supabase
    .from('products')
    .select('position, category_id')
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(messageBase(error.message, error.code))
  if (!courant) throw new Error('Produit introuvable — rechargez la page.')

  // Un produit s'ordonne DANS sa catégorie : échanger avec un produit d'une
  // autre catégorie mélangerait deux grilles sans que rien ne le signale.
  const base = supabase
    .from('products')
    .select('id, position')
    .eq('restaurant_id', restaurantId)
    .is('archived_at', null)
  const memeCategorie =
    courant.category_id === null
      ? base.is('category_id', null)
      : base.eq('category_id', courant.category_id)

  const { data: voisin, error: e2 } =
    sens === 'haut'
      ? await memeCategorie
          .lt('position', courant.position)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle()
      : await memeCategorie
          .gt('position', courant.position)
          .order('position', { ascending: true })
          .limit(1)
          .maybeSingle()
  if (e2) throw new Error(messageBase(e2.message, e2.code))
  if (!voisin) return null
  return {
    courantePosition: courant.position,
    voisineId: voisin.id,
    voisinePosition: voisin.position,
  }
}

export async function deplacerCategorie(
  restaurantId: string,
  categorieId: string,
  sens: 'haut' | 'bas',
): Promise<Resultat> {
  return agir(restaurantId, ({ supabase }) =>
    deplacerLigne(supabase, restaurantId, categorieId, sens, 'categories'),
  )
}

export async function deplacerProduit(
  restaurantId: string,
  produitId: string,
  sens: 'haut' | 'bas',
): Promise<Resultat> {
  return agir(restaurantId, ({ supabase }) =>
    deplacerLigne(supabase, restaurantId, produitId, sens, 'products'),
  )
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

/**
 * Lit le coût d'achat unitaire, facultatif.
 *
 * Il ne passe PAS par `montantMillimes` : ce dernier rend un entier, or le
 * coût est la seule exception au tout-entier du dépôt — `numeric(18,6)` en
 * base, parce que le coût d'un gramme de mozzarella vaut moins qu'un millime.
 * On conserve donc les décimales, et l'arrondi n'a lieu qu'au total, dans
 * les rapports.
 */
function coutFacultatif(donnees: FormData, champ: string): number | null {
  const brut = String(donnees.get(champ) ?? '').trim().replace(',', '.')
  if (brut === '') return null
  const valeur = Number(brut)
  if (!Number.isFinite(valeur) || valeur < 0) {
    throw new ErreurSaisie(champ, "Le coût d'achat doit être un nombre positif, ou vide.")
  }
  // Saisi en DINARS comme le prix, stocké en millimes : « 10 » → 10000.
  // Arrondi à la 6e décimale — la précision de la colonne — pour ne pas
  // stocker le bruit du flottant : 0,1 × 1000 vaut 100,00000000000001.
  return Math.round(valeur * 1000 * 1e6) / 1e6
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
      /*
       * Le coût d'achat, dans la MÊME unité que le prix : des millimes.
       * `null` quand il n'est pas saisi — et c'est un état distinct de
       * « coût nul » : les rapports comptent les lignes sans coût pour dire
       * que la marge est surestimée, au lieu de l'afficher à 100 %.
       */
      cost_per_unit: coutFacultatif(donnees, 'cout'),
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

/**
 * Sort une catégorie ou un produit de l'archive.
 *
 * Archiver n'est pas supprimer — l'historique des ventes garde la référence —
 * mais c'était jusqu'ici sans retour : une catégorie archivée par erreur ne
 * pouvait plus être remise, et il fallait la recréer, avec un nouvel
 * identifiant, donc en coupant l'historique en deux.
 *
 * Un produit désarchivé revient VOLONTAIREMENT hors vente : le remettre à
 * la carte est une seconde décision, et il a peut-être été archivé parce
 * qu'on ne le sert plus.
 */
export async function desarchiverCategorie(
  restaurantId: string,
  categorieId: string,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('categories')
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .eq('id', categorieId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message, error.code))
    return 'Catégorie remise.'
  })
}

export async function desarchiverProduit(
  restaurantId: string,
  produitId: string,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('products')
      .update({ archived_at: null, is_available: false, updated_at: new Date().toISOString() })
      .eq('id', produitId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(messageBase(error.message, error.code))
    return 'Produit remis, hors vente. Remettez-le à la carte quand il est disponible.'
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
