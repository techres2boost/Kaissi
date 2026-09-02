/**
 * Vérification d'un couple e-mail / mot de passe auprès de Supabase Auth.
 *
 * ── Pourquoi le mot de passe passe par NOTRE serveur ──────────────────────
 *
 * L'alternative serait que le POS parle directement à Supabase Auth. Elle
 * exigerait d'embarquer l'URL du projet et la clé publiable DANS L'APK — or
 * une garde de build interdit toute clé Supabase dans le bundle du POS, et
 * cette règle vaut mieux que la commodité : le terminal ne connaît QUE son
 * serveur de synchronisation, et ne peut donc rien attaquer d'autre.
 *
 * Le mot de passe traverse donc ce service, en HTTPS, le temps d'un échange.
 * Il n'est ni journalisé, ni stocké, ni relu : il part vers Supabase et
 * disparaît. C'est le modèle de tous les POS du marché, où le caissier
 * s'identifie dans l'application et non par un jeton recopié à la main.
 *
 * Ce que le service reçoit en retour est l'identifiant de l'utilisateur.
 * Rien d'autre ne l'intéresse : les droits viennent de `memberships`, pas
 * du jeton Supabase.
 */

export interface IdentiteSupabase {
  readonly userId: string
  readonly email: string
}

export class ErreurAuth extends Error {
  // Champ explicite, JAMAIS une « parameter property ».
  //
  // Le service tourne en production avec `--experimental-strip-types` : Node
  // retire les types sans les transformer, et `constructor(readonly statut…)`
  // n'est pas une syntaxe qu'il sait retirer. Le process refuserait de
  // démarrer — sur un fichier qui passe pourtant tous les tests unitaires,
  // parce que Vitest, lui, transforme.
  readonly statut: 401 | 500 | 503

  constructor(message: string, statut: 401 | 500 | 503) {
    super(message)
    this.statut = statut
    this.name = 'ErreurAuth'
  }
}

export interface ConfigAuth {
  readonly url: string
  readonly cleAnon: string
}

/**
 * Lit la configuration Supabase du service.
 *
 * Absente, l'appairage par identifiants est simplement indisponible — le
 * service continue de fonctionner pour les terminaux déjà appairés. On ne
 * fait pas tomber une caisse en service parce qu'une variable manque.
 */
export function configAuthDepuisEnvironnement(
  env: NodeJS.ProcessEnv = process.env,
): ConfigAuth | null {
  const url = env['SUPABASE_URL']?.trim().replace(/\/+$/, '')
  const cleAnon = env['SUPABASE_ANON_KEY']?.trim()
  if (!url || !cleAnon) return null
  return { url, cleAnon }
}

/**
 * Échange e-mail + mot de passe contre l'identité de l'utilisateur.
 *
 * `fetchImpl` est injectable pour que le test n'ait pas besoin d'un vrai
 * Supabase : c'est le SEUL point d'entrée réseau de cette fonction.
 */
export async function identifierParMotDePasse(
  config: ConfigAuth,
  email: string,
  motDePasse: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IdentiteSupabase> {
  let reponse: Response
  try {
    reponse = await fetchImpl(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: config.cleAnon,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password: motDePasse }),
    })
  } catch (erreur) {
    throw new ErreurAuth(
      "Le service d'authentification est injoignable. " +
        'La caisse continue de fonctionner en local. ' +
        (erreur instanceof Error ? erreur.message : String(erreur)),
      503,
    )
  }

  if (reponse.status === 400 || reponse.status === 401) {
    // Message VOLONTAIREMENT identique pour un e-mail inconnu et un mot de
    // passe faux : sinon l'écran d'appairage devient un moyen de savoir
    // quelles adresses existent.
    throw new ErreurAuth('E-mail ou mot de passe incorrect.', 401)
  }
  if (!reponse.ok) {
    throw new ErreurAuth(
      `Le service d'authentification a répondu ${reponse.status}.`,
      503,
    )
  }

  const corps = (await reponse.json().catch(() => null)) as {
    user?: { id?: unknown; email?: unknown }
  } | null

  const userId = corps?.user?.id
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new ErreurAuth("Réponse d'authentification inattendue.", 500)
  }

  return {
    userId,
    email: typeof corps?.user?.email === 'string' ? corps.user.email : email,
  }
}
