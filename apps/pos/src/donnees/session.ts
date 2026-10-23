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
  calculerRemboursement,
  calculerTotaux,
  configEffective,
  ErreurRemboursement,
  estCommandeVide,
  ligneACompleter,
  millimes,
  paiementARembourser,
  construireTicketClient,
  configEtablissement,
  construireTicketCuisine,
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
  type OptionsRestauration,
  type Permission,
  type Remise,
  type TypeCommande,
  type TypeEvenement,
} from '@kaissi/domain'
import type { TicketClient, TicketCuisine } from '@kaissi/domain'
import { projeterCommande } from '@kaissi/db-local'
import { rendreTicketClient, rendreTicketCuisine } from '@kaissi/printing'
import { IMPRESSION_ACTIVE } from '../config.js'
import type { ContexteApplication } from './demarrage.js'
import type { ServiceImpression } from './impression.js'
import { t } from '../i18n.js'

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
    /**
     * Le pied du ticket, réglé au back-office et descendu par le catalogue
     * (migrations Postgres 0035, locale 012).
     *
     * Vide = le domaine remet « Merci de votre visite ! ». Un ticket qui se
     * termine brutalement sur un total a l'air inachevé, et le repli n'est
     * pas une opinion sur ce que le restaurateur veut écrire — c'est ce
     * qu'on met tant qu'il n'a rien écrit.
     */
    private readonly piedDePage: readonly string[] = [],
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
      throw new RefusOperation(t('Aucun employé identifié sur ce terminal.'), false)
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
      produitId: string | null
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

    /*
     * Deux touchers sur « Ojja merguez » donnent « 2 × Ojja merguez », comme
     * le bouton « + » — pas deux lignes identiques. La règle (quand on
     * complète, quand on ne complète surtout pas) est dans le domaine :
     * `ligneACompleter`.
     */
    const existante = ligneACompleter(etat.lignes, ligne, {
      deviceId: this.identite.deviceId,
      dejaEnvoyees: await this.contexte.caisse.lignesDejaEnvoyees(orderId),
    })
    if (existante) {
      this.gardeTransition(etat, 'line.quantity_changed')
      const e = await this.evenement(
        orderId,
        'line.quantity_changed',
        { ligneId: existante.id, quantite: existante.quantite + ligne.quantite },
        acteur,
      )
      return this.appliquer(orderId, [e])
    }

    const e = await this.evenement(
      orderId,
      'line.added',
      { ligneId: uuidV7(), ...ligne },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  /**
   * « + » sur une ligne du ticket.
   *
   * Tant que la ligne n'est pas partie en cuisine, c'est sa quantité qui
   * monte. Une fois partie, une ligne neuve : `kitchen_sends` ne renvoie
   * jamais une ligne déjà envoyée, et la cuisine n'aurait JAMAIS su qu'il
   * fallait un plat de plus — elle aurait servi 1 pizza sur un ticket qui en
   * facturait 2.
   */
  async augmenter(acteur: Employe | null, orderId: string, ligneId: string): Promise<EtatCommande> {
    const etat = await this.etatDe(orderId)
    const ligne = etat.lignes.find((l) => l.id === ligneId)
    if (!ligne) throw new RefusOperation(t('Cette ligne n’existe plus sur la commande.'), false)
    const envoyees = await this.contexte.caisse.lignesDejaEnvoyees(orderId)
    if (!envoyees.has(ligneId)) {
      return this.changerQuantite(acteur, orderId, ligneId, ligne.quantite + 1)
    }
    this.garde(acteur, 'commande.ajouter_ligne')
    this.gardeTransition(etat, 'line.added')
    const e = await this.evenement(
      orderId,
      'line.added',
      {
        ligneId: uuidV7(),
        produitId: ligne.produitId,
        variantId: ligne.variantId,
        designation: ligne.designation,
        quantite: 1,
        prixBaseMillimes: ligne.prixBaseMillimes,
        modificateursMillimes: ligne.modificateursMillimes,
        modificateurs: ligne.modificateurs.map((m) => ({ ...m })),
        tauxTaxeId: ligne.tauxTaxeId,
        stationId: ligne.stationId,
        ...(ligne.note ? { note: ligne.note } : {}),
      },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  /**
   * Un article à PRIX LIBRE (« divers ») : un supplément qui n'est pas à la
   * carte, saisi au montant. Sans lui, le caissier devait créer un article
   * pour un extra d'une seule fois — ou ne pas l'encaisser.
   *
   * Il passe par la même règle de calcul que les autres lignes (règle 7) :
   * seul son prix vient du caissier, la TVA vient du taux choisi. Le montant
   * est en clair sur le ticket et dans le journal : c'est ce qui le trace.
   */
  async ajouterArticleLibre(
    acteur: Employe | null,
    orderId: string,
    article: {
      designation: string
      prixMillimes: Millimes
      tauxTaxeId: string
      stationId?: string | null
    },
  ): Promise<EtatCommande> {
    if (!Number.isSafeInteger(article.prixMillimes) || article.prixMillimes <= 0) {
      throw new RefusOperation(t('Saisissez un montant supérieur à zéro.'), false)
    }
    // Une DONNÉE, pas un libellé : le ticket et le journal restent en français.
    const designation = article.designation.trim() || 'Divers'
    return this.ajouterLigne(acteur, orderId, {
      produitId: null,
      designation,
      quantite: 1,
      prixBaseMillimes: article.prixMillimes,
      modificateursMillimes: millimes(0),
      tauxTaxeId: article.tauxTaxeId,
      stationId: article.stationId ?? null,
    })
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
    if (!acteur) throw new RefusOperation(t('Aucun employé identifié.'), false)
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

  // ── Client ────────────────────────────────────────────────────────────

  /**
   * Rattache un client à la commande.
   *
   * Le NOM voyage avec l'identifiant, et c'est délibéré : le serveur le
   * recopie dans la vente (`orders.customer_name`, migration 0031). Corriger
   * une fiche l'an prochain ne doit pas réécrire un reçu déjà remis — même
   * règle que pour le libellé d'une réduction.
   *
   * Aucune permission particulière : noter à qui l'on vend fait partie de la
   * prise de commande, pas de la gestion. Ce qui est réservé, c'est de créer
   * ou modifier une FICHE, et cela se passe au back-office.
   */
  async attacherClient(
    acteur: Employe | null,
    orderId: string,
    client: { id: string; nom: string; telephone?: string | null } | null,
  ): Promise<EtatCommande> {
    if (!acteur) throw new RefusOperation(t('Aucun employé identifié.'), false)
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'customer.attached')
    // Détacher, c'est rattacher « personne » : `clientId: null`. Le domaine
    // remet alors le nom à nul avec lui.
    const e = await this.evenement(
      orderId,
      'customer.attached',
      client === null
        ? { clientId: null }
        : {
            clientId: client.id as never,
            nom: client.nom,
            telephone: client.telephone ?? undefined,
          },
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
  ): Promise<{
    etat: EtatCommande
    lignesEnvoyees: number
    bons: number
    /** Bons construits, à AFFICHER quand l'impression est éteinte. */
    tickets: readonly TicketCuisine[]
  }> {
    this.garde(acteur, 'commande.envoyer_cuisine')
    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'order.sent')

    const dejaEnvoyees = await this.contexte.caisse.lignesDejaEnvoyees(orderId)
    const aEnvoyer = etat.lignes.filter((l) => !l.annulee && !dejaEnvoyees.has(l.id))
    if (aEnvoyer.length === 0) {
      return { etat, lignesEnvoyees: 0, bons: 0, tickets: [] }
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
    const tickets: TicketCuisine[] = []
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
      tickets.push(ticket)

      // Impression éteinte (MVP) : le bon n'entre pas en file, mais l'envoi
      // reste TRACÉ dans `kitchen_sends`. C'est cette trace, et non le
      // ticket, qui interdit de préparer deux fois le même plat — et c'est
      // elle que la cuisine lit au back-office via l'événement `order.sent`.
      const jobId = IMPRESSION_ACTIVE ? uuidV7() : null
      if (jobId !== null) {
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
      }
      await this.contexte.caisse.marquerEnvoyees(
        orderId,
        lignesId,
        stationId === '__sans_station__' ? null : stationId,
        jobId,
      )
      bons += 1
    }

    return { etat: nouvelEtat, lignesEnvoyees: aEnvoyer.length, bons, tickets }
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
   * Clôture la commande et construit le ticket client.
   *
   * Le ticket est TOUJOURS construit, et rendu à l'appelant : c'est lui qui
   * décide de l'afficher, de l'imprimer, ou des deux. L'impression, quand
   * elle est allumée, n'est PAS bloquante — si l'imprimante est éteinte, la
   * vente est quand même enregistrée et le badge « ticket non imprimé »
   * s'allume. Éteinte (MVP), le ticket s'affiche à l'écran et rien n'entre
   * en file.
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
  ): Promise<{ etat: EtatCommande; ticket: TicketClient }> {
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

    const ticket = construireTicketClient(nouvelEtat, totaux, {
      etablissement: this.etablissement,
      employe: acteur?.nom ?? null,
      libelleTable: options.libelleTable,
      numeroFiscal: null,
      libellesPaiement: options.libellesPaiement,
      // Absent plutôt que vide : `construireTicketClient` distingue les deux,
      // et un tableau vide EFFACERAIT le repli du domaine au lieu de le
      // laisser jouer.
      ...(this.piedDePage.length > 0 ? { piedDePage: this.piedDePage } : {}),
    })

    if (options.imprimer && IMPRESSION_ACTIVE) {
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

    return { etat: nouvelEtat, ticket }
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
    /*
     * Une commande qui a déjà reçu de l'argent ne s'annule pas : l'annuler
     * ferait disparaître un encaissement du calcul du tiroir, et l'écart de
     * caisse du soir serait inexplicable. On l'encaisse, puis on rembourse —
     * deux événements, chacun tracé.
     */
    const etat = await this.etatDe(orderId)
    if (etat.paiements.some((p) => !p.annule)) {
      throw new RefusOperation(
        t('Cette commande a déjà reçu un paiement : encaissez le reste, puis remboursez ce qui doit l’être.'),
        false,
      )
    }
    if (motif.trim() === '') {
      throw new RefusOperation(
        t("Une annulation exige un motif écrit : sans lui, le journal d'audit ne sert à rien."),
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

  /**
   * Libère une table ouverte PAR ERREUR — sans PIN de gérant.
   *
   * PANNE OBSERVÉE : un serveur touche la mauvaise table, revient à la
   * salle ; la table restait « occupée · 0,000 TND » pour toujours, et
   * aucun bouton ne la libérait. L'annulation exige un gérant (c'est une
   * opération d'encadrement), ce qui est juste pour une commande qui a
   * porté des plats ou de l'argent — et absurde pour une table vide.
   *
   * La règle tient donc en une ligne : AUCUN article n'a jamais été saisi
   * (même retiré depuis — un plat retiré après envoi en cuisine a pu être
   * servi) et AUCUN paiement n'a été enregistré. Il n'y a alors rien à
   * protéger. Dans tous les autres cas, c'est `annulerCommande`, avec le
   * PIN d'un gérant.
   *
   * Rien n'est effacé : un `order.cancelled` de plus dans le journal, avec
   * son motif et le nom de qui a libéré la table.
   */
  async libererTableVide(acteur: Employe | null, orderId: string): Promise<EtatCommande> {
    this.garde(acteur, 'commande.ouvrir')
    const etat = await this.etatDe(orderId)
    if (!estCommandeVide(etat)) {
      throw new RefusOperation(
        t('Cette commande a déjà des articles ou un paiement : son annulation demande un gérant.'),
        true,
      )
    }
    this.gardeTransition(etat, 'order.cancelled')
    const e = await this.evenement(
      orderId,
      'order.cancelled',
      { motif: 'Table ouverte par erreur', autorisePar: acteur!.id },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  // ── Remboursement ─────────────────────────────────────────────────────

  /**
   * Rend de l'argent au client sur un ticket DÉJÀ encaissé.
   *
   * Un événement de plus, jamais une correction : le ticket reste encaissé,
   * et le journal dit désormais ce qui a été rendu. Le montant vient de
   * `calculerRemboursement` — la règle du domaine, celle que le serveur
   * applique aussi. L'écran ne calcule rien lui-même.
   *
   * Opération d'encadrement : c'est celui qui AUTORISE qui doit en avoir le
   * droit. Un caissier peut la déclencher, un gérant pose son PIN, et son
   * nom reste dans le journal.
   */
  async rembourser(
    acteur: Employe | null,
    orderId: string,
    demande: {
      readonly ligneIds: readonly string[]
      /** Unités rendues par ligne ; absente, la ligne entière (ce qui en reste). */
      readonly quantites?: Readonly<Record<string, number>>
      readonly mode: ModePaiement
      readonly motif: string
    },
    autorisePar?: Employe,
  ): Promise<EtatCommande> {
    if (!acteur) throw new RefusOperation(t('Aucun employé identifié sur ce terminal.'), false)
    this.garde(autorisePar ?? acteur, 'paiement.rembourser')
    if (demande.motif.trim() === '') {
      throw new RefusOperation(
        t('Un remboursement exige un motif : « remboursé par Ahmed » n’explique rien, « pizza froide » explique tout.'),
        false,
      )
    }

    const etat = await this.etatDe(orderId)
    this.gardeTransition(etat, 'refund.recorded')

    const totaux = calculerTotaux({
      lignes: etat.lignes,
      remiseGlobale: etat.remiseGlobale ?? undefined,
      config: configEffective(this.config, etat),
    })
    let montant: Millimes
    let quantites: Readonly<Record<string, number>>
    try {
      const calcul = calculerRemboursement(etat, totaux, demande.ligneIds, demande.quantites)
      montant = calcul.montantMillimes
      quantites = calcul.quantites
    } catch (erreur) {
      if (erreur instanceof ErreurRemboursement) throw new RefusOperation(erreur.message, false)
      throw erreur
    }

    const paiement = paiementARembourser(etat, demande.mode)
    if (!paiement) {
      throw new RefusOperation(t('Ce ticket ne porte aucun paiement : il n’y a rien à rendre.'), false)
    }

    /*
     * Des espèces rendues sortent d'un tiroir — il faut qu'il soit OUVERT.
     * Sans service en cours, l'argent quitterait une caisse que personne ne
     * compte, et l'écart de la prochaine clôture serait inexplicable.
     */
    const shiftId = (await this.contexte.etat.lire('shift_courant')) || null
    if (demande.mode === 'cash' && !shiftId) {
      throw new RefusOperation(
        t('Ouvrez la caisse avant de rendre des espèces : l’argent doit sortir d’un tiroir qu’on comptera.'),
        false,
      )
    }

    const e = await this.evenement(
      orderId,
      'refund.recorded',
      {
        remboursementId: uuidV7(),
        paiementId: paiement.paiementId,
        mode: demande.mode,
        montantMillimes: montant,
        ligneIds: [...demande.ligneIds],
        quantites: { ...quantites },
        motif: demande.motif.trim(),
        shiftId,
        ...(autorisePar ? { autorisePar: autorisePar.id } : {}),
      },
      acteur,
    )
    return this.appliquer(orderId, [e])
  }

  /** Configuration de calcul effective, exposée pour l'affichage des totaux. */
  get configuration(): ConfigCalcul {
    return this.config
  }

  /**
   * La configuration de calcul de l'établissement : ses taux, son service,
   * son timbre.
   *
   * Simple ADAPTATEUR : la traduction elle-même vit dans
   * `configEtablissement` de `@kaissi/domain`, que le serveur appelle aussi.
   * C'est volontairement une seule ligne de logique ici — la version
   * précédente de ce méthode recopiait les trois décisions (service à zéro,
   * case taxable sans taux, valeurs manquantes), et c'est exactement ce genre
   * de recopie qui avait déjà fait diverger la reprojection serveur.
   */
  static tauxDepuisCatalogue(
    taxes: readonly { id: string; nom: string; tauxBp: number; incluse: boolean }[],
    options: OptionsRestauration = {},
  ): ConfigCalcul {
    return configEtablissement(taxes, options)
  }
}
