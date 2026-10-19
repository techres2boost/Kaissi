/**
 * Le bouton « Back-office » de la caisse ne redemande pas le mot de passe
 * à quelqu'un qui est déjà connecté.
 *
 * PANNE OBSERVÉE sur téléphone : première ouverture, connexion — très bien.
 * Retour à la caisse, nouveau toucher sur « Back-office » : la page de
 * connexion, encore. La session était là ; c'est `/connexion?email=…`, ce
 * que la caisse ouvre, qui ne la regardait pas.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let utilisateur: { email: string } | null = null

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: utilisateur } }) },
  }),
}))
vi.mock('./serveur/supabase.js', () => ({
  urlSupabase: () => 'https://exemple.supabase.co',
  clePublique: () => 'cle-publique',
}))

const { middleware } = await import('./middleware.js')

function ouvrir(chemin: string) {
  return middleware(new NextRequest(`https://kaissi-backoffice.vercel.app${chemin}`))
}

beforeEach(() => {
  utilisateur = null
})

describe('/connexion avec une session déjà ouverte', () => {
  it('la caisse rouvre le back-office : on va à l’accueil, sans mot de passe', async () => {
    utilisateur = { email: 'gerant@snack.tn' }
    const r = await ouvrir('/connexion?email=gerant%40snack.tn')
    expect(r.status).toBe(307)
    expect(new URL(r.headers.get('location')!).pathname).toBe('/')
  })

  it('sans adresse demandée : même chose', async () => {
    utilisateur = { email: 'gerant@snack.tn' }
    const r = await ouvrir('/connexion')
    expect(new URL(r.headers.get('location')!).pathname).toBe('/')
  })

  it('la destination d’origine est respectée — et jamais vers un autre site', async () => {
    utilisateur = { email: 'gerant@snack.tn' }
    const ici = await ouvrir('/connexion?suite=%2Fresto%2Fventes')
    expect(new URL(ici.headers.get('location')!).pathname).toBe('/resto/ventes')
    const ailleurs = await ouvrir('/connexion?suite=%2F%2Fevil.tn')
    const cible = new URL(ailleurs.headers.get('location')!)
    expect(cible.host).toBe('kaissi-backoffice.vercel.app')
    expect(cible.pathname).toBe('/')
  })

  it('la caisse demande un AUTRE compte : le formulaire reste, pour changer', async () => {
    utilisateur = { email: 'autre@snack.tn' }
    const r = await ouvrir('/connexion?email=gerant%40snack.tn')
    expect(r.headers.get('location')).toBeNull()
  })

  it('personne de connecté : le formulaire, évidemment', async () => {
    const r = await ouvrir('/connexion?email=gerant%40snack.tn')
    expect(r.headers.get('location')).toBeNull()
  })
})
