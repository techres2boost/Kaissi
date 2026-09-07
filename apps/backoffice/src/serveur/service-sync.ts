/**
 * Le pont vers le service de synchronisation.
 *
 * ── Pourquoi le back-office lui délègue ───────────────────────────────────
 *
 * Créer un compte Supabase — ou un établissement — exige la clé
 * `service_role`, qui contourne RLS. Elle n'entre JAMAIS dans le
 * back-office, pas même dans ses variables d'environnement : il tourne sur
 * Vercel, et son code est téléchargé par un navigateur. Elle vit dans le
 * service de synchronisation, un process serveur que personne ne télécharge.
 *
 * ── Ce qui voyage, et ce qui décide ───────────────────────────────────────
 *
 * Le back-office transmet le JETON de la session en cours. Le service relit
 * les droits EN BASE : il ne croit pas le back-office sur parole. Un défaut
 * de filtrage ici ne peut donc pas ouvrir un accès chez un autre client.
 */

import { ErreurSaisie } from './formulaire.js'
import { supabaseServeur } from './supabase.js'

/** Le jeton de la session en cours, pour parler au service en son nom. */
export async function jetonDeSession(): Promise<string> {
  const supabase = await supabaseServeur()
  const { data } = await supabase.auth.getSession()
  const jeton = data.session?.access_token
  if (!jeton) throw new ErreurSaisie('session', 'Session expirée — reconnectez-vous.')
  return jeton
}

export async function appelerService(
  chemin: string,
  charge: Record<string, unknown>,
  /*
   * Le type de retour est OUVERT.
   *
   * Chaque route rend ses propres champs — un identifiant d'établissement,
   * un compte créé — et l'appelant les lit en connaissance de cause. Fermer
   * ce type à `{ message }` obligerait à l'élargir à chaque route, et à
   * relire ce fichier pour comprendre pourquoi la nouvelle ne compile pas.
   */
): Promise<Record<string, unknown> & { message?: string }> {
  const base = (process.env['URL_SYNC'] ?? '').replace(/\/+$/, '')
  if (!base) {
    throw new ErreurSaisie(
      'service',
      "L'adresse du service de synchronisation n'est pas configurée " +
        '(apps/pos/deploiement.json, ou la variable URL_SYNC).',
    )
  }
  let reponse: Response
  try {
    reponse = await fetch(`${base}${chemin}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await jetonDeSession()}`,
      },
      body: JSON.stringify(charge),
      // Un service qui ne répond pas ne doit pas laisser l'écran en attente
      // indéfinie : le gérant doit savoir qu'il peut réessayer.
      signal: AbortSignal.timeout(15_000),
    })
  } catch (erreur) {
    throw new ErreurSaisie(
      'service',
      'Le service de synchronisation est injoignable. ' +
        (erreur instanceof Error ? erreur.message : String(erreur)),
    )
  }

  const corps = (await reponse.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; erreur?: string })
    | null
  if (!reponse.ok) {
    throw new ErreurSaisie('service', corps?.message ?? `Le service a répondu ${reponse.status}.`)
  }
  return corps ?? {}
}

