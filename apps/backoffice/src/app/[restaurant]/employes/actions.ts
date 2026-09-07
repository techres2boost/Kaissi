'use server'

import { revalidatePath } from 'next/cache'
import { hacherPin, validerFormatPin, pinTropFaible, ErreurPin } from '@kaissi/domain'
import {
  etablissementObligatoire,
  exigerAdministrateur,
  exigerGestionnaire,
  type Etablissement,
} from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
// Le pont vers le service de synchronisation vit à part : la création d'un
// établissement s'en sert aussi, et le dupliquer serait dupliquer la garde
// qui va avec.
import { appelerService } from '../../../serveur/service-sync.js'
import { uuidV7 } from '@kaissi/domain'
import {
  choix,
  choixFacultatif,
  ErreurSaisie,
  texteFacultatif,
  texteObligatoire,
} from '../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

const ROLES = ['gerant', 'caissier', 'serveur', 'cuisine', 'bar'] as const

/**
 * Les rôles qui PRÉPARENT — ce sont les seuls à tenir un poste.
 *
 * Attacher un poste à un caissier n'aurait pas de sens : il ne va jamais sur
 * l'écran de préparation. Le champ ne lui est donc pas proposé, et le
 * serveur remet le poste à nul si le rôle cesse d'en tenir un — sinon une
 * appartenance garderait la trace d'un poste que plus rien n'utilise.
 */
const ROLES_DE_PREPARATION: readonly string[] = ['cuisine', 'bar']

/**
 * Les rôles qui donnent accès à l'argent et à la configuration.
 *
 * Les accorder, c'est distribuer ses propres pouvoirs : réservé à un
 * administrateur. Un gérant embauche et gère l'équipe d'exploitation —
 * caissiers, serveurs, cuisine — et rien au-dessus. RLS applique la même
 * règle (migration 0024) ; ce contrôle-ci sert surtout à rendre un message
 * clair plutôt qu'un « aucune ligne modifiée ».
 */
const ROLES_QUI_DONNENT_LES_CLES: readonly string[] = ['admin', 'gerant']

async function agir(
  restaurantId: string,
  travail: (
    supabase: Awaited<ReturnType<typeof supabaseServeur>>,
    etablissement: Etablissement,
  ) => Promise<string>,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const succes = await travail(await supabaseServeur(), etablissement)
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

    /*
     * `updated_at` n'est PAS écrit ici, et c'est la correction du bug
     * « permission denied for table users ».
     *
     * La 0014 a remplacé le privilège de table par un privilège de COLONNE :
     * un gérant peut écrire `full_name`, `phone`, `pin_hash`, `status` et
     * `archived_at`, rien d'autre. Toucher `updated_at` faisait refuser
     * l'écriture ENTIÈRE par Postgres — pas par RLS, par le privilège, d'où
     * ce message qui ne parlait de rien de reconnaissable.
     *
     * La colonne n'a de toute façon pas à être écrite à la main : le
     * déclencheur `users_updated_at` la pose (0002). L'écrire ici, c'était
     * dupliquer une valeur que la base tient déjà.
     */
    const { count, error } = await supabase
      .from('users')
      .update({ pin_hash: pinHash }, { count: 'exact' })
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
  /** Postes de l'établissement — la valeur reçue est vérifiée contre eux. */
  postesAutorises: readonly string[],
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase, etablissement) => {
    const role = choix(donnees, 'role', 'Le rôle', ROLES)
    if (ROLES_QUI_DONNENT_LES_CLES.includes(role)) {
      exigerAdministrateur(etablissement, `Accorder le rôle « ${role} »`)
    }

    /*
     * Le POSTE part avec le rôle, dans la MÊME écriture.
     *
     * Deux formulaires — l'un pour le rôle, l'autre pour le poste — laissent
     * un état intermédiaire où quelqu'un est « bar » sans poste : son écran
     * se vide, et rien ne dit pourquoi. Une seule écriture rend l'état
     * impossible.
     *
     * Un rôle qui ne prépare pas repart à nul : garder le poste d'un ancien
     * cuisinier devenu caissier laisserait une donnée que plus rien
     * n'utilise, et qui reviendrait le jour où on le repasse en cuisine.
     */
    const poste = ROLES_DE_PREPARATION.includes(role)
      ? choixFacultatif(donnees, 'poste', 'Le poste', postesAutorises)
      : null

    const { count, error } = await supabase
      .from('memberships')
      .update(
        { role, station_id: poste, updated_at: new Date().toISOString() },
        { count: 'exact' },
      )
      .eq('user_id', employeId)
      .eq('restaurant_id', restaurantId)

    if (error) throw new Error(error.message)
    exigerUneLigne(count, 'Le changement de rôle')
    if (ROLES_DE_PREPARATION.includes(role) && poste === null) {
      return (
        `Rôle changé en « ${role} », mais AUCUN poste n’est choisi. ` +
        'Son écran affichera toutes les lignes du service — choisissez ' +
        'un poste pour ne lui montrer que les siennes.'
      )
    }
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
      // Sans `updated_at` : privilège de COLONNE (0014), et le déclencheur
      // `users_updated_at` s'en charge. Même cause que pour le PIN — c'est
      // ce qui faisait échouer « Suspendre » sans que rien ne l'explique.
      .update({ status: suspendre ? 'suspendu' : 'actif' }, { count: 'exact' })
      .eq('id', employeId)

    if (error) throw new Error(error.message)
    exigerUneLigne(count, 'Le changement de statut')

    return suspendre
      ? 'Employé suspendu : il ne pourra plus prendre son poste. Ses commandes passées restent lisibles.'
      : 'Employé réactivé.'
  })
}

/**
 * Retire un employé de CET établissement.
 *
 * ── Pourquoi « retirer » et non « supprimer » ─────────────────────────────
 *
 * Parce que ses ventes portent son identifiant. `orders.opened_by`,
 * `shifts.closed_by`, le journal d'audit : supprimer la personne rendrait
 * anonymes des encaissements déjà faits, et un rapport de la semaine
 * dernière afficherait « — » là où il y avait un nom. Une suspension
 * n'efface jamais rien ; un départ non plus.
 *
 * Ce qui part, c'est l'APPARTENANCE : la personne ne travaille plus ici. Elle
 * disparaît donc de la liste, ne prend plus de poste, et son PIN n'ouvre plus
 * rien — mais tout ce qu'elle a fait reste lisible. Si elle travaille dans un
 * autre établissement du groupe, elle y reste, avec son rôle là-bas.
 *
 * Et c'est réversible : réembaucher recrée l'appartenance, sans rien perdre.
 */
export async function retirerDeLEtablissement(
  restaurantId: string,
  employeId: string,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase) => {
    const { count, error } = await supabase
      .from('memberships')
      .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
      .eq('user_id', employeId)
      .eq('restaurant_id', restaurantId)
      .is('revoked_at', null)

    if (error) throw new Error(error.message)
    exigerUneLigne(count, 'Le retrait de l’établissement')

    return (
      'Employé retiré de l’établissement. Il n’apparaît plus dans la liste et ne ' +
      'peut plus prendre de poste ; ses ventes passées gardent son nom.'
    )
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
  /** Postes de l'établissement — la valeur reçue est vérifiée contre eux. */
  postesAutorises: readonly string[],
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async (supabase, etablissement) => {
    const nom = texteObligatoire(donnees, 'nom', 'Le nom', 200)
    const role = choix(donnees, 'role', 'Le rôle', ROLES)
    if (ROLES_QUI_DONNENT_LES_CLES.includes(role)) {
      exigerAdministrateur(etablissement, `Embaucher quelqu'un comme « ${role} »`)
    }
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
      // Le poste, pour un rôle qui prépare. Nul sinon : garder le poste d'un
      // caissier laisserait une donnée que plus rien n'utilise.
      station_id: ROLES_DE_PREPARATION.includes(role)
        ? choixFacultatif(donnees, 'poste', 'Le poste', postesAutorises)
        : null,
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

// ── Accès au back-office ────────────────────────────────────────────────────
//
// Ces deux actions APPELLENT le service de synchronisation ; elles ne créent
// rien elles-mêmes. C'est la conséquence directe de la règle du dépôt :
// créer un compte Supabase exige la clé `service_role`, qui contourne RLS et
// n'entre jamais dans le back-office — pas même dans ses variables
// d'environnement. Elle vit dans le service, un process serveur que personne
// ne télécharge.
//
// Ce que le back-office transmet, c'est le JETON de la session en cours. Le
// service relit les droits EN BASE : il ne croit pas le back-office sur
// parole, et un défaut ici ne peut donc pas ouvrir un accès chez un autre
// client.

/**
 * Ouvre à un employé l'accès au back-office.
 *
 * Le mot de passe est saisi par le gérant et communiqué de vive voix, comme
 * le PIN : aucun envoi d'e-mail, donc aucune dépendance à une boîte que
 * personne ne relève — le cas normal pour l'adresse d'un barman.
 */
export async function ouvrirAcces(
  restaurantId: string,
  employe: { id: string; nom: string; email: string; role: string },
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async () => {
    const email = texteObligatoire(donnees, 'email', 'L’adresse e-mail', 200)
    const motDePasse = texteObligatoire(donnees, 'motDePasse', 'Le mot de passe', 100)
    const { message } = await appelerService('/admin/comptes', {
      restaurantId,
      email,
      motDePasse,
      nom: employe.nom,
      role: employe.role,
    })
    return (
      (message ?? 'Accès ouvert.') +
      ' Communiquez le mot de passe de vive voix : il n’est ni affiché ni conservé ici.'
    )
  })
}

/**
 * Change le mot de passe de back-office d'un employé.
 *
 * C'est la réponse à « j'ai perdu le mot de passe du cuisinier ». Le PIN est
 * une autre identité, réinitialisée par le formulaire d'à côté : le PIN dit
 * QUI agit sur un terminal, le mot de passe ouvre le back-office.
 */
export async function changerMotDePasseAcces(
  restaurantId: string,
  employeId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async () => {
    const motDePasse = texteObligatoire(donnees, 'motDePasse', 'Le mot de passe', 100)
    const { message } = await appelerService('/admin/mot-de-passe', {
      restaurantId,
      employeId,
      motDePasse,
    })
    return message ?? 'Mot de passe changé.'
  })
}
