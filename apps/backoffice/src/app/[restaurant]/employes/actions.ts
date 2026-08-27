'use server'

import { revalidatePath } from 'next/cache'
import { hacherPin, validerFormatPin, pinTropFaible, ErreurPin } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { uuidV7 } from '@kaissi/domain'
import {
  choix,
  ErreurSaisie,
  texteFacultatif,
  texteObligatoire,
} from '../../../serveur/formulaire.js'

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
    const pinHash = hachageDuPin(donnees, 'pin', 'confirmation')

    const { count, error } = await supabase
      .from('users')
      .update({ pin_hash: pinHash, updated_at: new Date().toISOString() }, { count: 'exact' })
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

/** Valide un PIN et rend son hachage, ou lève un message affichable. */
function hachageDuPin(donnees: FormData, champPin: string, champConfirmation: string): string {
  const pin = texteObligatoire(donnees, champPin, 'Le code PIN', 8)
  const confirmation = texteObligatoire(donnees, champConfirmation, 'La confirmation', 8)

  if (pin !== confirmation) {
    throw new ErreurSaisie(champConfirmation, 'Les deux codes saisis ne sont pas identiques.')
  }
  validerFormatPin(pin)
  if (pinTropFaible(pin)) {
    throw new ErreurSaisie(
      champPin,
      `« ${pin} » est trop facile à deviner (suite, répétition ou code courant). ` +
        'Un PIN sert à savoir QUI a agi : un code partagé par toute la salle ne trace rien.',
    )
  }
  return hacherPin(pin)
}

/**
 * Embauche un employé.
 *
 * Ce que cette fonction NE fait PAS : créer un compte de connexion. Un serveur
 * en salle n'ouvre jamais le back-office — il tape un PIN sur une tablette.
 * Depuis la migration 0017, les deux identités sont distinctes, et c'est ce
 * qui rend cette embauche possible sans la clé d'administration Supabase.
 *
 * Les deux écritures — l'employé et son rôle — doivent réussir ensemble. Un
 * employé sans appartenance n'apparaîtrait nulle part, et le gérant ne
 * pourrait même plus le corriger : les politiques ne le lui rendraient pas.
 */
export async function embaucher(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    const nom = texteObligatoire(donnees, 'nom', 'Le nom', 200)
    const role = choix(donnees, 'role', 'Le rôle', ROLES)
    const email = texteFacultatif(donnees, 'email')
    const pinHash = hachageDuPin(donnees, 'pin', 'confirmation')

    // RÈGLE 2 : l'identifiant vient du client, jamais d'un « serial ».
    const employeId = uuidV7()

    const { error: erreurEmploye } = await supabase.from('users').insert({
      id: employeId,
      organization_id: etablissement.organizationId,
      full_name: nom,
      email,
      pin_hash: pinHash,
      status: 'actif',
    })
    if (erreurEmploye) {
      if (erreurEmploye.code === '23505') {
        throw new Error(`Un employé utilise déjà l'adresse « ${email} ».`)
      }
      throw new Error(erreurEmploye.message)
    }

    const { error: erreurRole } = await supabase.from('memberships').insert({
      organization_id: etablissement.organizationId,
      user_id: employeId,
      restaurant_id: restaurantId,
      role,
    })
    if (erreurRole) {
      // Sans rôle, l'employé serait invisible ET inatteignable : les politiques
      // ne le rendraient plus au gérant qui vient de le créer. On défait.
      await supabase.from('users').delete().eq('id', employeId)
      throw new Error(
        `Le rôle n'a pas pu être attribué (${erreurRole.message}). L'employé n'a pas été créé.`,
      )
    }

    return (
      `${nom} est embauché·e comme ${role}. Communiquez son code PIN de vive voix : ` +
      "il n'est ni affiché ni conservé en clair. Les tablettes le recevront à leur " +
      'prochaine synchronisation.'
    )
  })
}
