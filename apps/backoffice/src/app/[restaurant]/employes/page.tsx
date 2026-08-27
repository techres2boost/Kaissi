/**
 * Employés — rôles, codes PIN, suspensions.
 *
 * Ce que cet écran ne fait PAS : créer un compte d'authentification.
 * `kaissi.users.id` référence `auth.users(id)`, et créer un compte demande
 * l'API d'administration Supabase — donc la clé `service_role`, qui contourne
 * RLS et n'a rien à faire dans une application web. Le chemin honnête est
 * l'invitation depuis Supabase, puis le rattachement ici.
 */

import { formaterPourcentage } from '@kaissi/domain'
import { etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ListeEmployes } from '../../../composants/ListeEmployes.js'

/** Miroir de `remiseMaxBp` du domaine — affiché pour expliquer le rôle. */
const PLAFOND_PAR_ROLE: Record<string, number> = {
  admin: 10000,
  gerant: 10000,
  caissier: 1000,
  serveur: 500,
  cuisine: 0,
}

export default async function PageEmployes({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { session, etablissement } = await etablissementObligatoire(restaurant)
  const supabase = await supabaseServeur()

  const { data, error } = await supabase
    .from('memberships')
    .select('role, revoked_at, permissions, users(id, full_name, email, status, pin_hash)')
    .eq('restaurant_id', restaurant)
    .is('revoked_at', null)

  const employes = (data ?? [])
    .map((ligne) => {
      const u = ligne.users as {
        id: string
        full_name: string
        email: string
        status: string
        pin_hash: string | null
      } | null
      if (!u) return null
      const surcharge = (ligne.permissions as Record<string, unknown> | null)?.['remise_max_bp']
      return {
        id: u.id,
        nom: u.full_name || u.email,
        email: u.email,
        role: ligne.role as string,
        statut: u.status,
        aUnPin: Boolean(u.pin_hash),
        plafondRemise: formaterPourcentage(
          typeof surcharge === 'number' ? surcharge : (PLAFOND_PAR_ROLE[ligne.role as string] ?? 0),
        ),
        // Un gérant n'administre pas un administrateur : la politique RLS le
        // refuse, autant ne pas proposer les boutons.
        administrable: ligne.role !== 'admin' && u.id !== session.utilisateurId,
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

  return (
    <>
      <h1>Employés</h1>
      <p className="sous-titre">
        {etablissement.gestionnaire
          ? 'Rôles et codes PIN. Une modification atteint les tablettes à leur prochaine synchronisation.'
          : `Consultation seule : le rôle « ${etablissement.role} » n’administre pas les employés.`}
      </p>

      {error ? <p className="message erreur">Lecture impossible : {error.message}</p> : null}

      <ListeEmployes
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        employes={employes}
      />

      <section className="carte">
        <h2>Ajouter un employé</h2>
        <p className="indication" style={{ marginTop: 0 }}>
          Un employé est d&apos;abord un compte d&apos;authentification. Le créer demande
          l&apos;API d&apos;administration de Supabase, qui contourne RLS&nbsp;: cette
          application n&apos;y a délibérément pas accès — elle ne détient que la clé
          publique.
        </p>
        <ol className="indication" style={{ paddingLeft: '1.2rem' }}>
          <li>
            Supabase → <strong>Authentication</strong> → <strong>Add user</strong>, avec
            l&apos;e-mail de l&apos;employé.
          </li>
          <li>
            Créer la ligne correspondante dans <code>kaissi.users</code> et son
            appartenance dans <code>kaissi.memberships</code> (rôle et établissement).
          </li>
          <li>Revenir ici pour lui attribuer son code PIN.</li>
        </ol>
        <p className="indication">
          Un serveur en salle n&apos;a pas besoin de se connecter au back-office&nbsp;: son
          compte existe pour porter son identité dans les commandes et son hachage de PIN.
          Ce sont trois identités distinctes — utilisateur, appareil, employé.
        </p>
      </section>
    </>
  )
}
