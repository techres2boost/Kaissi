'use server'

import { revalidatePath } from 'next/cache'
import { hacherPin, validerFormatPin, pinTropFaible, ErreurPin } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { choix, ErreurSaisie, texteObligatoire } from '../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

const ROLES = ['gerant', 'caissier', 'serveur', 'cuisine'] as const

async function agir(
  restaurantId: string,
  travail: (supabase: Awaited<ReturnType<typeof supabaseServeur>>) => Promise<string>,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const succes = await travail(await supabaseServeur())
    revalidatePath(`/${restaurantId}/employes`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie || erreur instanceof ErreurPin) {
      return { erreur: erreur.message }
    }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Une modification qui n'a touché AUCUNE ligne n'est pas un succès.
 *
 * C'est le mode d'échec propre à RLS : la clause USING masque la ligne, la
 * requête réussit, et zéro ligne est modifiée. Sans ce contrôle, l'interface
 * afficherait « PIN réinitialisé » alors que rien n'a changé — et le PIN
 * annoncé à l'employé ne fonctionnerait pas.
 */
function exigerUneLigne(nombre: number | null, quoi: string): void {
  if (!nombre) {
    throw new Error(
      `${quoi} n'a rien modifié. Votre rôle ne vous permet pas d'agir sur cet employé — ` +
        'un gérant ne peut pas administrer un administrateur.',
    )
  }
}

/**
 * Réinitialise un code PIN.
 *
 * Le hachage est calculé ICI, par @kaissi/domain, avec les mêmes paramètres
 * Argon2id que la tablette. Le PIN en clair ne quitte jamais cette fonction :
 * il n'est ni journalisé, ni stocké, ni renvoyé au navigateur — seul le
 * gérant l'a tapé et doit le communiquer de vive voix.
 */
export async function reinitialiserPin(
  restaurantId: string,
  employeId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const pin = texteObligatoire(donnees, 'pin', 'Le code PIN', 8)
    const confirmation = texteObligatoire(donnees, 'confirmation', 'La confirmation', 8)

    if (pin !== confirmation) {
      throw new ErreurSaisie('confirmation', 'Les deux codes saisis ne sont pas identiques.')
    }
    validerFormatPin(pin)
    if (pinTropFaible(pin)) {
      throw new ErreurSaisie(
        'pin',
        `« ${pin} » est trop facile à deviner (suite, répétition ou code courant). ` +
          'Un PIN sert à savoir QUI a agi : un code partagé par toute la salle ne trace rien.',
      )
    }

    const { count, error } = await supabase
      .from('users')
      .update({ pin_hash: hacherPin(pin), updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', employeId)

    if (error) throw new Error(error.message)
    exigerUneLigne(count, 'La réinitialisation du PIN')

    return (
      'Code PIN réinitialisé. Communiquez-le de vive voix : il n’est ni affiché ' +
      'ni conservé en clair. Les tablettes le recevront à leur prochaine synchronisation.'
    )
  })
}

export async function changerRole(
  restaurantId: string,
  employeId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const role = choix(donnees, 'role', 'Le rôle', ROLES)
    const { count, error } = await supabase
      .from('memberships')
      .update({ role, updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('user_id', employeId)
      .eq('restaurant_id', restaurantId)

    if (error) throw new Error(error.message)
    exigerUneLigne(count, 'Le changement de rôle')
    return `Rôle changé en « ${role} ». Le plafond de remise associé s’applique dès la synchronisation.`
  })
}

export async function changerStatut(
  restaurantId: string,
  employeId: string,
  suspendre: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const { count, error } = await supabase
      .from('users')
      .update(
        { status: suspendre ? 'suspendu' : 'actif', updated_at: new Date().toISOString() },
        { count: 'exact' },
      )
      .eq('id', employeId)

    if (error) throw new Error(error.message)
    exigerUneLigne(count, 'Le changement de statut')

    return suspendre
      ? 'Employé suspendu : il ne pourra plus prendre son poste. Ses commandes passées restent lisibles.'
      : 'Employé réactivé.'
  })
}
