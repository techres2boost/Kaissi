'use server'

/**
 * Paramètres → Reçu.
 *
 * ── Ce que cet écran a exigé avant d'exister ──────────────────────────────
 *
 * `kaissi.restaurants` portait l'adresse, le téléphone et l'identifiant
 * fiscal depuis la migration 0002 — et cette table n'avait AUCUN déclencheur
 * `change_log`. On pouvait donc y écrire une adresse que la caisse n'aurait
 * jamais vue. Personne ne l'avait signalé parce qu'aucun écran ne permettait
 * de les saisir : un réglage qu'on ne peut pas modifier ne peut pas paraître
 * cassé.
 *
 * La migration 0035 pose ce déclencheur et ajoute le pied de page ; la
 * migration locale 012 ouvre les colonnes côté caisse. Ces valeurs descendent
 * donc par le catalogue, comme un changement de prix — aucune voie de
 * synchronisation nouvelle.
 *
 * ⚠ L'identifiant fiscal et les mentions obligatoires d'un reçu tunisien
 *   restent à valider par un expert-comptable. Cet écran ouvre des champs ;
 *   il n'affirme ni leur format, ni leur obligation.
 */

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie } from '../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

/** Longueur du pied de page. Un ticket de 80 mm, ce n'est pas une page. */
const PIED_MAX = 400

/**
 * Un champ facultatif : vide devient NULL, jamais la chaîne vide.
 *
 * La différence compte pour le ticket : `null` fait disparaître la ligne,
 * `''` imprime une ligne blanche au milieu de l'en-tête.
 */
function facultatif(donnees: FormData, champ: string, libelle: string, max: number): string | null {
  const brut = String(donnees.get(champ) ?? '').trim()
  if (brut === '') return null
  if (brut.length > max) {
    throw new ErreurSaisie(champ, `${libelle} ne peut pas dépasser ${max} caractères.`)
  }
  return brut
}

export async function enregistrerRecu(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const supabase = await supabaseServeur()

    const { error } = await supabase
      .from('restaurants')
      .update({
        address: facultatif(donnees, 'adresse', 'L’adresse', 200),
        phone: facultatif(donnees, 'telephone', 'Le téléphone', 40),
        fiscal_id: facultatif(donnees, 'fiscal', 'L’identifiant fiscal', 60),
        receipt_footer: facultatif(donnees, 'pied', 'Le pied de page', PIED_MAX),
      })
      .eq('id', restaurantId)
    if (error) throw new Error(error.message)

    revalidatePath(`/${restaurantId}/recu`)
    return {
      succes:
        'Reçu mis à jour. Les caisses l’auront à leur prochaine synchronisation ; ' +
        'les tickets déjà imprimés ne changent pas.',
    }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}
