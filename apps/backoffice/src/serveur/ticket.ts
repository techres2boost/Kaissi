/**
 * Le ticket d'une vente, reconstruit DEPUIS LE JOURNAL.
 *
 * ── Pourquoi pas depuis la projection ─────────────────────────────────────
 *
 * `orders` et `order_items` contiennent déjà tout ce qu'il faudrait pour
 * dessiner un ticket. Mais un ticket dessiné à partir d'eux serait un
 * DEUXIÈME gabarit, écrit ici, à côté de celui de la caisse — et deux
 * gabarits divergent au premier changement. Le jour où un client conteste un
 * montant, on lui présenterait un document qui ne ressemble pas à celui qu'il
 * a en main.
 *
 * On repart donc de `order_events`, la source de vérité, et on passe par
 * exactement la même chaîne que le POS :
 *
 *     order_events → reduireEvenements → calculerTotaux
 *                  → construireTicketClient → rendreTicketClient → apercuTexte
 *
 * Le résultat est le texte que l'imprimante sortirait, au caractère près.
 * Brancher l'imprimante un jour ne changera rien à ce que montre cet écran.
 *
 * ── Ce que cela garantit, et ce que cela coûte ────────────────────────────
 *
 * Garantie : le back-office ne peut pas afficher un total différent de celui
 * du ticket client, parce qu'il ne les calcule pas séparément — il rejoue le
 * même journal avec le même code (RÈGLE 7).
 *
 * Coût : une lecture de plus, et le calcul des totaux à l'affichage. C'est
 * une page consultée quelques fois par jour, sur une commande à la fois.
 * L'échange est évident dans ce sens-là.
 */

import {
  construireTicketClient,
  millimes,
  reconstruireCommande,
  type ConfigCalcul,
  type EvenementCommande,
  type PointsDeBase,
  type TicketClient,
  type Uuid,
} from '@kaissi/domain'
import { apercuTexte, rendreTicketClient } from '@kaissi/printing'
import { supabaseServeur } from './supabase.js'

export interface TicketReconstruit {
  readonly ticket: TicketClient
  /** Le rendu texte — ce que l'imprimante sortirait, au caractère près. */
  readonly apercu: string
}

/** Une commande dont on ne peut pas reconstruire le ticket, et pourquoi. */
export interface EchecTicket {
  readonly erreur: string
}

/**
 * Reconstruit le ticket d'une commande.
 *
 * Rend un motif d'échec plutôt que de lancer : une page de consultation ne
 * doit pas tomber entière parce qu'un ticket est illisible — le reste de
 * l'écran, la liste des ventes, garde sa valeur.
 */
export async function reconstruireTicket(
  restaurantId: string,
  orderId: string,
): Promise<TicketReconstruit | EchecTicket> {
  const supabase = await supabaseServeur()

  const [evenementsRes, tauxRes, restaurantRes, methodesRes] = await Promise.all([
    supabase
      .from('order_events')
      .select(
        'event_id, order_id, organization_id, restaurant_id, device_id, seq_device, server_seq, type, payload, actor_user_id, client_ts',
      )
      .eq('restaurant_id', restaurantId)
      .eq('order_id', orderId)
      // `server_seq` et jamais `client_ts` : c'est l'ordre d'ARRIVÉE qui fait
      // foi, les horloges des tablettes dérivent (RÈGLE 4).
      .order('server_seq', { ascending: true }),
    supabase
      .from('tax_rates')
      .select('id, name, rate_bp, is_included')
      .eq('restaurant_id', restaurantId)
      .is('archived_at', null),
    supabase
      .from('restaurants')
      .select('name, service_rate_bp, stamp_duty_millimes')
      .eq('id', restaurantId)
      .maybeSingle(),
    supabase
      .from('payment_methods')
      .select('id, name')
      .eq('restaurant_id', restaurantId),
  ])

  if (evenementsRes.error) {
    return { erreur: `Journal illisible : ${evenementsRes.error.message}` }
  }
  const brut = evenementsRes.data ?? []
  if (brut.length === 0) {
    // Deux causes possibles, et le message ne prétend pas trancher : une
    // commande d'un autre établissement (RLS ne rend rien, ce qui est le
    // comportement voulu) ou un identifiant inexistant.
    return { erreur: 'Aucun événement pour cette commande.' }
  }

  const evenements = brut.map(
    (l) =>
      ({
        eventId: l.event_id,
        orderId: l.order_id,
        organizationId: l.organization_id,
        restaurantId: l.restaurant_id,
        deviceId: l.device_id,
        seqDevice: Number(l.seq_device),
        serverSeq: l.server_seq === null ? null : Number(l.server_seq),
        type: l.type,
        payload: l.payload,
        acteurId: l.actor_user_id,
        clientTs: l.client_ts,
      }) as EvenementCommande,
  )

  const serviceBp = Number(restaurantRes.data?.service_rate_bp ?? 0)
  const config: ConfigCalcul = {
    tauxTaxes: Object.fromEntries(
      (tauxRes.data ?? []).map((t) => [
        t.id,
        {
          id: t.id as Uuid,
          nom: t.name as string,
          tauxBp: t.rate_bp as PointsDeBase,
          incluse: Boolean(t.is_included),
        },
      ]),
    ),
    // Service et timbre viennent de l'ÉTABLISSEMENT, comme sur la caisse.
    // Les omettre donnerait un total inférieur à celui payé par le client.
    ...(serviceBp > 0 ? { service: { tauxBp: serviceBp as PointsDeBase, taxable: false } } : {}),
    // `millimes()` et non un `as` : la marque de type existe justement pour
    // qu'un nombre brut ne se glisse pas dans un montant (RÈGLE 1).
    timbreFiscalMillimes: millimes(Number(restaurantRes.data?.stamp_duty_millimes ?? 0)),
  }

  /*
   * `reconstruireCommande` et non la réduction suivie du calcul à la main.
   *
   * Elle fait exactement ce travail — ET une chose de plus qu'on aurait
   * oubliée : la configuration de service portée par la COMMANDE
   * (`service.set`) prime sur celle de l'établissement. Un serveur peut
   * retirer le service sur une commande à emporter ; recalculer sans en
   * tenir compte rajouterait un service que le client n'a pas payé.
   */
  const { etat, totaux } = reconstruireCommande(evenements, config)

  const ticket = construireTicketClient(etat, totaux, {
    etablissement: {
      nom: restaurantRes.data?.name ?? 'Kaissi',
      adresse: null,
      telephone: null,
      // ⚠ Mentions fiscales à faire valider par un expert-comptable tunisien.
      identifiantFiscal: null,
    },
    // Le nom de l'employé est résolu par l'appelant, qui a déjà la table des
    // employés en mémoire : le refaire ici ajouterait une requête par ticket.
    employe: null,
    libelleTable: null,
    numeroFiscal: null,
    libellesPaiement: Object.fromEntries(
      (methodesRes.data ?? []).map((m) => [m.id as Uuid, m.name as string]),
    ),
  })

  return {
    ticket,
    // 42 colonnes = papier 80 mm, la largeur nominale du produit. Le POS
    // affiche la même, et les deux doivent rester alignées : un aperçu à 32
    // colonnes couperait des lignes que le papier ne coupe pas.
    apercu: apercuTexte(rendreTicketClient(ticket), 42),
  }
}
