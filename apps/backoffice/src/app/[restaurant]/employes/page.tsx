/**
 * Employés — embauche, rôles, codes PIN, suspensions.
 *
 * Un employé n'est PAS un compte de connexion. Un serveur en salle tape un PIN
 * sur une tablette et n'ouvre jamais le back-office ; lui imposer un mot de
 * passe n'aurait servi qu'à satisfaire une clé étrangère. La migration 0017 a
 * séparé les deux, ce qui rend l'embauche possible ici — sans la clé
 * d'administration de Supabase, que cette application n'a délibérément pas.
 *
 * Donner un ACCÈS AU BACK-OFFICE à quelqu'un reste une opération distincte, et
 * réservée à un administrateur.
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
        administrable: ligne.role !== 'admin' && u.id !== session.employeId,
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

    </>
  )
}
