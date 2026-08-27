'use server'

import { redirect } from 'next/navigation'
import { destinationSure } from '../../serveur/redirection.js'
import { supabaseServeur } from '../../serveur/supabase.js'

/**
 * Connexion par e-mail et mot de passe — l'identité UTILISATEUR.
 *
 * À ne pas confondre avec les deux autres identités du produit : le JETON
 * D'APPAREIL, qui parle au /sync, et le CODE PIN, qui dit qui agit sur un
 * terminal. Confondre les trois mène soit à des reconnexions permanentes en
 * salle, soit à une traçabilité inexistante.
 */
export async function seConnecter(
  _precedent: string | null,
  donnees: FormData,
): Promise<string | null> {
  const email = String(donnees.get('email') ?? '').trim()
  const motDePasse = String(donnees.get('motDePasse') ?? '')
  const suite = String(donnees.get('suite') ?? '/') || '/'

  if (email === '' || motDePasse === '') {
    return 'Renseignez votre e-mail et votre mot de passe.'
  }

  const supabase = await supabaseServeur()
  const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse })

  if (error) {
    // Message VOLONTAIREMENT identique pour un e-mail inconnu et un mot de
    // passe faux : les distinguer permettrait d'énumérer les comptes.
    return 'E-mail ou mot de passe incorrect.'
  }

  // `redirect` lève : rien après cette ligne n'est atteint.
  redirect(destinationSure(suite))
}

export async function seDeconnecter() {
  const supabase = await supabaseServeur()
  await supabase.auth.signOut()
  redirect('/connexion')
}
