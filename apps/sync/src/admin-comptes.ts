/**
 * Ouvrir un accès au back-office — sans ligne de commande, sans clé dans le
 * navigateur.
 *
 * ── Le problème, tel qu'il se pose en clientèle ───────────────────────────
 *
 * Créer un compte Supabase exige l'API d'administration, donc la clé
 * `service_role`, qui contourne RLS. Elle n'a rien à faire dans le
 * back-office : c'est ce qui garantit qu'un `where` oublié ne rend jamais
 * les données d'un autre client — le pire cas y est une page vide, pas une
 * fuite. Cette règle ne bouge pas.
 *
 * Restait la conséquence : chaque nouvel accès (le cuisinier, le barman, le
 * comptable) passait par le tableau de bord Supabase PUIS par
 * `pnpm sync:acces`. Un restaurateur ne fera jamais ça, et il aura raison.
 *
 * ── Ce que ce module change, et ce qu'il ne change pas ────────────────────
 *
 * La clé de service vit ICI, dans le service de synchronisation : un process
 * serveur qui porte déjà la chaîne PostgreSQL, que personne ne télécharge,
 * et dont le code ne s'exécute dans aucun navigateur. Le back-office, lui,
 * n'en connaît toujours rien — il APPELLE cette route avec le jeton de la
 * personne connectée, et c'est le service qui vérifie ses droits en base.
 *
 * Autrement dit : la clé ne descend pas d'un cran vers le client, elle monte
 * d'un cran, du poste de l'exploitant vers un serveur.
 *
 * Absente, la route répond 501 et `pnpm sync:acces` reste le chemin — rien
 * ne casse.
 */

import type { ConfigAuth } from './auth-supabase.js'
import { ErreurAuth } from './auth-supabase.js'

/** Rôles qu'un accès back-office peut porter. */
export const ROLES_ACCES = [
  'admin',
  'gerant',
  'caissier',
  'serveur',
  'cuisine',
  'bar',
] as const
export type RoleAcces = (typeof ROLES_ACCES)[number]

/**
 * Les rôles qui distribuent les pouvoirs.
 *
 * Un gérant EXPLOITE : il ouvre un accès à sa cuisine, à son bar, à son
 * comptable. Un administrateur DISTRIBUE : lui seul crée un gérant ou un
 * autre administrateur. C'est la frontière posée par la migration 0024, et
 * elle vaut ici aussi — sinon on la contournerait par cette route.
 */
export const ROLES_QUI_DONNENT_LES_CLES: readonly string[] = ['admin', 'gerant']

/** Longueur minimale d'un mot de passe de back-office. */
export const LONGUEUR_MOT_DE_PASSE = 8

export function cleServiceDepuisEnvironnement(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return env['SUPABASE_SERVICE_ROLE_KEY']?.trim() || null
}

/**
 * Qui parle, d'après le jeton d'accès Supabase du back-office.
 *
 * On interroge Supabase plutôt que de décoder le JWT nous-mêmes : vérifier
 * une signature demande la clé du projet et une gestion de rotation, et un
 * JWT « décodé sans vérifier » est exactement le trou par lequel n'importe
 * qui se déclarerait administrateur.
 */
export async function identifierParJeton(
  config: ConfigAuth,
  jeton: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ userId: string; email: string }> {
  let reponse: Response
  try {
    reponse = await fetchImpl(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.cleAnon, authorization: `Bearer ${jeton}` },
    })
  } catch (erreur) {
    throw new ErreurAuth(
      "Le service d'authentification est injoignable. " +
        (erreur instanceof Error ? erreur.message : String(erreur)),
      503,
    )
  }
  if (reponse.status === 401 || reponse.status === 403) {
    throw new ErreurAuth('Session expirée — reconnectez-vous au back-office.', 401)
  }
  if (!reponse.ok) {
    throw new ErreurAuth(`Le service d'authentification a répondu ${reponse.status}.`, 503)
  }
  const corps = (await reponse.json().catch(() => null)) as {
    id?: unknown
    email?: unknown
  } | null
  if (typeof corps?.id !== 'string' || corps.id.length === 0) {
    throw new ErreurAuth("Réponse d'authentification inattendue.", 500)
  }
  return { userId: corps.id, email: typeof corps.email === 'string' ? corps.email : '' }
}

export interface CompteCree {
  readonly authUserId: string
  /** `false` quand l'adresse avait déjà un compte : on le RATTACHE. */
  readonly nouveau: boolean
}

/**
 * Crée le compte d'authentification, ou retrouve celui qui existe.
 *
 * `email_confirm: true` : sans lui, Supabase envoie un lien de confirmation
 * et refuse la connexion tant que personne n'a cliqué. Dans un restaurant,
 * l'adresse du barman est souvent une boîte que personne ne relève — le
 * compte resterait inutilisable sans que rien ne l'explique.
 */
export async function creerCompteSupabase(
  config: ConfigAuth,
  cleService: string,
  email: string,
  motDePasse: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CompteCree> {
  let reponse: Response
  try {
    reponse = await fetchImpl(`${config.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: cleService,
        authorization: `Bearer ${cleService}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password: motDePasse, email_confirm: true }),
    })
  } catch (erreur) {
    throw new ErreurAuth(
      'Supabase est injoignable — le compte n’a pas été créé. ' +
        (erreur instanceof Error ? erreur.message : String(erreur)),
      503,
    )
  }

  if (reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { id?: unknown } | null
    if (typeof corps?.id !== 'string') {
      throw new ErreurAuth('Réponse inattendue de Supabase à la création du compte.', 500)
    }
    return { authUserId: corps.id, nouveau: true }
  }

  const texte = await reponse.text().catch(() => '')
  // 422 « already been registered » : ce n'est pas une erreur ici. La
  // personne a déjà un compte — chez un autre établissement du groupe, ou
  // parce qu'on rejoue l'opération. On le RATTACHE, comme le fait
  // `pnpm sync:acces` depuis toujours.
  if (reponse.status === 422 || /already/i.test(texte)) {
    return { authUserId: '', nouveau: false }
  }
  if (reponse.status === 401 || reponse.status === 403) {
    throw new ErreurAuth(
      'La clé de service Supabase est refusée. Vérifiez SUPABASE_SERVICE_ROLE_KEY.',
      500,
    )
  }
  throw new ErreurAuth(
    `Supabase a refusé la création du compte (${reponse.status}). ${texte.slice(0, 200)}`,
    500,
  )
}

/**
 * Change le mot de passe d'un compte existant.
 *
 * C'est la réponse à « j'ai perdu le mot de passe du cuisinier ». Le PIN,
 * lui, se réinitialise depuis le back-office : ce sont deux identités
 * distinctes, et les confondre mène soit à des reconnexions permanentes,
 * soit à une traçabilité inexistante.
 */
export async function changerMotDePasse(
  config: ConfigAuth,
  cleService: string,
  authUserId: string,
  motDePasse: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const reponse = await fetchImpl(`${config.url}/auth/v1/admin/users/${authUserId}`, {
    method: 'PUT',
    headers: {
      apikey: cleService,
      authorization: `Bearer ${cleService}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password: motDePasse, email_confirm: true }),
  }).catch((erreur) => {
    throw new ErreurAuth(
      'Supabase est injoignable — le mot de passe n’a pas été changé. ' +
        (erreur instanceof Error ? erreur.message : String(erreur)),
      503,
    )
  })
  if (!reponse.ok) {
    const texte = await reponse.text().catch(() => '')
    throw new ErreurAuth(
      `Supabase a refusé le changement de mot de passe (${reponse.status}). ${texte.slice(0, 200)}`,
      500,
    )
  }
}

/** Validation commune aux deux gestes, avant toute écriture. */
export function verifierMotDePasse(motDePasse: unknown): string {
  if (typeof motDePasse !== 'string' || motDePasse.length < LONGUEUR_MOT_DE_PASSE) {
    throw new ErreurAuth(
      `Le mot de passe doit faire au moins ${LONGUEUR_MOT_DE_PASSE} caractères.`,
      401,
    )
  }
  return motDePasse
}

export function verifierEmail(email: unknown): string {
  const valeur = typeof email === 'string' ? email.trim().toLowerCase() : ''
  // Volontairement permissif : une adresse « valide » selon la RFC ne dit
  // rien de sa délivrabilité, et un contrôle trop strict refuse des adresses
  // réelles. On écarte seulement ce qui n'est manifestement pas une adresse.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur)) {
    throw new ErreurAuth('Adresse e-mail invalide.', 401)
  }
  return valeur
}
