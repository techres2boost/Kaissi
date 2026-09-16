/**
 * Lire la formule de l'organisation, et refuser un module fermé.
 *
 * ── Le refus est CÔTÉ SERVEUR, comme `ecranReserve()` ─────────────────────
 *
 * Masquer une entrée de menu n'interdit rien : une URL tapée à la main rendrait
 * l'écran. C'est la même leçon que pour les rôles — les pages `ventes`,
 * `tickets` et `tableau-bord` ne vérifiaient rien, et une adresse suffisait à
 * lire le chiffre d'affaires.
 *
 * ── Ce que ce module ne fera JAMAIS ───────────────────────────────────────
 *
 * Fermer un geste de caisse. Il n'a d'ailleurs aucun moyen de le faire : le
 * POS ne lit pas ces fonctions, il est empaqueté et encaisse sans serveur. La
 * raison complète est en tête de `packages/domain/src/abonnement.ts`.
 */

import { notFound } from 'next/navigation'
import {
  debutHistorique,
  etatAbonnement,
  moduleOuvert,
  type EtatAbonnement,
  type ModulePayant,
} from '@kaissi/domain'
import { journeeCourante } from './journee.js'
import { supabaseServeur } from './supabase.js'

/**
 * L'état de la formule d'une organisation.
 *
 * Une organisation SANS ligne d'abonnement retombe au gratuit : c'est ce que
 * fait `etatAbonnement(null)`. Le cas ne devrait pas exister — la migration
 * 0040 en pose une pour chaque organisation — mais lui donner le payant
 * « parce que la ligne manque » ouvrirait tout au premier trou de données.
 */
export async function abonnementDe(organizationId: string): Promise<EtatAbonnement> {
  const supabase = await supabaseServeur()
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, trial_ends_at')
    .eq('organization_id', organizationId)
    .maybeSingle()

  return etatAbonnement(
    data ? { plan: data.plan as string, finEssai: (data.trial_ends_at as string | null) ?? null } : null,
  )
}

/**
 * Refuse l'écran si le module n'est pas ouvert.
 *
 * `notFound()` plutôt qu'un « accès refusé », pour la raison déjà retenue sur
 * l'écran Administration : annoncer un refus, c'est apprendre qu'il y a
 * quelque chose derrière. Ici la nuance compte moins — le client SAIT que
 * l'inventaire avancé existe, on le lui vend — mais un 404 reste plus
 * honnête qu'une page à moitié vide.
 *
 * L'appelant affiche l'invitation à s'abonner AVANT d'appeler ceci, sur un
 * écran prévu pour ça. On ne laisse pas une garde technique tenir lieu
 * d'argumentaire commercial.
 */
export function exigerModule(etat: EtatAbonnement, module: ModulePayant): void {
  if (!moduleOuvert(etat, module)) notFound()
}

/**
 * La journée la plus ANCIENNE que la formule laisse consulter.
 *
 * Rendue en journée commerciale « AAAA-MM-JJ », parce que c'est l'unité des
 * périodes de rapport. `debutHistorique()` rend un instant ; le convertir
 * ici, une fois, évite que chaque écran choisisse son fuseau — et à Tunis,
 * l'écart avec UTC suffit à faire basculer une borne d'un jour.
 *
 * `null` quand la formule ne limite rien. C'est le cas de `pro` et de l'essai
 * en cours, donc de la quasi-totalité des lectures : la requête
 * supplémentaire ne coûte qu'une fois par page, sur la fiche.
 */
export async function plancherHistorique(
  organizationId: string,
  timezone: string,
  bascule: string,
): Promise<string | null> {
  const etat = await abonnementDe(organizationId)
  const debut = debutHistorique(etat)
  return debut === null ? null : journeeCourante(timezone, bascule, debut)
}
