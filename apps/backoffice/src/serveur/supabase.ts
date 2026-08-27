/**
 * Accès à Supabase depuis le back-office.
 *
 * RÈGLE : ce fichier n'utilise QUE la clé publique. Jamais `service_role`.
 *
 * Ce n'est pas une préférence de style. La clé `service_role` contourne RLS
 * entièrement : une requête écrite avec elle voit — et modifie — les données
 * de TOUS les restaurants, y compris ceux de clients concurrents. Le
 * cloisonnement du produit reposerait alors sur la vigilance de chaque
 * `where restaurant_id = …` écrit à la main, ce qui n'est pas une garantie.
 *
 * Avec la clé publique et la session de l'utilisateur, c'est PostgreSQL qui
 * cloisonne, via les politiques de `supabase/migrations/`. Un `where` oublié
 * ne rend alors aucune ligne au lieu de rendre celles d'un autre client.
 */

import { createServerClient } from '@supabase/ssr'
import type { Database } from './schema.js'
import { cookies } from 'next/headers'

/** Message unique : les trois causes possibles, et leur correctif. */
function exiger(nom: string): string {
  const valeur = process.env[nom]
  if (!valeur || valeur.trim() === '') {
    throw new Error(
      `Variable d'environnement manquante : ${nom}.\n` +
        'Sur Supabase : bouton « Connect » en haut du projet, onglet « App Frameworks ».\n' +
        'En local, la renseigner dans apps/backoffice/.env.local.',
    )
  }
  return valeur
}

/**
 * Refuse une clé de service, quelle que soit sa forme.
 *
 * Les deux formats coexistent aujourd'hui : l'ancien JWT (`eyJ…`, dont la
 * charge utile porte `"role":"service_role"`) et le nouveau préfixe
 * `sb_secret_`. Coller la mauvaise clé dans la variable publique est une
 * erreur de copier-coller ordinaire — et elle exposerait tous les
 * établissements. Autant qu'elle empêche l'application de démarrer.
 */
export function refuserCleDeService(cle: string): void {
  if (cle.startsWith('sb_secret_')) {
    throw new Error(
      'La clé fournie est une clé SECRÈTE (sb_secret_…). Le back-office ' +
        'doit utiliser la clé publique (sb_publishable_…) : elle seule passe par RLS.',
    )
  }
  // JWT hérité : on lit la charge utile sans vérifier la signature — on ne
  // cherche pas à l'authentifier, seulement à reconnaître son rôle.
  const segments = cle.split('.')
  if (segments.length === 3 && segments[1]) {
    try {
      const charge = JSON.parse(Buffer.from(segments[1], 'base64').toString('utf8')) as {
        role?: string
      }
      if (charge.role === 'service_role') {
        throw new Error(
          'La clé fournie est la clé service_role. Elle CONTOURNE RLS et ne doit ' +
            'jamais quitter un serveur de confiance. Utiliser la clé anon/publishable.',
        )
      }
    } catch (erreur) {
      if (erreur instanceof Error && erreur.message.includes('service_role')) throw erreur
      // Charge utile illisible : ce n'est pas un JWT Supabase, on laisse
      // Supabase lui-même rejeter la clé avec son propre message.
    }
  }
}

export function urlSupabase(): string {
  return exiger('NEXT_PUBLIC_SUPABASE_URL')
}

export function clePublique(): string {
  const cle = exiger('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  refuserCleDeService(cle)
  return cle
}

/**
 * Client lié à la session de l'utilisateur connecté.
 *
 * Toutes les requêtes du back-office passent par ici : c'est ce qui fait que
 * RLS s'applique, et que `est_gestionnaire()` décide réellement qui peut
 * modifier un prix.
 */
export async function supabaseServeur() {
  const magasin = await cookies()
  return createServerClient<Database, 'kaissi'>(urlSupabase(), clePublique(), {
    cookies: {
      getAll() {
        return magasin.getAll()
      },
      setAll(aPoser) {
        try {
          for (const { name, value, options } of aPoser) magasin.set(name, value, options)
        } catch {
          // Appelé depuis un Server Component : Next.js interdit d'écrire un
          // cookie ici. Le middleware rafraîchit déjà la session, donc il n'y
          // a rien à réparer — et rien à signaler à l'utilisateur.
        }
      },
    },
    db: { schema: 'kaissi' },
  })
}
