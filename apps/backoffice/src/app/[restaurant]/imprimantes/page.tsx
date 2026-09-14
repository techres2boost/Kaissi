/**
 * Paramètres → Imprimantes cuisine.
 *
 * ── Ce que l'écran doit dire, et que rien d'autre ne dit ──────────────────
 *
 * Trois choses, dans cet ordre, parce que chacune envoie chercher la panne au
 * mauvais endroit quand elle manque :
 *
 * 1. Dans la version distribuée aujourd'hui, la caisse N'IMPRIME PAS. Le bon
 *    s'affiche à l'écran et la cuisine lit « Préparation ». Une adresse
 *    enregistrée ici est conservée et servira le jour où l'impression sera
 *    allumée — mais annoncer un réglage qui ne fait rien sans le dire, c'est
 *    exactement ce qu'on ne veut pas.
 * 2. Un poste sans catégorie rattachée ne recevra jamais rien, imprimante ou
 *    pas. Le rattachement se fait dans « Catégories » (0025).
 * 3. Le ticket CLIENT n'a pas de poste à lui : il part au premier poste qui
 *    porte une adresse.
 */

import Link from 'next/link'
import { Info } from 'lucide-react'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import {
  GestionImprimantes,
  type PosteImprimante,
} from '../../../composants/GestionImprimantes.js'

export const dynamic = 'force-dynamic'

export default async function PageImprimantes({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const [postesRes, categoriesRes, produitsRes] = await Promise.all([
    /*
     * `position` PUIS `name` — le même ordre que la caisse.
     *
     * Ce n'est pas cosmétique : c'est cet ordre qui désigne le poste où sort
     * le ticket client (le premier qui porte une adresse). Deux tris
     * différents feraient dire à cet écran l'inverse de ce que la caisse
     * fait, et la note du bas serait un mensonge.
     */
    supabase
      .from('stations')
      .select('id, name, position, printer_host, printer_port')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .order('position')
      .order('name'),
    supabase
      .from('categories')
      .select('station_id')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .not('station_id', 'is', null),
    /*
     * Les produits comptent AUSSI, par leur `station_id` de repli. Ne compter
     * que les catégories afficherait « aucun rattachement » sur un poste qui
     * reçoit pourtant des lignes — et le gérant supprimerait une imprimante
     * qui servait.
     */
    supabase
      .from('products')
      .select('station_id')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .not('station_id', 'is', null),
  ])

  const erreur = postesRes.error ?? categoriesRes.error ?? produitsRes.error

  const rattachements = new Map<string, number>()
  for (const ligne of [...(categoriesRes.data ?? []), ...(produitsRes.data ?? [])]) {
    const id = ligne.station_id as string | null
    if (id) rattachements.set(id, (rattachements.get(id) ?? 0) + 1)
  }

  // Le premier poste QUI PORTE UNE ADRESSE, dans l'ordre ci-dessus : c'est
  // celui-là que `EcranPaiement.tsx` choisit pour le ticket client.
  const premierImprimant = (postesRes.data ?? []).find((p) => p.printer_host)?.id ?? null

  const postes: PosteImprimante[] = (postesRes.data ?? []).map((p) => ({
    id: p.id as string,
    nom: p.name as string,
    hote: (p.printer_host as string | null) ?? null,
    port: (p.printer_port as number) ?? 9100,
    rattachements: rattachements.get(p.id as string) ?? 0,
    ticketClient: p.id === premierImprimant,
  }))

  return (
    <>
      <h1>Imprimantes cuisine</h1>
      <p className="sous-titre">
        À quelle adresse réseau chaque poste envoie ses bons. Le poste
        lui-même — son nom, ce qu’il prépare — se règle dans{' '}
        <Link href={{ pathname: `/${restaurant}/categories` }}>Catégories</Link>{' '}
        : c’est la catégorie qui décide du poste, pas l’article.
      </p>

      {/*
        ── La mention la plus importante de l'écran ────────────────────────

        Elle dit que ce réglage ne fait RIEN aujourd'hui. On pourrait s'en
        passer : l'écran aurait l'air plus fini. Mais un gérant qui saisit
        une adresse et n'entend jamais son imprimante chercherait la panne
        dans son réseau, son imprimante et son câble — partout sauf ici.
      */}
      <div className="message info">
        <Info size={16} strokeWidth={2} aria-hidden="true" />{' '}
        <strong>Dans la version actuelle des caisses, rien ne s’imprime.</strong>{' '}
        Le bon de cuisine et le ticket client s’affichent à l’écran de la
        tablette, et la cuisine lit ses commandes dans{' '}
        <Link href={{ pathname: `/${restaurant}/preparation` }}>Préparation</Link>.
        Les adresses saisies ici sont conservées et descendent déjà aux caisses :
        elles serviront telles quelles le jour où l’impression sera activée.
      </div>

      {erreur && <p className="message erreur">Lecture impossible : {erreur.message}</p>}

      {!etablissement.gestionnaire && (
        <p className="sous-titre">
          Consultation seule : le rôle « {etablissement.role} » ne modifie pas
          les imprimantes.
        </p>
      )}

      <GestionImprimantes
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        postes={postes}
      />

      <div className="carte note-imprimantes">
        <h2>Deux réglages à faire côté imprimante</h2>
        <p>
          <strong>Une adresse IP fixe.</strong> Une imprimante en DHCP change
          d’adresse au redémarrage de la box, et les bons cessent d’arriver
          sans qu’aucun message ne le dise. Réservez-lui son adresse dans le
          routeur, ou fixez-la sur l’imprimante.
        </p>
        <p>
          <strong>Le même réseau que les tablettes.</strong> La caisse parle
          directement à l’imprimante, en ESC/POS sur le port {9100} — rien ne
          passe par Internet. Une imprimante sur le Wi-Fi « invités » est
          injoignable, même quand elle répond au téléphone du gérant.
        </p>
      </div>
    </>
  )
}
