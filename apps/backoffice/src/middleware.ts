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

export async function middleware(requete: NextRequest) {
  let reponse = NextResponse.next({ request: requete })

  const supabase = createServerClient(urlSupabase(), clePublique(), {
    cookies: {
      getAll() {
        return requete.cookies.getAll()
      },
      setAll(aPoser) {
        for (const { name, value } of aPoser) requete.cookies.set(name, value)
        reponse = NextResponse.next({ request: requete })
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
