/**
 * La configuration de calcul d'un établissement, construite à UN SEUL endroit.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Trois programmes doivent calculer le même total pour la même vente : l'écran
 * de caisse, le projecteur local, et la reprojection serveur. Les trois
 * partaient des mêmes colonnes de `restaurants` — et chacun les traduisait en
 * `ConfigCalcul` à sa façon.
 *
 * On sait où cela mène, parce que c'est déjà arrivé une fois : la surcharge de
 * service portée par la commande (`service.set`) était appliquée par le
 * projecteur local et ignorée par le serveur. La tablette imprimait un ticket
 * AVEC service, le back-office affichait la même vente SANS, et rien n'échouait
 * nulle part. Deux chiffres qui ne se rejoignent jamais, et aucune alerte.
 *
 * La RÈGLE 7 le dit : les totaux se calculent à un seul endroit. Traduire des
 * colonnes en configuration EST une décision — « un service à zéro n'est pas
 * un service », « une case taxable sans taux ne taxe rien » — et une décision
 * n'a pas le droit d'exister en deux exemplaires.
 *
 * ⚠ Rien ici n'affirme de règle fiscale tunisienne. Ce module traduit ce que
 *   le gérant a saisi ; le TAUX de service, son caractère taxable et le montant
 *   du timbre restent à valider par un expert-comptable — voir la migration
 *   0036 et CLAUDE.md.
 */

import { millimes, pointsDeBase } from './monnaie.js'
import type { ConfigCalcul, TauxTaxe, Uuid } from './types.js'

/**
 * Les options de restauration, telles que les portent `kaissi.restaurants`
 * côté serveur et la table miroir `restaurants` côté caisse.
 *
 * Les noms sont ceux du DOMAINE et non ceux des colonnes : l'appelant fait la
 * correspondance, et c'est très bien — une colonne renommée doit casser chez
 * lui, pas ici.
 */
export interface OptionsRestauration {
  /** Frais de service en points de base : 10 % = 1000. Zéro = aucun service. */
  readonly tauxServiceBp?: number | null
  /** Le service est-il lui-même soumis à la taxe. */
  readonly serviceTaxable?: boolean | null
  /** Taux applicable au service. Sans lui, `serviceTaxable` n'a aucun effet. */
  readonly serviceTauxTaxeId?: Uuid | null
  /** Droit de timbre : montant FIXE ajouté au total. Zéro = aucun. */
  readonly timbreMillimes?: number | null
}

/**
 * Traduit les taux et les options d'un établissement en `ConfigCalcul`.
 *
 * Trois décisions y sont prises, et elles valent d'être écrites :
 *
 * 1. **Un service à zéro est ABSENT, pas nul.** Le domaine distingue les deux :
 *    un `service: { tauxBp: 0 }` poserait une ligne « Service 0,000 » sur
 *    chaque ticket, ce qui n'est pas la même chose que ne pas pratiquer de
 *    service. Idem pour le timbre.
 *
 * 2. **Une case « taxable » sans taux désigné ne taxe rien.** C'est la règle
 *    de `totaux.ts`, qui ne calcule la taxe du service que s'il connaît le
 *    taux — et c'est pour cela que la migration 0036 ajoute
 *    `service_tax_rate_id` plutôt que de deviner le taux par défaut. Deviner
 *    un taux applicable au service serait affirmer une règle fiscale.
 *
 * 3. **Les valeurs manquantes valent zéro, pas « inconnu ».** Une caisse dont
 *    le catalogue n'est pas encore descendu n'a pas ces colonnes : elle
 *    encaisse sans service ni timbre, ce qui est exactement ce qu'elle faisait
 *    avant la 0036. Refuser de vendre serait le pire des deux mondes.
 */
export function configEtablissement(
  taux: readonly { id: string; nom: string; tauxBp: number; incluse: boolean }[],
  options: OptionsRestauration = {},
): ConfigCalcul {
  const tauxTaxes: Record<Uuid, TauxTaxe> = Object.fromEntries(
    taux.map((t) => [
      t.id,
      { id: t.id, nom: t.nom, tauxBp: pointsDeBase(t.tauxBp), incluse: t.incluse },
    ]),
  )

  const tauxServiceBp = Number(options.tauxServiceBp ?? 0) || 0
  const timbre = Number(options.timbreMillimes ?? 0) || 0

  return {
    tauxTaxes,
    ...(tauxServiceBp > 0
      ? {
          service: {
            tauxBp: pointsDeBase(tauxServiceBp),
            taxable: Boolean(options.serviceTaxable),
            ...(options.serviceTauxTaxeId
              ? { tauxTaxeId: options.serviceTauxTaxeId }
              : {}),
          },
        }
      : {}),
    ...(timbre > 0 ? { timbreFiscalMillimes: millimes(timbre) } : {}),
  }
}
