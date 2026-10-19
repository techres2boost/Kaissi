'use server'

/**
 * L'abonnement d'un navigateur aux alertes de stock.
 *
 * ── Pourquoi une Server Action ici, et pas sur la caisse ──────────────────
 *
 * La règle du dépôt interdit les Server Actions sur le CHEMIN DE LA CAISSE :
 * un aller-retour serveur rend l'encaissement inutilisable en service, et
 * impossible hors ligne. Le back-office est l'exact opposé : personne n'y
 * encaisse, et s'abonner aux notifications EXIGE le réseau de toute façon.
 *
 * ── Ce que le serveur ne voit jamais ──────────────────────────────────────
 *
 * La clé PRIVÉE VAPID reste une variable d'environnement du service de
 * synchronisation. Le back-office ne connaît que la publique, et n'envoie
 * aucune notification lui-même. Les clés `p256dh` et `auth` écrites ici sont
 * celles du NAVIGATEUR : elles ne servent qu'à chiffrer une charge pour ce
 * canal-là, et RLS les réserve à leur propriétaire (migration 0028) — un
 * caissier ne lit pas le canal du gérant.
 */

import { revalidatePath } from 'next/cache'
import { etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { appelerService } from '../../../serveur/service-sync.js'
import { ErreurSaisie } from '../../../serveur/formulaire.js'

export interface AbonnementNavigateur {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
}

export interface ResultatAbonnement {
  erreur?: string
  succes?: string
  /**
   * Après un retrait : ce navigateur reste-t-il abonné à AUTRE CHOSE ? Le
   * désabonnement du navigateur lui-même couperait aussi l'autre sujet.
   */
  restant?: boolean
}

/**
 * Ce qu'un navigateur veut recevoir : les ruptures de stock (0028), ou les
 * arrivées en préparation (0047). Un même navigateur peut vouloir les deux —
 * le gérant qui garde l'écran cuisine ouvert — d'où deux colonnes et non
 * une ligne par sujet.
 */
export type SujetAlerte = 'stock' | 'preparation'

export async function enregistrerAbonnement(
  restaurantId: string,
  abonnement: AbonnementNavigateur,
  sujet: SujetAlerte = 'stock',
): Promise<ResultatAbonnement> {
  const { session, etablissement } = await etablissementObligatoire(restaurantId)
  if (!session.employeId) {
    return { erreur: 'Ce compte n’est rattaché à aucun employé.' }
  }
  if (!abonnement.endpoint || !abonnement.p256dh || !abonnement.auth) {
    return { erreur: 'Le navigateur n’a pas fourni d’abonnement complet.' }
  }

  const supabase = await supabaseServeur()
  /*
   * Upsert sur `endpoint`, et non sur l'utilisateur.
   *
   * C'est le NAVIGATEUR qui est abonné, pas la personne : le même gérant a
   * un téléphone et un ordinateur, et couper l'un ne doit pas taire l'autre.
   * Le navigateur renouvelle parfois son endpoint tout seul ; le même
   * réémis ne doit pas créer une seconde ligne, sinon la notification
   * arriverait en double.
   */
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      organization_id: etablissement.organizationId,
      restaurant_id: restaurantId,
      user_id: session.employeId,
      endpoint: abonnement.endpoint,
      p256dh: abonnement.p256dh,
      auth: abonnement.auth,
      /*
       * On n'écrit QUE le sujet demandé : activer la cuisine ne doit pas
       * couper les ruptures d'un gérant déjà abonné. Un poste de cuisine
       * ou de bar, lui, ne reçoit pas les ruptures — elles ouvrent l'écran
       * Stock, qui lui est fermé.
       */
      ...(sujet === 'stock'
        ? { alertes_stock: true }
        : {
            alertes_preparation: true,
            ...(etablissement.preparation ? { alertes_stock: false } : {}),
          }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )

  if (error) {
    // 23505 sur `endpoint` alors que l'upsert aurait dû mettre à jour : la
    // ligne existe mais appartient à QUELQU'UN D'AUTRE, donc RLS ne la rend
    // pas. C'est le poste partagé sur lequel un collègue s'est abonné avant.
    if (error.code === '23505') {
      return {
        erreur:
          'Ce navigateur est déjà abonné avec un autre compte. Désactive les ' +
          'alertes depuis ce compte-là, ou utilise un autre navigateur.',
      }
    }
    return { erreur: `Abonnement impossible : ${error.message}` }
  }

  revalidatePath(`/${restaurantId}/${sujet === 'stock' ? 'stock' : 'preparation'}`)
  return { succes: 'Alertes activées sur ce navigateur.' }
}

export async function retirerAbonnement(
  restaurantId: string,
  endpoint: string,
  sujet: SujetAlerte = 'stock',
): Promise<ResultatAbonnement> {
  await etablissementObligatoire(restaurantId)
  const supabase = await supabaseServeur()
  // RLS borne la modification aux abonnements de l'appelant : impossible de
  // couper les alertes d'un collègue en connaissant son endpoint.
  //
  // On éteint le SUJET, puis on retire la ligne si plus rien n'y est
  // demandé : couper la cuisine ne doit pas couper les ruptures.
  const { error } = await supabase
    .from('push_subscriptions')
    .update(sujet === 'stock' ? { alertes_stock: false } : { alertes_preparation: false })
    .eq('endpoint', endpoint)
  if (error) return { erreur: `Désactivation impossible : ${error.message}` }
  const { error: erreurMenage } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('alertes_stock', false)
    .eq('alertes_preparation', false)
  if (erreurMenage) return { erreur: `Désactivation impossible : ${erreurMenage.message}` }
  const { data: reste } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
  revalidatePath(`/${restaurantId}/${sujet === 'stock' ? 'stock' : 'preparation'}`)
  return { succes: 'Alertes désactivées sur ce navigateur.', restant: (reste ?? []).length > 0 }
}

/**
 * Fait sonner CE navigateur — par le VRAI chemin des alertes.
 *
 * Le service de synchronisation envoie la notification avec SES clés, comme
 * il le fait pour une rupture. S'il ne peut pas, il dit pourquoi : clés
 * absentes, clés qui ne forment pas une paire avec celle du back-office,
 * abonnement inconnu. La clé publique du back-office part avec la demande
 * pour que le service puisse les comparer — c'est une clé PUBLIQUE.
 */
export async function envoyerNotificationTest(
  restaurantId: string,
  endpoint: string,
): Promise<ResultatAbonnement> {
  await etablissementObligatoire(restaurantId)
  try {
    const reponse = await appelerService('/admin/notification-test', {
      restaurantId,
      endpoint,
      clePublique: process.env['VAPID_PUBLIC_KEY']?.trim() || null,
    })
    const message = String(reponse.message ?? '')
    return reponse['ok'] === true ? { succes: message } : { erreur: message }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    throw erreur
  }
}
