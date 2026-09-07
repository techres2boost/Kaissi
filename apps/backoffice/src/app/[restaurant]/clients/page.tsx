/**
 * « Clients » — le carnet d'adresses de l'établissement.
 *
 * ── Ce que cet écran répond ───────────────────────────────────────────────
 *
 * « C'est qui, ce numéro ? », « il est déjà venu ? », « combien il dépense ? ».
 * Trois questions de service, pas de marketing : on ouvre cet écran le
 * téléphone à la main, pendant qu'un client attend au bout du fil.
 *
 * ── Les visites sont CALCULÉES ────────────────────────────────────────────
 *
 * Première visite, dernière visite, nombre de visites, total dépensé : une
 * vue sur `orders` (migration 0031), jamais des compteurs. Un compteur
 * incrémenté par déclencheur devrait défaire exactement ce qu'il a fait à
 * chaque reprojection — y compris quand une commande passe « annulée » — et
 * dériverait en silence.
 *
 * ── Pourquoi la recherche est côté SERVEUR ────────────────────────────────
 *
 * Parce qu'un carnet de restaurant fait deux mille fiches au bout d'un an.
 * Les charger toutes pour filtrer dans le navigateur marche très bien en
 * démonstration, et rend l'écran inutilisable chez le premier client qui
 * l'utilise vraiment.
 */

import { formaterTND, millimes } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { chargerFiche } from '../../../serveur/ventes.js'
import { ListeClients, type ClientAffiche } from '../../../composants/ListeClients.js'

export const dynamic = 'force-dynamic'

/** Les tailles de page de Loyverse — c'est le vocabulaire que le marché connaît. */
const TAILLES = [10, 25, 50, 100]

export default async function PageClients({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { restaurant } = await params
  const recherche = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const q = (recherche['q'] ?? '').trim()
  const archives = recherche['archives'] === '1'
  const taille = TAILLES.includes(Number(recherche['taille']))
    ? Number(recherche['taille'])
    : 10
  const page = Math.max(1, Number(recherche['page']) || 1)

  let requete = supabase
    .from('customers')
    .select('id, name, phone, email, note, archived_at, created_at', { count: 'exact' })
    .eq('restaurant_id', restaurant)

  requete = archives ? requete.not('archived_at', 'is', null) : requete.is('archived_at', null)

  if (q !== '') {
    /*
     * Trois colonnes, une seule requête.
     *
     * Le gérant tape ce qu'il a sous la main — un prénom, la fin d'un numéro,
     * un e-mail. Lui demander DANS QUELLE colonne chercher, c'est lui
     * demander de savoir comment on a rangé.
     *
     * Le motif est échappé : `%`, `_` et `,` ont un sens dans un filtre
     * PostgREST, et un client nommé « 100 % Halal » ferait sinon une requête
     * que personne n'a écrite.
     */
    const motif = q.replace(/[%_,()\\]/g, ' ')
    requete = requete.or(`name.ilike.%${motif}%,phone.ilike.%${motif}%,email.ilike.%${motif}%`)
  }

  const debut = (page - 1) * taille
  const { data, error, count } = await requete
    .order('name')
    .range(debut, debut + taille - 1)

  const fiches = data ?? []

  /*
   * Les visites, en UNE requête pour la page affichée.
   *
   * Une par ligne serait dix allers-retours pour dix clients — et cent pour
   * une page de cent. La vue est filtrée sur les identifiants qu'on montre :
   * charger les visites de tout le carnet pour n'en afficher dix est le même
   * gâchis, dans l'autre sens.
   */
  const { data: visites } = fiches.length
    ? await supabase
        .from('clients_visites')
        .select('customer_id, premiere_visite, derniere_visite, visites, depense_millimes')
        .eq('restaurant_id', restaurant)
        .in('customer_id', fiches.map((c) => c.id))
    : { data: [] }

  const parClient = new Map((visites ?? []).map((v) => [v.customer_id, v]))
  const fiche = await chargerFiche(restaurant)
  const zone = fiche.timezone

  const jour = (valeur: string | null) =>
    valeur === null
      ? '—'
      : new Date(valeur).toLocaleDateString('fr-FR', { timeZone: zone })

  const clients: ClientAffiche[] = fiches.map((c) => {
    const v = parClient.get(c.id)
    return {
      id: c.id,
      nom: c.name,
      telephone: c.phone ?? '',
      email: c.email ?? '',
      note: c.note ?? '',
      archive: c.archived_at !== null,
      premiereVisite: jour(v?.premiere_visite ?? null),
      derniereVisite: jour(v?.derniere_visite ?? null),
      visites: Number(v?.visites ?? 0),
      depense: formaterTND(millimes(Number(v?.depense_millimes ?? 0))),
      depenseMillimes: Number(v?.depense_millimes ?? 0),
    }
  })

  const total = count ?? 0

  return (
    <>
      <h1>Clients</h1>
      <p className="sous-titre">
        Qui vient au restaurant. Les visites et le total dépensé se{' '}
        <strong>calculent</strong> sur les ventes encaissées — rien n’est saisi à
        la main, rien ne peut donc dériver.
      </p>

      {error && <p className="message erreur">Lecture impossible : {error.message}</p>}

      <ListeClients
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        clients={clients}
        total={total}
        page={page}
        taille={taille}
        tailles={TAILLES}
        recherche={q}
        archives={archives}
      />
    </>
  )
}
