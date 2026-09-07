'use server'

/**
 * Ouvrir un nouvel établissement.
 *
 * ── Pourquoi cet écran n'est pas sous `/‹resto›/` ─────────────────────────
 *
 * Parce qu'il ne parle d'AUCUN établissement en particulier. Le ranger sous
 * l'un d'eux laisserait croire qu'on crée « un restaurant de ce
 * restaurant-là », et obligerait à en choisir un avant de pouvoir en ouvrir
 * un autre.
 *
 * ── Pourquoi il passe par le service ──────────────────────────────────────
 *
 * La toute PREMIÈRE appartenance à un établissement ne peut pas être créée
 * sous RLS : il faudrait déjà y appartenir pour s'y rattacher. Un restaurant
 * créé sans appartenance serait invisible de tout le monde, y compris de son
 * auteur — et irrattrapable depuis l'interface. C'est le service de
 * synchronisation, qui parle à Postgres avec un rôle privilégié, qui pose les
 * deux d'un coup, dans une transaction.
 *
 * Le service ne croit pas cet écran sur parole : il relit en base que
 * l'appelant est bien ADMINISTRATEUR quelque part, et dérive l'organisation
 * de là. Un identifiant d'organisation transmis par le client serait un
 * moyen d'ouvrir un établissement chez un autre client.
 */

import { revalidatePath } from 'next/cache'
import { sessionObligatoire } from '../../serveur/session.js'
import { appelerService } from '../../serveur/service-sync.js'
import { ErreurSaisie, texteObligatoire } from '../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
  /** L'établissement tout juste créé, pour y aller d'un clic. */
  restaurantId?: string
}

/** Les fuseaux qu'un restaurant tunisien peut légitimement vouloir. */
export const FUSEAUX = ['Africa/Tunis', 'Africa/Algiers', 'Africa/Casablanca', 'Europe/Paris']

export async function ouvrirEtablissement(
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const session = await sessionObligatoire()
    /*
     * Le contrôle est refait CÔTÉ SERVICE, et c'est lui qui décide.
     *
     * Celui-ci ne sert qu'à rendre un message clair au lieu d'un 401 sec :
     * masquer un formulaire n'interdit rien, et un contrôle d'interface
     * n'est jamais une autorisation.
     */
    if (!session.etablissements.some((e) => e.administrateur)) {
      return {
        erreur:
          'Seul un administrateur peut ouvrir un établissement. Un gérant exploite le sien ; ' +
          'ouvrir un second est une décision qui distribue des pouvoirs.',
      }
    }

    const nom = texteObligatoire(donnees, 'nom', "Le nom de l'établissement", 200)
    const modeleRestaurantId = String(donnees.get('modele') ?? '')
    const timezone = String(donnees.get('timezone') ?? 'Africa/Tunis')
    const bascule = String(donnees.get('bascule') ?? '04:00')

    if (!FUSEAUX.includes(timezone)) {
      throw new ErreurSaisie('timezone', 'Fuseau horaire inconnu.')
    }
    if (!/^\d{2}:\d{2}$/.test(bascule)) {
      throw new ErreurSaisie('bascule', 'L’heure de bascule s’écrit « 04:00 ».')
    }

    const reponse = (await appelerService('/admin/restaurants', {
      nom,
      modeleRestaurantId,
      timezone,
      bascule,
    })) as { message?: string; restaurantId?: string }

    // La liste des établissements de la session est lue à chaque page ; le
    // cache de la racine, lui, garderait l'ancienne.
    revalidatePath('/')
    revalidatePath('/administration')
    return {
      succes: reponse.message ?? 'Établissement ouvert.',
      ...(reponse.restaurantId ? { restaurantId: reponse.restaurantId } : {}),
    }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}
