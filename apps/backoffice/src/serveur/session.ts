/**
 * Qui est connecté, et sur quel établissement a-t-il le droit d'agir.
 *
 * Ce module ne SÉCURISE rien — c'est RLS qui sécurise. Il sert à donner des
 * messages compréhensibles et à ne pas afficher des boutons qui échoueraient.
 * Un gérant qui voit « Modifier » puis reçoit une erreur PostgreSQL opaque
 * conclura que le logiciel est cassé.
 *
 * La distinction compte : si ce fichier était la seule protection, un oubli
 * ici ouvrirait les données d'un autre restaurant. Avec RLS derrière, un
 * oubli ici ne rend rien du tout.
 */

import { redirect } from 'next/navigation'
import { supabaseServeur } from './supabase.js'

export type RoleMembre = 'admin' | 'gerant' | 'caissier' | 'serveur' | 'cuisine'

export interface Etablissement {
  id: string
  organizationId: string
  nom: string
  role: RoleMembre
  /** Vrai si ce membre peut modifier le référentiel — miroir de est_gestionnaire(). */
  gestionnaire: boolean
}

export interface SessionBackoffice {
  /** Identifiant du COMPTE Supabase Auth. */
  compteId: string
  /**
   * Identifiant de l'EMPLOYÉ correspondant.
   *
   * Les deux étaient le même jusqu'à la migration 0017, qui les a séparés
   * pour qu'un serveur en salle puisse exister sans mot de passe. Les
   * confondre ferait comparer une commande (`orders.opened_by`, un employé)
   * à un identifiant de compte : jamais égal, sans erreur visible.
   */
  employeId: string | null
  email: string
  nom: string
  etablissements: Etablissement[]
}

const ROLES_GESTIONNAIRES: readonly RoleMembre[] = ['admin', 'gerant']

/**
 * La session, ou une redirection vers la connexion.
 *
 * `getUser()` et non `getSession()` : le second lit le cookie sans le
 * revalider auprès de Supabase. Sur un rendu serveur, cela reviendrait à
 * faire confiance à un cookie que l'on n'a pas vérifié.
 */
export async function sessionObligatoire(): Promise<SessionBackoffice> {
  const supabase = await supabaseServeur()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/connexion')

  // L'employé lié à ce compte. RLS ne rend que les lignes visibles, donc au
  // pire ce select est vide — jamais celui d'un autre.
  const { data: moi } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  const { data, error } = await supabase
    .from('memberships')
    .select('role, organization_id, restaurant_id, restaurants(name)')
    .is('revoked_at', null)

  if (error) {
    throw new Error(
      `Impossible de lire vos établissements : ${error.message}\n` +
        "Si le message parle de schéma, c'est que « kaissi » n'est pas exposé " +
        "à l'API REST — voir supabase/migrations/0012_exposition_postgrest.sql.",
    )
  }

  const etablissements: Etablissement[] = (data ?? []).map((ligne) => {
    const role = ligne.role as RoleMembre
    const restaurant = ligne.restaurants as { name: string } | { name: string }[] | null
    const nom = Array.isArray(restaurant) ? restaurant[0]?.name : restaurant?.name
    return {
      id: ligne.restaurant_id as string,
      organizationId: ligne.organization_id as string,
      nom: nom ?? 'Établissement',
      role,
      gestionnaire: ROLES_GESTIONNAIRES.includes(role),
    }
  })

  return {
    compteId: user.id,
    employeId: (moi?.id as string | undefined) ?? null,
    email: user.email ?? '',
    nom:
      (moi?.full_name as string | undefined) ||
      (user.user_metadata?.['full_name'] as string | undefined) ||
      user.email ||
      '',
    etablissements: etablissements.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
  }
}

/**
 * L'établissement demandé dans l'URL, s'il est accessible.
 *
 * Un identifiant inconnu ou interdit renvoie vers l'accueil plutôt que vers
 * une page d'erreur : de l'extérieur, les deux cas doivent être
 * indiscernables — sinon l'URL devient un moyen de tester l'existence des
 * restaurants d'autres clients.
 */
export async function etablissementObligatoire(
  restaurantId: string,
): Promise<{ session: SessionBackoffice; etablissement: Etablissement }> {
  const session = await sessionObligatoire()
  const etablissement = session.etablissements.find((e) => e.id === restaurantId)
  if (!etablissement) redirect('/')
  return { session, etablissement }
}

/** Refuse une action d'encadrement, avec un motif affichable. */
export function exigerGestionnaire(etablissement: Etablissement): void {
  if (!etablissement.gestionnaire) {
    throw new Error(
      `Le rôle « ${etablissement.role} » ne permet pas de modifier la configuration ` +
        `de ${etablissement.nom}. Demandez à un gérant.`,
    )
  }
}
