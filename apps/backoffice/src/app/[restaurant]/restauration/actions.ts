'use server'

/**
 * Paramètres → Options de restauration.
 *
 * ── Ce que cet écran change, et jusqu'où ça va ────────────────────────────
 *
 * Il change le TOTAL. C'est le seul écran de Paramètres dont un réglage se
 * retrouve, au millime, sur le ticket que le client emporte — les taux de
 * taxe mis à part.
 *
 * La chaîne complète, pour qu'elle soit relisable :
 *
 *   ici → `kaissi.restaurants`
 *       → déclencheur `restaurants_change_log` (migration 0035)
 *       → `/sync/pull`, comme un changement de prix
 *       → table miroir `restaurants` de la caisse (migration locale 013)
 *       → `configEtablissement()` de `@kaissi/domain`
 *       → étapes 7 et 8 de `totaux.ts`.
 *
 * Le SERVEUR lit les mêmes colonnes dans `chargerConfig()` et reprojette
 * chaque vente à l'arrivée. Les deux passent par la même fonction — sans
 * quoi la tablette imprimerait un total et le back-office en afficherait un
 * autre pour la même vente, sans qu'aucune erreur ne soit levée nulle part.
 * `apps/sync/test/options-de-restauration.test.ts` l'exige au millime.
 *
 * ⚠ RIEN ICI N'AFFIRME UNE RÈGLE FISCALE TUNISIENNE. Les valeurs par défaut
 *   sont à zéro et le restent. Le droit de timbre, son application à un
 *   ticket de restaurant, et le caractère taxable des frais de service sont
 *   des questions pour un expert-comptable — pas pour une valeur par défaut
 *   « parce que c'est l'usage ». Voir CLAUDE.md, « Points à valider ».
 */

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie } from '../../../serveur/formulaire.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

/** Le champ, réduit à une chaîne — `FormData.get` rend `File | string | null`. */
function chaine(donnees: FormData, champ: string): string {
  const valeur = donnees.get(champ)
  return typeof valeur === 'string' ? valeur.trim() : ''
}

/**
 * Lit un taux saisi en clair (« 10 », « 12,5 ») en POINTS DE BASE entiers.
 *
 * RÈGLE 1 : 10 % = 1000, jamais 0.1. La même lecture que l'écran « Taxes »,
 * et pour la même raison — un flottant traînerait ensuite dans tous les
 * totaux, et l'écart ne se verrait qu'après des mois.
 */
function tauxEnPointsDeBase(donnees: FormData, champ: string): number {
  const brut = chaine(donnees, champ).replace(',', '.')
  if (brut === '') return 0
  const valeur = Number(brut)
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) {
    throw new ErreurSaisie(champ, 'Le taux de service doit être compris entre 0 et 100.')
  }
  const bp = valeur * 100
  if (Math.abs(bp - Math.round(bp)) > 1e-9) {
    throw new ErreurSaisie(
      champ,
      'Le taux ne peut pas avoir plus de deux décimales — 10 ou 12,5, pas 12,567.',
    )
  }
  return Math.round(bp)
}

/**
 * Lit un montant en dinars vers des MILLIMES entiers.
 *
 * On ne passe pas par `montantMillimes` de `serveur/formulaire.ts` : celui-ci
 * exige une valeur, et le timbre est facultatif — vide veut dire « aucun
 * timbre », ce qui est l'état par défaut et le plus fréquent. Le dinar a
 * TROIS décimales : « 0,6 » vaut 600 millimes, pas 60.
 */
function timbreMillimes(donnees: FormData, champ: string): number {
  const brut = chaine(donnees, champ).replace(',', '.')
  if (brut === '') return 0
  if (!/^\d+(\.\d{1,3})?$/.test(brut)) {
    throw new ErreurSaisie(
      champ,
      'Le timbre doit être un montant positif avec au plus trois décimales — ' +
        '« 0,600 » pour six cents millimes.',
    )
  }
  const millimes = Math.round(Number(brut) * 1000)
  if (!Number.isFinite(millimes) || millimes < 0) {
    throw new ErreurSaisie(champ, 'Le timbre ne peut pas être négatif.')
  }
  return millimes
}

export async function enregistrerOptions(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const supabase = await supabaseServeur()

    const tauxServiceBp = tauxEnPointsDeBase(donnees, 'service')
    const timbre = timbreMillimes(donnees, 'timbre')
    const taxable = donnees.get('taxable') === 'oui'
    const tauxTaxeId = chaine(donnees, 'tauxService') || null

    /*
     * ── Le refus qui évite un réglage MUET ────────────────────────────────
     *
     * Cocher « le service est taxable » sans choisir de taux ne taxe rien :
     * le domaine ne calcule la taxe du service que s'il connaît le taux
     * (migration 0036). La case resterait cochée, l'écran aurait l'air réglé,
     * et le service sortirait hors taxe pendant des mois.
     *
     * On refuse donc, plutôt que de choisir un taux à la place du gérant —
     * le taux applicable au service est une question fiscale, pas une
     * commodité d'interface.
     */
    if (taxable && !tauxTaxeId) {
      throw new ErreurSaisie(
        'tauxService',
        'Choisissez le taux applicable au service. Cocher « taxable » sans ' +
          'taux ne taxerait rien — le réglage aurait l’air fait, et le ' +
          'service sortirait hors taxe.',
      )
    }

    /*
     * Le taux n'est retenu QUE si la case l'est. Sans ce nettoyage, décocher
     * « taxable » laisserait `service_tax_rate_id` en base : la colonne
     * désignerait un taux qui ne sert plus, et la contrainte `on delete
     * restrict` de la 0036 empêcherait ensuite de supprimer ce taux — pour un
     * lien que personne ne voit plus.
     */
    const { error } = await supabase
      .from('restaurants')
      .update({
        service_rate_bp: tauxServiceBp,
        service_taxable: taxable,
        service_tax_rate_id: taxable ? tauxTaxeId : null,
        stamp_duty_millimes: timbre,
        // Pas d'`updated_at` à la main : `restaurants` porte le déclencheur
        // `restaurants_updated_at` (0003) qui le pose, et c'est lui que
        // `restaurants_change_log` journalise. L'écrire ici en plus ne
        // servirait qu'à le décaler du véritable instant d'écriture — et
        // `schema.ts` le refuse justement parce que le back-office n'en
        // dépend pas.
      })
      .eq('id', restaurantId)
    if (error) throw new Error(error.message)

    revalidatePath(`/${restaurantId}/restauration`)

    const riens = tauxServiceBp === 0 && timbre === 0
    return {
      succes: riens
        ? 'Aucun service ni timbre : les tickets portent le total des articles ' +
          'et de leurs taxes, rien de plus.'
        : 'Options enregistrées. Les caisses les appliqueront à leur prochaine ' +
          'synchronisation — les ventes DÉJÀ encaissées gardent le total ' +
          'calculé au moment de la vente.',
    }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}
