/**
 * Session de caisse — le point de passage OBLIGÉ de toute action de caisse.
 *
 * Chaque action suit la même discipline, dans cet ordre :
 *   1. contrôle de permission ET de transition d'état ;
 *   2. écriture de l'événement dans le journal local + outbox, en UNE
 *      transaction ;
 *   3. reprojection de la commande dans `orders` / `order_items` / `payments` ;
 *   4. mise à jour de l'interface.
 *
 * L'ordre compte : afficher avant d'écrire ferait voir au caissier une vente
 * qui n'existe nulle part si l'application est tuée entre les deux.
 */

import {
  autoriser,
  autoriserRemise,
  construireTicketClient,
  construireTicketCuisine,
  pointsDeBase,
  reduireEvenements,
  transitionAutorisee,
  uuidV7,
  type ChargesUtiles,
  type ConfigCalcul,
  type Employe,
  type EnteteEtablissement,
  type EtatCommande,
  type EvenementCommande,
  type Millimes,
  type ModePaiement,
  type Permission,
  type Remise,
  type TypeCommande,
  type TypeEvenement,
} from '@kaissi/domain'
import { projeterCommande } from '@kaissi/db-local'
import { rendreTicketClient, rendreTicketCuisine } from '@kaissi/printing'
import type { ContexteApplication } from './demarrage.js'
import type { ServiceImpression } from './impression.js'

export class RefusOperation extends Error {
  constructor(
    message: string,
    readonly escaladePossible: boolean,
  ) {
    super(message)
    this.name = 'RefusOperation'
  }
}

export interface IdentiteTerminal {
  readonly organizationId: string
  readonly restaurantId: string
  readonly deviceId: string
}

export class SessionCaisse {
  private compteurLocal = 0

  constructor(
    private readonly contexte: ContexteApplication,
    private readonly identite: IdentiteTerminal,
    private readonly config: ConfigCalcul,
    private readonly etablissement: EnteteEtablissement,
    private readonly impression: ServiceImpression,
  ) {}

  // ── Fabrique d'événements ─────────────────────────────────────────────

  private async evenement<T extends TypeEvenement>(
    orderId: string,
    type: T,
    payload: ChargesUtiles[T],
    acteur: Employe | null,
  ): Promise<EvenementCommande<T>> {
    this.compteurLocal = await this.contexte.journal.prochaineSeq()
    return {
      eventId: uuidV7(),
      orderId,
      restaurantId: this.identite.restaurantId,
      organizationId: this.identite.organizationId,
      deviceId: this.identite.deviceId,
      seqDevice: this.compteurLocal,
      clientTs: new Date().toISOString(),
      serverSeq: null,
      type,
      payload,
      acteurId: acteur?.id ?? null,
    }
  }

  /**
   * Écrit les événements et reprojette. Le shift courant est passé à la
   * projection pour que la commande soit imputée à la bonne caisse.
   */
  private async appliquer(
    orderId: string,
    evenements: readonly EvenementCommande[],
  ): Promise<EtatCommande> {
    for (const e of evenements) await this.contexte.journal.ajouter(e)
    const journal = await this.contexte.journal.journalDe(orderId)
    const shiftId = (await this.contexte.etat.lire('shift_courant')) || null
    const { etat } = await projeterCommande(
      this.contexte.base.adaptateur,
      journal,
      this.config,
      { shiftId },
    )
    return etat
  }

  private garde(acteur: Employe | null, permission: Permission): void {
    if (!acteur) {
      throw new RefusOperation('Aucun employé identifié sur ce terminal.', false)
    }
    const verdict = autoriser(acteur, permission)
    if (!verdict.accorde) {
      throw new RefusOperation(verdict.motif, verdict.escaladePossible)
    }
  }

  private gardeTransition(etat: EtatCommande, type: TypeEvenement): void {
    const verdict = transitionAutorisee(etat.statut, type)
    if (!verdict.autorisee) {
      throw new RefusOperation(verdict.motif, verdict.escaladePossible)
    }
  }

  async journalDe(orderId: string): Promise<EvenementCommande[]> {
    return this.contexte.journal.journalDe(orderId)
  }

  async etatDe(orderId: string): Promise<EtatCommande> {
    return reduireEvenements(await this.contexte.journal.journalDe(orderId))
  }

  // ── Ouverture ─────────────────────────────────────────────────────────

  async ouvrirCommande(
    acteur: Employe | null,
    options: { type: TypeCommande; tableId?: string | null; couverts?: number },
  ): Promise<string> {
    this.garde(acteur, 'commande.ouvrir')
    const orderId = uuidV7()
    const numeroTicket = await this.contexte.journal.prochainNumeroTicket()
    const e = await this.evenement(
      orderId,
      'order.opened',
      {
        type: options.type,
        tableId: options.tableId ?? null,
        ouvertePar: acteur!.id,
        numeroTicket,
        couverts: options.couverts,
      },
      acteur,
    )
    await this.appliquer(orderId, [e])
    return orderId
  }

  // ── Lignes ────────────────────────────────────────────────────────────

  async ajouterLigne(
    acteur: Employe | null,
    orderId: string,
    ligne: {
      produitId: string
      variantId?: string | null
      designation: string
      quantite: number
      prixBaseMillimes: Millimes
      modificateursMillimes: Millimes
      modificateurs?: { id: string; nom: string; prixDeltaMillimes: Millimes }[]
      tauxTaxeId: string
      stationId?: string | null
      note?: string
    },
  ): Promise<EtatCommande> {
    this.garde(acteur, 'commande.ajouter_ligne')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'line.added')
    const e = await this.evenement(
      orderId,
      'line.added',
      { ligneId: uuidV7(), ...ligne },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  async changerQuantite(
    acteur: Employe | null,
    orderId: string,
    ligneId: string,
    quantite: number,
  ): Promise<EtatCommande> {
    this.garde(acteur, 'commande.ajouter_ligne')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'line.quantity_changed')
    const e = await this.evenement(
      orderId,
      'line.quantity_changed',
      { ligneId, quantite },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  /** Une annulation n'efface RIEN : elle ajoute un événement d'annulation. */
  async annulerLigne(
    acteur: Employe | null,
    orderId: string,
    ligneId: string,
    motif: string,
    autorisePar?: Employe,
  ): Promise<EtatCommande> {
    this.garde(acteur, 'commande.annuler_ligne')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'line.voided')
    const e = await this.evenement(
      orderId,
      'line.voided',
      { ligneId, motif, autorisePar: autorisePar?.id },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  async poserNote(
    acteur: Employe | null,
    orderId: string,
    ligneId: string,
    note: string,
  ): Promise<EtatCommande> {
    this.garde(acteur, 'commande.ajouter_ligne')
    const e = await this.evenement(orderId, 'line.note_set', { ligneId, note }, acteur)
    return this.appliquer(orderId, [e])
  }

  // ── Remises ───────────────────────────────────────────────────────────

  /**
   * Applique une remise. Le plafond dépend de l'employé : au-delà, le PIN
   * d'un manager est requis et son identité est consignée dans l'événement.
   */
  async appliquerRemise(
    acteur: Employe | null,
    orderId: string,
    remise: Remise,
    options: { ligneId?: string | null; autorisePar?: Employe } = {},
  ): Promise<EtatCommande> {
    if (!acteur) throw new RefusOperation('Aucun employé identifié.', false)
    const tauxBp = remise.type === 'pourcentage' ? remise.valeurBp : 0
    // Un manager qui autorise fait sauter le plafond de celui qui demande.
    const evaluateur = options.autorisePar ?? acteur
    const verdict =
      remise.type === 'pourcentage'
        ? autoriserRemise(evaluateur, tauxBp)
        : autoriser(evaluateur, 'remise.appliquer')
    if (!verdict.accorde) throw new RefusOperation(verdict.motif, verdict.escaladePossible)

    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'discount.applied')
    const e = await this.evenement(
      orderId,
      'discount.applied',
      {
        ligneId: options.ligneId ?? null,
        remise,
        autorisePar: options.autorisePar?.id ?? acteur.id,
      },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  async retirerRemise(
    acteur: Employe | null,
    orderId: string,
    ligneId?: string | null,
  ): Promise<EtatCommande> {
    this.garde(acteur, 'remise.appliquer')
    const e = await this.evenement(
      orderId,
      'discount.removed',
      { ligneId: ligneId ?? null },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  // ── Table ─────────────────────────────────────────────────────────────

  async transfererTable(
    acteur: Employe | null,
    orderId: string,
    tableId: string | null,
    motif?: string,
  ): Promise<EtatCommande> {
    this.garde(acteur, 'commande.transferer_table')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'table.moved')
    const e = await this.evenement(orderId, 'table.moved', { tableId, motif }, acteur)
    return this.appliquer(orderId, [e])
  }

  // ── Envoi en cuisine ──────────────────────────────────────────────────

  /**
   * Envoie en cuisine les lignes PAS ENCORE parties, groupées par station.
   * Réenvoyer une ligne déjà imprimée ferait préparer le plat en double :
   * `kitchen_sends` est le garde-fou.
   */
  async envoyerEnCuisine(
    acteur: Employe | null,
    orderId: string,
    stations: ReadonlyMap<string, { nom: string; hote: string | null; port: number }>,
    libelleTable: string | null,
  ): Promise<{ etat: EtatCommande; lignesEnvoyees: number; bons: number }> {
    this.garde(acteur, 'commande.envoyer_cuisine')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'order.sent')

    const dejaEnvoyees = await this.contexte.caisse.lignesDejaEnvoyees(orderId)
    const aEnvoyer = etat.lignes.filter((l) => !l.annulee && !dejaEnvoyees.has(l.id))
    if (aEnvoyer.length === 0) {
      return { etat, lignesEnvoyees: 0, bons: 0 }
    }

    const parStation = new Map<string, string[]>()
    for (const ligne of aEnvoyer) {
      const cle = ligne.stationId ?? '__sans_station__'
      const liste = parStation.get(cle) ?? []
      liste.push(ligne.id)
      parStation.set(cle, liste)
    }

    const e = await this.evenement(
      orderId,
      'order.sent',
      { stationIds: [...parStation.keys()] },
      acteur,
    )
    const nouvelEtat = await this.appliquer(orderId, [e])

    let bons = 0
    for (const [stationId, lignesId] of parStation) {
      const station = stations.get(stationId)
      const ticket = construireTicketCuisine(nouvelEtat, {
        station: station?.nom ?? 'Cuisine',
        lignesId: new Set(lignesId),
        employe: acteur?.nom ?? null,
        libelleTable,
        // Une commande déjà envoyée qui repart, c'est une tournée de plus.
        rappel: dejaEnvoyees.size > 0,
      })
      const jobId = uuidV7()
      await this.impression.mettreEnFile({
        id: jobId,
        restaurantId: this.identite.restaurantId,
        orderId,
        stationId: stationId === '__sans_station__' ? null : stationId,
        kind: 'kot',
        charge: rendreTicketCuisine(ticket),
        hote: station?.hote ?? null,
        port: station?.port,
      })
      await this.contexte.caisse.marquerEnvoyees(
        orderId,
        lignesId,
        stationId === '__sans_station__' ? null : stationId,
        jobId,
      )
      bons += 1
    }

    return { etat: nouvelEtat, lignesEnvoyees: aEnvoyer.length, bons }
  }

  // ── Encaissement ──────────────────────────────────────────────────────

  async enregistrerPaiement(
    acteur: Employe | null,
    orderId: string,
    paiement: {
      methodeId: string
      mode: ModePaiement
      montantMillimes: Millimes
      recuMillimes?: Millimes
      renduMillimes?: Millimes
      reference?: string
    },
  ): Promise<EtatCommande> {
    this.garde(acteur, 'paiement.encaisser')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'payment.recorded')
    const e = await this.evenement(
      orderId,
      'payment.recorded',
      { paiementId: uuidV7(), ...paiement },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  /**
   * Clôture la commande et met le ticket client en file d'impression.
   * L'impression n'est PAS bloquante : si l'imprimante est éteinte, la vente
   * est quand même enregistrée et le badge « ticket non imprimé » s'allume.
   */
  async cloturer(
    acteur: Employe | null,
    orderId: string,
    options: {
      readonly libellesPaiement: Readonly<Record<string, string>>
      readonly libelleTable: string | null
      readonly hoteImprimante: string | null
      readonly portImprimante?: number
      readonly ouvrirTiroir: boolean
      readonly imprimer: boolean
    },
  ): Promise<EtatCommande> {
    this.garde(acteur, 'paiement.encaisser')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'order.closed')

    const { totaux } = await projeterCommande(
      this.contexte.base.adaptateur,
      await this.contexte.journal.journalDe(orderId),
      this.config,
    )

    const e = await this.evenement(
      orderId,
      'order.closed',
      { totalMillimes: totaux.totalMillimes, closePar: acteur!.id },
      acteur,
    )
    const nouvelEtat = await this.appliquer(orderId, [e])

    if (options.imprimer) {
      const ticket = construireTicketClient(nouvelEtat, totaux, {
        etablissement: this.etablissement,
        employe: acteur?.nom ?? null,
        libelleTable: options.libelleTable,
        numeroFiscal: null,
        libellesPaiement: options.libellesPaiement,
      })
      await this.impression.mettreEnFile({
        id: uuidV7(),
        restaurantId: this.identite.restaurantId,
        orderId,
        kind: 'ticket',
        charge: rendreTicketClient(ticket, { ouvrirTiroir: options.ouvrirTiroir }),
        hote: options.hoteImprimante,
        port: options.portImprimante,
      })
    }

    return nouvelEtat
  }

  async annulerCommande(
    acteur: Employe | null,
    orderId: string,
    motif: string,
    autorisePar: Employe,
  ): Promise<EtatCommande> {
    // L'annulation d'une commande est une opération d'encadrement : c'est
    // celui qui AUTORISE qui doit en avoir le droit.
    this.garde(autorisePar, 'commande.annuler')
    if (motif.trim() === '') {
      throw new RefusOperation(
        "Une annulation exige un motif écrit : sans lui, le journal d'audit ne sert à rien.",
        false,
      )
    }
    const e = await this.evenement(
      orderId,
      'order.cancelled',
      { motif, autorisePar: autorisePar.id },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  /** Configuration de calcul effective, exposée pour l'affichage des totaux. */
  get configuration(): ConfigCalcul {
    return this.config
  }

  static tauxDepuisCatalogue(
    taxes: readonly { id: string; nom: string; tauxBp: number; incluse: boolean }[],
  ): ConfigCalcul {
    return {
      tauxTaxes: Object.fromEntries(
        taxes.map((t) => [
          t.id,
          { id: t.id, nom: t.nom, tauxBp: pointsDeBase(t.tauxBp), incluse: t.incluse },
        ]),
      ),
    }
  }
}
