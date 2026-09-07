/**
 * Rafraîchit la session Supabase à chaque navigation.
 *
 * Sans cela, le jeton d'accès expire au bout d'une heure et l'utilisateur est
 * déconnecté en plein milieu d'une saisie — typiquement en corrigeant les
 * prix de la carte, donc avec du travail non enregistré à l'écran.
 *
 * Un Server Component ne PEUT pas écrire de cookie : c'est ici, et seulement
 * ici, que le jeton rafraîchi est reposé.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { clePublique, urlSupabase } from './serveur/supabase.js'

/**
 * La politique de contenu, avec un nonce RENOUVELÉ à chaque réponse.
 *
 * ── Pourquoi elle est ici et pas dans `next.config.mjs` ───────────────────
 *
 * Parce qu'un nonce doit être imprévisible et unique par réponse. Une valeur
 * écrite dans la configuration serait constante — donc devinable, donc
 * exactement aussi utile que `'unsafe-inline'`.
 *
 * ── Pourquoi une CSP, alors que RLS protège déjà les données ──────────────
 *
 * Elle ne protège pas contre les mêmes choses. RLS empêche un client de LIRE
 * les données d'un autre. La CSP empêche du script injecté de s'exécuter
 * DANS la session d'un gérant légitime — auquel cas RLS lui rendrait
 * volontiers tout ce à quoi ce gérant a droit. C'est la deuxième couche, et
 * elle échoue différemment de la première.
 *
 * ── Ce que chaque directive coûte ─────────────────────────────────────────
 *
 * `'strict-dynamic'` : les scripts chargés PAR un script de confiance sont
 * eux-mêmes de confiance. C'est ce qui rend le découpage de bundles de
 * Next.js possible sans lister chaque fragment.
 *
 * `'unsafe-inline'` sur les STYLES seulement, jamais sur les scripts :
 * React et Next posent des styles en ligne (l'attribut `style` de chaque
 * composant). Un style injecté peut défigurer une page ; il n'exécute pas de
 * code. Le compromis est asymétrique, et il penche du bon côté.
 *
 * `'unsafe-eval'` en DÉVELOPPEMENT uniquement : le rafraîchissement à chaud
 * de Next en dépend. Il n'entre jamais dans le bundle de production.
 */
function politiqueContenu(nonce: string, enDeveloppement: boolean): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${enDeveloppement ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    // Les avatars et logos éventuels viennent de Supabase Storage ; `data:`
    // couvre les images en ligne des graphiques.
    `img-src 'self' blob: data: https://*.supabase.co`,
    `font-src 'self' data:`,
    // Supabase pour les données, le service de synchronisation pour
    // l'administration. Rien d'autre ne doit pouvoir être appelé.
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${process.env['URL_SYNC'] ?? ''}`.trim(),
    // Le pendant moderne de X-Frame-Options : personne ne nous encadre.
    `frame-ancestors 'none'`,
    // Aucun `<base>`, aucun formulaire vers l'extérieur : deux façons
    // classiques de détourner une page sans y injecter de script.
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    // Une ressource en clair sur une page chiffrée est une porte ouverte au
    // milieu du chemin.
    `upgrade-insecure-requests`,
  ].join('; ')
}

export async function middleware(requete: NextRequest) {
  /*
   * 16 octets d'aléa cryptographique, en base64.
   *
   * `crypto.randomUUID()` conviendrait presque, mais un UUID v4 ne porte que
   * 122 bits d'entropie et se reconnaît à sa forme. Ici, c'est du bruit.
   */
  const nonce = Buffer.from(crypto.randomUUID().replaceAll('-', ''), 'hex').toString('base64')
  const enDeveloppement = process.env.NODE_ENV !== 'production'
  const csp = politiqueContenu(nonce, enDeveloppement)

  /*
   * Le nonce voyage vers le rendu par un EN-TÊTE DE REQUÊTE.
   *
   * C'est le seul canal entre le middleware, qui s'exécute avant tout, et le
   * rendu de la page : Next.js lit `x-nonce` et le pose lui-même sur chaque
   * balise `<script>` qu'il émet. Sans cela, il faudrait le passer en
   * contexte React — ce qui ne marche pas, le rendu ayant déjà commencé.
   */
  const entetes = new Headers(requete.headers)
  entetes.set('x-nonce', nonce)
  entetes.set('content-security-policy', csp)

  let reponse = NextResponse.next({ request: { headers: entetes } })
  reponse.headers.set('content-security-policy', csp)

  const supabase = createServerClient(urlSupabase(), clePublique(), {
    cookies: {
      getAll() {
        return requete.cookies.getAll()
      },
      setAll(aPoser) {
        for (const { name, value } of aPoser) requete.cookies.set(name, value)
        // La réponse est REFABRIQUÉE ici : il faut donc reposer la CSP, que
        // l'on perdrait sinon exactement sur les requêtes où le jeton est
        // rafraîchi — c'est-à-dire une navigation sur deux.
        reponse = NextResponse.next({ request: { headers: entetes } })
        reponse.headers.set('content-security-policy', csp)
        for (const { name, value, options } of aPoser) reponse.cookies.set(name, value, options)
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !requete.nextUrl.pathname.startsWith('/connexion')) {
    const versConnexion = requete.nextUrl.clone()
    versConnexion.pathname = '/connexion'
    // On garde la destination : après connexion, l'utilisateur revient là où
    // il allait, et non sur un accueil qui lui fait tout recommencer.
    versConnexion.searchParams.set('suite', requete.nextUrl.pathname)
    return NextResponse.redirect(versConnexion)
  }

  return reponse
}

export const config = {
  // Ni les fichiers statiques ni les images : les réveiller à chaque requête
  // coûterait un appel réseau à Supabase pour rien.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
