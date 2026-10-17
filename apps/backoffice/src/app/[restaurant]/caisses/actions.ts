'use server'

/**
 * Paramètres → Caisses : révoquer un terminal.
 *
 * ── C'est ICI que « déconnecter la caisse » se fait, et pas sur la caisse ─
 *
 * Une tablette n'a pas de session d'utilisateur à fermer : elle porte un
 * JETON D'APPAREIL, long et révocable, qui n'est l'identité de personne
 * (CLAUDE.md, « Trois identités distinctes »). Un bouton « se déconnecter »
 * sur le terminal ne protégerait donc rien — celui qui tient la tablette
 * volée le toucherait le dernier — et il arrêterait une caisse en service
 * d'un geste, à l'endroit exact où il ne faut pas.
 *
 * La révocation vit au back-office pour la raison inverse : le gérant est
 * le seul à savoir qu'une tablette est perdue, vendue ou mise au rebut, et
 * il décide depuis un endroit où personne n'encaisse.
 *
 * ── Ce que la révocation coûte, et pourquoi l'écran le dit en gros ───────
 *
 * Elle est DÉFINITIVE : l'index unique de `devices` est partiel sur
 * `revoked_at is null` (migration 0021), donc remettre la tablette en
 * service créera un appareil de plus, avec un nouveau préfixe de tickets.
 * Et surtout, les ventes encore dans l'outbox de cette tablette ne
 * pourront plus jamais remonter : `/sync` répond 403 `appareil_revoque`, et
 * un rejet ne se réessaie jamais tout seul.
 *
 * D'où l'ordre imposé par l'écran : on regarde « Dernière synchronisation »,
 * on s'assure que la tablette n'a plus rien en attente, et on révoque
 * ensuite. Jamais l'inverse.
 */

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie } from '../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

async function agir(
  restaurantId: string,
  travail: (contexte: {
    supabase: Awaited<ReturnType<typeof supabaseServeur>>
  }) => Promise<string>,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const succes = await travail({ supabase: await supabaseServeur() })
    revalidatePath(`/${restaurantId}/caisses`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Coupe une caisse : son jeton ne vaut plus rien dès le prochain appel.
 *
 * `.is('revoked_at', null)` dans le `where` : révoquer deux fois ne
 * réécrit pas la date de la première. Ce n'est pas de la coquetterie —
 * cette date est ce qu'on lit pour savoir QUAND la tablette a été coupée,
 * et un second clic la ferait mentir.
 */
export async function revoquerCaisse(
  restaurantId: string,
  appareilId: string,
  _precedent: Resultat | null,
  _donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { data, error } = await supabase
      .from('devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', appareilId)
      .eq('restaurant_id', restaurantId)
      .is('revoked_at', null)
      .select('label')
    if (error) throw new Error(error.message)
    /*
     * Zéro ligne : la caisse était déjà révoquée, ou RLS a refusé (un rôle
     * qui n'est pas gestionnaire de CET établissement). Le dire plutôt que
     * d'annoncer un succès silencieux — c'est le même piège que partout
     * ailleurs avec la clé publique : un `where` qui ne rend rien ressemble
     * à une réussite.
     */
    if (!data || data.length === 0) {
      throw new ErreurSaisie(
        'caisse',
        'Aucune caisse révoquée : elle l’était déjà, ou votre rôle ne le permet pas.',
      )
    }
    return (
      `Caisse « ${data[0]!.label} » révoquée. Elle ne synchronisera plus, et ` +
      'ses ventes déjà remontées restent intactes.'
    )
  })
}

/**
 * Renommer une caisse — le seul autre geste de cet écran.
 *
 * Le libellé est ce qu'on lit avant de révoquer. « Terminal », « Terminal »,
 * « Terminal » obligerait à deviner laquelle des trois on coupe ; « Comptoir »
 * et « Terrasse » rendent la décision possible. Il ne change rien d'autre :
 * ni le préfixe de tickets, ni le jeton.
 */
export async function renommerCaisse(
  restaurantId: string,
  appareilId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const valeur = donnees.get('libelle')
    const libelle = (typeof valeur === 'string' ? valeur : '').trim()
    // Les bornes de la contrainte `check` du schéma (migration 0002) : les
    // refuser ici donne un message lisible au lieu d'une erreur Postgres.
    if (libelle.length < 1 || libelle.length > 100) {
      throw new ErreurSaisie('libelle', 'Le nom de la caisse doit faire entre 1 et 100 caractères.')
    }
    const { data, error } = await supabase
      .from('devices')
      .update({ label: libelle })
      .eq('id', appareilId)
      .eq('restaurant_id', restaurantId)
      .select('label')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) {
      throw new ErreurSaisie('libelle', 'Caisse introuvable — rechargez la page.')
    }
    return `Caisse renommée « ${libelle} ».`
  })
}
