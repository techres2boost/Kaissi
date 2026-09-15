/**
 * Articles → Modificateurs.
 *
 * Les trois tables existent depuis la migration 0003, avec RLS ; la caisse
 * sait les lire et les appliquer. Il ne manquait que l'écran — et, surtout,
 * la DESCENTE du lien article ↔ groupe, que la migration 0037 vient de poser.
 */

import Link from 'next/link'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import {
  GestionModificateurs,
  type ArticleSimple,
  type GroupeModificateurs,
} from '../../../composants/GestionModificateurs.js'

export const dynamic = 'force-dynamic'

export default async function PageModificateurs({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const [groupesRes, choixRes, liensRes, produitsRes, categoriesRes] = await Promise.all([
    supabase
      .from('modifier_groups')
      .select('id, name, min_select, max_select, archived_at')
      .eq('restaurant_id', restaurant)
      .order('position'),
    supabase
      .from('modifiers')
      .select('id, modifier_group_id, name, price_delta_millimes, archived_at')
      .eq('restaurant_id', restaurant)
      .order('position'),
    supabase
      .from('product_modifiers')
      .select('product_id, modifier_group_id')
      .eq('restaurant_id', restaurant),
    supabase
      .from('products')
      .select('id, name, category_id')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .order('position'),
    supabase
      .from('categories')
      .select('id, name')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null),
  ])

  const erreur =
    groupesRes.error ?? choixRes.error ?? liensRes.error ?? produitsRes.error ?? categoriesRes.error

  const nomCategorie = new Map(
    (categoriesRes.data ?? []).map((c) => [c.id as string, c.name as string]),
  )

  const articles: ArticleSimple[] = (produitsRes.data ?? []).map((p) => ({
    id: p.id as string,
    nom: p.name as string,
    categorieNom: nomCategorie.get((p.category_id as string | null) ?? '') ?? 'Sans catégorie',
  }))

  /*
   * Les liens, regroupés PAR GROUPE — le sens dans lequel l'écran les lit.
   *
   * La table les porte par couple ; l'écran demande « quels articles portent
   * ce groupe ». Les retourner ici évite de balayer toute la liste pour
   * chaque case à cocher, sur un restaurant à quarante plats et huit groupes.
   */
  const produitsParGroupe = new Map<string, string[]>()
  for (const l of liensRes.data ?? []) {
    const g = l.modifier_group_id as string
    const liste = produitsParGroupe.get(g) ?? []
    liste.push(l.product_id as string)
    produitsParGroupe.set(g, liste)
  }

  const choixParGroupe = new Map<string, GroupeModificateurs['choix']>()
  for (const c of choixRes.data ?? []) {
    const g = c.modifier_group_id as string
    const liste = choixParGroupe.get(g) ?? []
    liste.push({
      id: c.id as string,
      nom: c.name as string,
      deltaMillimes: Number(c.price_delta_millimes) || 0,
      archive: c.archived_at !== null,
    })
    choixParGroupe.set(g, liste)
  }

  const groupes: GroupeModificateurs[] = (groupesRes.data ?? []).map((g) => ({
    id: g.id as string,
    nom: g.name as string,
    minSelect: (g.min_select as number) ?? 0,
    maxSelect: (g.max_select as number) ?? 0,
    archive: g.archived_at !== null,
    choix: choixParGroupe.get(g.id as string) ?? [],
    produits: produitsParGroupe.get(g.id as string) ?? [],
  }))

  return (
    <>
      <h1>Modificateurs</h1>
      <p className="sous-titre">
        Les choix qu’on propose au caissier quand il touche un article :
        la cuisson d’une viande, les suppléments d’une pizza. Ils s’ajoutent au
        prix de la ligne et figurent sur le{' '}
        <Link href={{ pathname: `/${restaurant}/preparation` }}>bon de préparation</Link>.
      </p>

      {erreur && <p className="message erreur">Lecture impossible : {erreur.message}</p>}

      {!etablissement.gestionnaire && (
        <p className="sous-titre">
          Consultation seule : le rôle « {etablissement.role} » ne modifie pas la
          carte.
        </p>
      )}

      {articles.length === 0 && (
        <div className="message avertissement">
          <strong>Aucun article.</strong> Un modificateur se rattache à des
          articles — créez-en d’abord dans{' '}
          <Link href={{ pathname: `/${restaurant}/catalogue` }}>Liste d’articles</Link>.
        </div>
      )}

      <GestionModificateurs
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        groupes={groupes}
        articles={articles}
      />
    </>
  )
}
