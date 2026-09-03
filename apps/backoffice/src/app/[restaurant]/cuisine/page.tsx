/**
 * Écran de cuisine — « commandes à préparer ».
 *
 * Il remplace le bon de cuisine papier tant que l'impression est éteinte.
 * Ce qu'il montre vient de la synchronisation : le POS écrit `order.sent`,
 * l'API de sync le projette dans `orders` (statut « envoyee ») et
 * `order_items`, et cette page les lit sous RLS.
 *
 * Conséquence à assumer, et écrite à l'écran : cette page a besoin du
 * RÉSEAU. Le POS, lui, encaisse hors ligne — c'est lui qui porte la garantie
 * du produit. Si la cuisine perd Internet, elle perd l'affichage, pas les
 * commandes : elles réapparaissent au retour du réseau, et le serveur en
 * salle peut toujours annoncer les plats de vive voix.
 *
 * Aucun montant n'est affiché : la cuisine prépare, elle n'encaisse pas.
 */

import { etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { TableauCuisine, type CommandeCuisine } from '../../../composants/TableauCuisine.js'

/**
 * Jamais de rendu mis en cache : une cuisine qui regarde une page figée
 * laisse des plats sortir en retard. `force-dynamic` + `revalidate = 0`
 * disent la même chose à deux couches différentes de Next.js.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Au-delà, ce n'est plus un écran de cuisine mais un rapport. */
const PLAFOND = 60

export default async function PageCuisine({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<{ poste?: string }>
}) {
  const { restaurant } = await params
  const { poste } = await searchParams
  await etablissementObligatoire(restaurant)
  const supabase = await supabaseServeur()

  const { data: commandes, error } = await supabase
    .from('orders')
    .select('id, table_id, type, ticket_number, covers, opened_at, sent_at')
    .eq('restaurant_id', restaurant)
    .eq('status', 'envoyee')
    // Les plus ANCIENNES d'abord : une cuisine sert dans l'ordre d'arrivée.
    .order('sent_at', { ascending: true, nullsFirst: true })
    .limit(PLAFOND)

  if (error) {
    return (
      <section className="bloc">
        <h1>Cuisine</h1>
        <p className="message erreur">Impossible de lire les commandes : {error.message}</p>
      </section>
    )
  }

  const ids = (commandes ?? []).map((c) => c.id)

  // Trois lectures parallèles plutôt qu'une jointure imbriquée : PostgREST
  // sait le faire, mais la requête imbriquée devient illisible dès qu'on y
  // ajoute un filtre, et le gain est nul à soixante lignes.
  const [lignes, tables, postes, pretes] = await Promise.all([
    ids.length === 0
      ? { data: [] }
      : supabase
          .from('order_items')
          .select(
            'id, order_id, designation, qty, modifiers, note, position, voided_at, station_id',
          )
          .in('order_id', ids)
          .is('voided_at', null)
          .order('position', { ascending: true }),
    supabase
      .from('tables')
      .select('id, label')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null),
    supabase
      .from('stations')
      .select('id, name')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .order('name', { ascending: true }),
    ids.length === 0
      ? { data: [] }
      : supabase.from('kitchen_ready').select('order_id, ready_at').in('order_id', ids),
  ])

  const libelleTable = new Map((tables.data ?? []).map((t) => [t.id, t.label]))
  // Les postes de préparation : le POS émet DÉJÀ un bon par poste (Cuisine,
  // Bar). Sans ce filtre ici, le barman lisait les pizzas et le cuisinier
  // les cafés — les deux faisaient le tri à l'œil sur le même écran.
  const listePostes = (postes.data ?? []).map((s) => ({ id: s.id, nom: s.name }))
  const posteActif = listePostes.some((s) => s.id === poste) ? (poste as string) : null
  const preteA = new Map((pretes.data ?? []).map((p) => [p.order_id, p.ready_at]))

  const parCommande = new Map<string, CommandeCuisine['lignes'][number][]>()
  for (const l of lignes.data ?? []) {
    if (posteActif && l.station_id !== posteActif) continue
    const liste = parCommande.get(l.order_id) ?? []
    liste.push({
      id: l.id,
      designation: l.designation,
      quantite: l.qty,
      // Les modificateurs sont du JSON écrit par le POS : on ne garde que le
      // nom, et on tolère une forme inattendue plutôt que de casser l'écran.
      options: (Array.isArray(l.modifiers) ? l.modifiers : [])
        .map((m) => (typeof m?.nom === 'string' ? m.nom : null))
        .filter((m): m is string => m !== null),
      note: l.note,
    })
    parCommande.set(l.order_id, liste)
  }

  const aPreparer: CommandeCuisine[] = (commandes ?? [])
    // Filtré sur un poste : une commande dont aucune ligne ne le concerne
    // n'a rien à faire sur cet écran.
    .filter((c) => !posteActif || (parCommande.get(c.id)?.length ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      numero: c.ticket_number,
      table: c.table_id ? (libelleTable.get(c.table_id) ?? null) : null,
      type: c.type,
      couverts: c.covers,
      envoyeeA: c.sent_at ?? c.opened_at,
      preteA: preteA.get(c.id) ?? null,
      lignes: parCommande.get(c.id) ?? [],
    }))

  return (
    <TableauCuisine
      restaurantId={restaurant}
      commandes={aPreparer}
      plafond={PLAFOND}
      postes={listePostes}
      posteActif={posteActif}
    />
  )
}
