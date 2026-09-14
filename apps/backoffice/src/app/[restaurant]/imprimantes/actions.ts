'use server'

/**
 * Paramètres → Imprimantes cuisine.
 *
 * ── Ce que cet écran règle, et ce qu'il ne règle PAS ──────────────────────
 *
 * Il règle UNE chose : à quelle adresse réseau chaque poste de préparation
 * envoie ses bons. Le poste lui-même — son nom, sa création, son archivage —
 * se règle dans « Catégories », parce que c'est là qu'on lui rattache ce
 * qu'il prépare, et qu'un poste sans catégorie ne recevra jamais rien.
 *
 * Séparer les deux n'est pas un choix de rangement : ce sont deux gestes à
 * des moments différents. On crée un poste quand on réorganise sa carte ; on
 * ressaisit une adresse quand une imprimante a été remplacée, un mardi, en
 * plein service.
 *
 * ── Pourquoi l'adresse vit en base, et pas dans un fichier ────────────────
 *
 * Elle descend aux caisses par `change_log`, comme un prix (migrations 0003
 * et 0005 : `stations` est dans la liste journalisée depuis l'origine).
 * Aucune voie de synchronisation nouvelle, et surtout : le jour où
 * l'imprimante de la cuisine est remplacée, c'est le gérant qui ressaisit
 * l'adresse depuis le back-office, pas nous depuis une console SQL.
 *
 * Corollaire assumé : une adresse saisie sur la TABLETTE (l'écran Diagnostic
 * du POS l'autorise, `depotStations.definirImprimante`) est écrasée à la
 * synchronisation suivante par celle d'ici. C'est voulu — deux tablettes du
 * même restaurant ne doivent pas imprimer à deux endroits différents.
 */

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie } from '../../../serveur/formulaire.js'
// Un module « use server » ne peut EXPORTER que des fonctions async : le port
// par défaut vit donc à côté. Voir `port.ts`.
import { PORT_PAR_DEFAUT } from './port.js'

/**
 * Le champ, réduit à une chaîne.
 *
 * `FormData.get` rend `File | string | null` : un `String(...)` direct
 * transformerait un fichier en « [object File] », qui passerait ensuite
 * toutes les validations ci-dessous comme un nom d'hôte ordinaire. C'est la
 * même précaution que `brut()` dans `serveur/formulaire.ts` — non exportée
 * de là-bas, d'où cette copie de trois lignes plutôt qu'un détour.
 */
function chaine(donnees: FormData, champ: string): string {
  const valeur = donnees.get(champ)
  return typeof valeur === 'string' ? valeur.trim() : ''
}

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
    revalidatePath(`/${restaurantId}/imprimantes`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/**
 * Lit une adresse d'imprimante — et REFUSE les trois formes qu'on tape par
 * réflexe, en disant chaque fois laquelle corriger.
 *
 * Le schéma ne contraint que le PORT (`between 1 and 65535`, migration 0003) ;
 * `printer_host` est un `text` libre. Sans ce contrôle, « http://192.168.1.50 »
 * et « 192.168.1.50:9100 » s'enregistrent tous les deux sans broncher, et le
 * bon de cuisine ne part jamais — le jour où l'impression est allumée, en
 * plein service, sans que rien nulle part ne dise pourquoi.
 */
function hoteImprimante(donnees: FormData, champ: string): string | null {
  const valeur = chaine(donnees, champ)
  // Vide = pas d'imprimante sur ce poste. C'est un état LÉGITIME, pas une
  // saisie incomplète : un poste peut n'exister que pour l'écran de
  // préparation du back-office.
  if (valeur === '') return null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(valeur)) {
    throw new ErreurSaisie(
      champ,
      'Une imprimante n’est pas une page web : saisissez « 192.168.1.50 », ' +
        'sans « http:// ». La caisse lui parle directement, en ESC/POS.',
    )
  }
  if (valeur.includes(':')) {
    throw new ErreurSaisie(
      champ,
      'Pas de port dans l’adresse : « 192.168.1.50 » ici, et le numéro de ' +
        'port dans le champ d’à côté.',
    )
  }
  if (valeur.includes('/') || /\s/.test(valeur)) {
    throw new ErreurSaisie(
      champ,
      'Ni espace ni « / » : c’est une adresse IP ou un nom d’hôte, comme ' +
        '« 192.168.1.50 » ou « cuisine.local ».',
    )
  }
  if (valeur.length > 253) {
    throw new ErreurSaisie(champ, 'L’adresse ne peut pas dépasser 253 caractères.')
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(valeur)) {
    throw new ErreurSaisie(
      champ,
      'L’adresse ne peut contenir que des lettres, des chiffres, des points ' +
        'et des tirets.',
    )
  }
  return valeur
}

function portImprimante(donnees: FormData, champ: string): number {
  const valeur = chaine(donnees, champ)
  if (valeur === '') return PORT_PAR_DEFAUT
  const nombre = Number(valeur)
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 65535) {
    throw new ErreurSaisie(
      champ,
      'Le port doit être un entier entre 1 et 65535. Une imprimante réseau ' +
        `écoute presque toujours sur ${PORT_PAR_DEFAUT}.`,
    )
  }
  return nombre
}

export async function definirImprimante(
  restaurantId: string,
  posteId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const hote = hoteImprimante(donnees, 'hote')
    const port = portImprimante(donnees, 'port')

    const { error } = await supabase
      .from('stations')
      .update({
        printer_host: hote,
        printer_port: port,
        // `stations` a bien un déclencheur `touche_updated_at` (0003), mais on
        // pose l'horodatage explicitement comme partout ailleurs ici : c'est
        // lui que `change_log` fait descendre, et s'en remettre au déclencheur
        // rendrait la descente dépendante d'un détail de schéma invisible
        // depuis ce fichier.
        updated_at: new Date().toISOString(),
      })
      .eq('id', posteId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(error.message)

    return hote === null
      ? 'Imprimante retirée de ce poste. Ses bons ne partiront plus nulle part ' +
          '— ils restent lisibles sur l’écran de préparation.'
      : `Imprimante réglée sur ${hote}:${port}. Les caisses l’auront à leur ` +
          'prochaine synchronisation, comme un changement de prix.'
  })
}
