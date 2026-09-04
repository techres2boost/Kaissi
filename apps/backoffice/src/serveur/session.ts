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

export type RoleMembre = 'admin' | 'gerant' | 'caissier' | 'serveur' | 'cuisine' | 'bar'

/**
 * Les rôles qui PRÉPARENT : cuisine et bar.
 *
 * Ils ne voient aucun montant, nulle part. Ce n'est pas une préférence
 * d'affichage : celui qui prépare n'encaisse pas, et le chiffre d'affaires
 * n'a rien à faire sur un écran posé au passe, visible de la salle.
 */
const ROLES_PREPARATION: readonly RoleMembre[] = ['cuisine', 'bar']

export function estPreparation(role: RoleMembre): boolean {
  return ROLES_PREPARATION.includes(role)
}

export interface Etablissement {
  id: string
  organizationId: string
  nom: string
  role: RoleMembre
  /** Vrai si ce membre peut modifier le référentiel — miroir de est_gestionnaire(). */
  gestionnaire: boolean
  /**
   * Vrai pour le seul rôle `admin` — miroir de `est_administrateur()`.
   *
   * La différence avec `gestionnaire` tient en une phrase : un gérant EXPLOITE
   * l'établissement (carte, stock, rapports, embauche de caissiers, serveurs
   * et cuisine), un administrateur décide QUI d'autre obtient ces pouvoirs.
   * C'est la seule frontière entre les deux rôles, et elle est appliquée par
   * RLS (migration 0024) autant qu'ici.
   */
  administrateur: boolean
  /**
   * Vrai pour `cuisine` et `bar` : ce membre PRÉPARE, il n'encaisse pas.
   *
   * Il n'a qu'un seul écran, et aucun montant n'y figure. Le back-office ne
   * lui propose donc rien d'autre — pas même « Journée », qui affiche le
   * fond de caisse et l'écart.
   */
  preparation: boolean
  /**
   * Poste tenu, pour un rôle de préparation. Nul : ce membre voit toutes les
   * lignes du service, ce qui reste correct dans un établissement à un seul
   * poste.
   */
  stationId: string | null
  /** Nom du poste, pour le titre de l'écran. */
  stationNom: string | null
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

  /*
   * MES appartenances — et le filtre sur `user_id` est INDISPENSABLE.
   *
   * La politique `memberships_lecture` rend, à dessein, TOUTES les
   * appartenances de mes établissements : c'est ce qui permet à l'écran
   * « Employés » de lister l'équipe. Sans `eq('user_id', …)`, cette requête
   * renvoyait donc une ligne par COLLÈGUE, et `etablissements` contenait
   * vingt fois le même restaurant avec des rôles arbitraires. Le rôle retenu
   * était alors celui de la première ligne rendue par la base : un cuisinier
   * pouvait hériter des droits d'un gérant, et un admin se voir refuser les
   * siens — sans la moindre erreur nulle part.
   *
   * RLS protège du CLOISONNEMENT entre clients ; elle ne dit pas qui je suis
   * dans mon propre restaurant. Ce filtre-là est applicatif, par nature.
   */
  const { data, error } = moi
    ? await supabase
        .from('memberships')
        .select('role, organization_id, restaurant_id, station_id, stations(name), restaurants(name)')
        .eq('user_id', moi.id as string)
        .is('revoked_at', null)
    : { data: [], error: null }

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
    const station = ligne.stations as { name: string } | { name: string }[] | null
    const stationNom = Array.isArray(station) ? station[0]?.name : station?.name
    return {
      id: ligne.restaurant_id as string,
      organizationId: ligne.organization_id as string,
      nom: nom ?? 'Établissement',
      role,
      gestionnaire: ROLES_GESTIONNAIRES.includes(role),
      administrateur: role === 'admin',
      preparation: estPreparation(role),
      stationId: (ligne.station_id as string | null) ?? null,
      stationNom: stationNom ?? null,
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

/**
 * Interdit un écran à qui n'a rien à y faire, en REDIRIGEANT.
 *
 * ── Pourquoi ce garde-fou a dû être ajouté ────────────────────────────────
 *
 * La navigation masquait déjà les onglets qu'un rôle ne doit pas voir. Mais
 * masquer un lien n'interdit rien : les pages `ventes`, `tickets` et
 * `tableau-bord` ne vérifiaient AUCUN rôle. Un cuisinier qui tapait l'URL —
 * ou qui suivait un lien collé dans une conversation — lisait le chiffre
 * d'affaires de l'établissement.
 *
 * Ce n'est pas la seule barrière et ce n'est pas la principale : RLS reste
 * ce qui protège les données entre CLIENTS. Mais RLS ne dit pas quel écran
 * un membre légitime de CE restaurant a le droit d'ouvrir — ce cloisonnement
 * là est applicatif, par nature (voir aussi `memberships_lecture`).
 *
 * On redirige plutôt qu'on n'affiche une erreur : l'intéressé arrive sur son
 * écran, ce qui est utile, au lieu d'un mur qui ne l'est pas.
 *
 *   • `exploitation` — tout sauf la préparation. Un caissier a de bonnes
 *     raisons de consulter la journée ; un cuisinier, non.
 *   • `gestion` — encadrement seul : carte, stock, rapports, équipe.
 */
export function ecranReserve(
  etablissement: Etablissement,
  niveau: 'exploitation' | 'gestion',
): void {
  if (etablissement.preparation) redirect(`/${etablissement.id}/preparation`)
  if (niveau === 'gestion' && !etablissement.gestionnaire) {
    redirect(`/${etablissement.id}/journee`)
  }
}

/** Refuse une action d'encadrement, avec un motif affichable. */
/**
 * Exige le rôle `admin`.
 *
 * Réservé aux gestes qui DONNENT DU POUVOIR : accorder ou retirer un rôle
 * `gerant` ou `admin`. Tout le reste de la gestion appartient au gérant.
 */
export function exigerAdministrateur(etablissement: Etablissement, geste: string): void {
  if (!etablissement.administrateur) {
    throw new Error(
      `${geste} est réservé à un administrateur. Un gérant gère la carte, le ` +
        `stock, les rapports et l'équipe d'exploitation — mais il ne distribue ` +
        `pas les accès qui donnent les mêmes pouvoirs que les siens.`,
    )
  }
}

export function exigerGestionnaire(etablissement: Etablissement): void {
  if (!etablissement.gestionnaire) {
    throw new Error(
      `Le rôle « ${etablissement.role} » ne permet pas de modifier la configuration ` +
        `de ${etablissement.nom}. Demandez à un gérant.`,
    )
  }
}
