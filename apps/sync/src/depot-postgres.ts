/**
 * Dépôt de synchronisation — implémentation PostgreSQL.
 *
 * Deux points structurants :
 *
 * 1. **Le service emprunte le rôle `kaissi_device`** et pose le contexte
 *    d'appareil en variables de session. Toutes les requêtes passent donc
 *    par RLS, comme si l'appareil parlait directement à la base. Un défaut
 *    de filtrage applicatif ne peut pas provoquer de fuite entre deux
 *    restaurants : la base refuserait.
 *
 * 2. **L'insertion d'un lot est UNE transaction.** Soit tout le lot entre,
 *    soit rien. Un lot à moitié appliqué laisserait une commande dans un
 *    état que personne ne sait reconstruire.
 */

import { Pool, type PoolClient } from 'pg'
import {
  calculerTotaux,
  reduireEvenements,
  totalVerse,
  type ConfigCalcul,
  type EvenementCommande,
  type PointsDeBase,
} from '@kaissi/domain'
import { estUuid } from '@kaissi/domain'
import type {
  AbonnementPush,
  AppareilAuthentifie,
  AppareilEnrole,
  DemandeEnrolement,
  DepotSync,
  EtablissementEnrolable,
  ProduitEnAlerte,
  ResultatInsertion,
} from './depot.js'
import type { ChangementCatalogue, ShiftSynchronise } from './protocole.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ReglageSsl } from './ssl.js'

/**
 * Ne garde que les identifiants réellement au format UUID.
 *
 * Sans ce filtre, un appareil défectueux — ou hostile — qui envoie un
 * `event_id` vide fait échouer le cast `::uuid[]` et le serveur répond 500
 * sur TOUT le lot. Or un identifiant mal formé doit produire un rejet
 * propre, pas une panne : les autres ventes du même lot n'y sont pour rien.
 */
function uuidsValides(valeurs: readonly string[]): string[] {
  return valeurs.filter((v) => typeof v === 'string' && estUuid(v))
}

export interface OptionsDepot {
  /** Chaîne complète — ou les champs séparés ci-dessous, jamais les deux. */
  readonly connectionString?: string
  readonly host?: string
  readonly port?: number
  readonly database?: string
  readonly user?: string
  readonly password?: string
  readonly max?: number
  /**
   * `false` en test local : le Postgres de test n'a pas de TLS.
   * Sinon, le réglage rendu par `sslDepuisEnvironnement()`.
   */
  readonly ssl?: boolean | ReglageSsl
}

export class DepotPostgres implements DepotSync {
  private readonly pool: Pool

  constructor(options: OptionsDepot) {
    // `connectionString` n'est passée QUE si elle existe : `pg` la
    // ré-analyse et écraserait les champs séparés, mot de passe compris.
    this.pool = new Pool({
      ...(options.connectionString
        ? { connectionString: options.connectionString }
        : {
            host: options.host,
            port: options.port,
            database: options.database,
            user: options.user,
            password: options.password,
          }),
      max: options.max ?? 10,
      ssl:
        options.ssl === false
          ? false
          : options.ssl === true || options.ssl === undefined
            ? { rejectUnauthorized: true }
            : options.ssl,
      // Une requête de sync qui dépasse dix secondes est une requête cassée :
      // mieux vaut la couper que laisser la connexion occupée.
      statement_timeout: 10_000,
    })
  }

  /**
   * Vérifie que la base répond VRAIMENT.
   *
   * Appelée au démarrage et par `/sante`. Sans elle, l'API annonçait « ok »
   * sans avoir jamais ouvert une connexion : une chaîne fausse, un mot de
   * passe périmé ou un certificat refusé ne se voyaient qu'au premier
   * encaissement d'une tablette — c'est-à-dire au pire moment.
   */
  async verifier(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('select 1')
    } finally {
      client.release()
    }
  }

  /**
   * Exécute un travail sous l'identité de l'appareil.
   * `set local` : le contexte disparaît à la fin de la transaction, donc
   * une connexion rendue au pool ne garde jamais l'identité du précédent.
   */
  private async sousIdentite<T>(
    appareil: AppareilAuthentifie,
    travail: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('set local role kaissi_device')
      await client.query('select set_config($1, $2, true)', [
        'kaissi.device_id',
        appareil.deviceId,
      ])
      await client.query('select set_config($1, $2, true)', [
        'kaissi.restaurant_id',
        appareil.restaurantId,
      ])
      await client.query('select set_config($1, $2, true)', [
        'kaissi.organization_id',
        appareil.organizationId,
      ])
      const resultat = await travail(client)
      await client.query('commit')
      return resultat
    } catch (erreur) {
      await client.query('rollback').catch(() => undefined)
      throw erreur
    } finally {
      client.release()
    }
  }

  async etablissementsEnrolables(userId: string): Promise<EtablissementEnrolable[]> {
    const { rows } = await this.pool.query<{
      restaurant_id: string
      organization_id: string
      nom: string
      role: string
    }>(
      // On entre par `auth_user_id`, JAMAIS par `users.id`.
      //
      // Depuis la migration 0017 les deux identités sont distinctes : un
      // serveur en salle a une ligne `users` sans compte de connexion. Le
      // compte Supabase ne désigne donc l'employé que par `auth_user_id`.
      // Comparer avec `memberships.user_id` ne rendrait aucune ligne — et
      // l'appairage refuserait un gérant parfaitement légitime.
      `select m.restaurant_id, m.organization_id, r.name as nom, m.role
         from kaissi.users u
         join kaissi.memberships m on m.user_id = u.id
         join kaissi.restaurants r on r.id = m.restaurant_id
        where u.auth_user_id = $1
          and u.status = 'actif'
          and m.revoked_at is null
          and m.role in ('admin', 'gerant')
        order by r.name`,
      [userId],
    )
    return rows.map((l) => ({
      restaurantId: l.restaurant_id,
      organizationId: l.organization_id,
      nom: l.nom,
      role: l.role,
    }))
  }

  async enrolerAppareil(demande: DemandeEnrolement): Promise<AppareilEnrole> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')

      const { rows: restos } = await client.query<{ organization_id: string; nom: string }>(
        'select organization_id, name as nom from kaissi.restaurants where id = $1',
        [demande.restaurantId],
      )
      const resto = restos[0]
      if (!resto) throw new Error(`Établissement ${demande.restaurantId} introuvable.`)

      // Le préfixe est verrouillé POUR TOUT L'ÉTABLISSEMENT le temps de la
      // transaction. Deux tablettes qui s'enrôlent à la même seconde
      // choisiraient sinon le même « P2 » — et deux tickets différents
      // porteraient le même numéro.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `kaissi:prefixe:${demande.restaurantId}`,
      ])

      const jeton = `kdev_${randomBytes(32).toString('base64url')}`
      const empreinte = createHash('sha256').update(jeton, 'utf8').digest('hex')

      // ── Ce terminal est-il DÉJÀ connu ? ───────────────────────────────
      //
      // C'est toute la différence entre « une caisse » et « une caisse de
      // plus à chaque connexion ». On ne cherche que parmi les appareils
      // ACTIFS : une révocation est définitive, se réappairer ne l'annule
      // pas (l'index unique de la 0021 est partiel pour la même raison).
      const { rows: connus } = demande.installationId
        ? await client.query<{ id: string; ticket_prefix: string }>(
            `select id, ticket_prefix from kaissi.devices
              where restaurant_id = $1 and installation_id = $2
                and revoked_at is null`,
            [demande.restaurantId, demande.installationId],
          )
        : { rows: [] }

      const connu = connus[0]
      if (connu) {
        // On fait tourner le jeton et RIEN d'autre.
        //
        // Le `label` n'est PAS réécrit : le gérant a pu renommer l'appareil
        // en « Caisse bar » depuis le back-office, et le POS envoie toujours
        // le même libellé générique. Écraser son choix à chaque reconnexion
        // rendrait le renommage impossible à conserver.
        //
        // Le préfixe de tickets ne bouge pas non plus : c'est ce qui garantit
        // qu'une même caisse ne se remette pas à numéroter à partir de 1.
        await client.query(
          `update kaissi.devices
              set token_hash = $2, protocol_version = 1, updated_at = now()
            where id = $1`,
          [connu.id, empreinte],
        )
        await client.query(
          `insert into kaissi.device_pairings
             (organization_id, restaurant_id, device_id, token_hash)
           values ($1,$2,$3,$4)`,
          [resto.organization_id, demande.restaurantId, connu.id, empreinte],
        )
        await client.query('commit')

        return {
          deviceId: connu.id,
          restaurantId: demande.restaurantId,
          organizationId: resto.organization_id,
          nomEtablissement: resto.nom,
          prefixe: connu.ticket_prefix,
          jeton,
          reprise: true,
        }
      }

      const prefixe = demande.prefixe ?? (await prochainPrefixeLibre(client, demande.restaurantId))
      const deviceId = randomUUID()

      await client.query(
        `insert into kaissi.devices
           (id, organization_id, restaurant_id, label, type, ticket_prefix,
            token_hash, protocol_version, installation_id)
         values ($1,$2,$3,$4,'pos',$5,$6,1,$7)`,
        [
          deviceId,
          resto.organization_id,
          demande.restaurantId,
          demande.libelle,
          prefixe,
          empreinte,
          demande.installationId ?? null,
        ],
      )
      await client.query(
        `insert into kaissi.device_pairings
           (organization_id, restaurant_id, device_id, token_hash)
         values ($1,$2,$3,$4)`,
        [resto.organization_id, demande.restaurantId, deviceId, empreinte],
      )
      await client.query('commit')

      return {
        deviceId,
        restaurantId: demande.restaurantId,
        organizationId: resto.organization_id,
        nomEtablissement: resto.nom,
        prefixe,
        jeton,
        reprise: false,
      }
    } catch (erreur) {
      await client.query('rollback').catch(() => {})
      throw erreur
    } finally {
      client.release()
    }
  }

  async appareilParJeton(empreinte: string): Promise<AppareilAuthentifie | null> {
    // Recherche par empreinte AVANT d'avoir une identité : c'est la seule
    // requête qui ne peut pas passer par RLS, puisqu'elle établit l'identité.
    const { rows } = await this.pool.query<{
      id: string
      restaurant_id: string
      organization_id: string
      revoked_at: string | null
      protocol_version: number
    }>(
      `select id, restaurant_id, organization_id, revoked_at, protocol_version
       from kaissi.devices where token_hash = $1`,
      [empreinte],
    )
    const ligne = rows[0]
    if (!ligne) return null
    return {
      deviceId: ligne.id,
      restaurantId: ligne.restaurant_id,
      organizationId: ligne.organization_id,
      revoque: ligne.revoked_at !== null,
      protocolVersion: ligne.protocol_version,
    }
  }

  async evenementsConnus(
    restaurantId: string,
    eventIds: readonly string[],
  ): Promise<Set<string>> {
    const propres = uuidsValides(eventIds)
    if (propres.length === 0) return new Set()
    const { rows } = await this.pool.query<{ event_id: string }>(
      `select event_id from kaissi.order_events
       where restaurant_id = $1 and event_id = any($2::uuid[])`,
      [restaurantId, propres],
    )
    return new Set(rows.map((r) => r.event_id))
  }

  async insererEvenements(
    appareil: AppareilAuthentifie,
    evenements: readonly EvenementCommande[],
    batchId: string,
  ): Promise<ResultatInsertion> {
    return this.sousIdentite(appareil, async (client) => {
      const inseres: string[] = []
      const doublons: string[] = []

      for (const e of evenements) {
        // `on conflict do nothing` + `returning` : la ligne ne revient QUE
        // si elle a été réellement insérée. C'est la garantie d'idempotence
        // (RÈGLE 5) exprimée en une seule requête, sans lecture préalable
        // qui ouvrirait une fenêtre de concurrence.
        const { rows } = await client.query<{ server_seq: string }>(
          `insert into kaissi.order_events
             (event_id, order_id, organization_id, restaurant_id, device_id,
              seq_device, type, payload, actor_user_id, client_ts, protocol_version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (event_id) do nothing
           returning server_seq`,
          [
            e.eventId,
            e.orderId,
            e.organizationId,
            e.restaurantId,
            e.deviceId,
            e.seqDevice,
            e.type,
            JSON.stringify(e.payload),
            e.acteurId ?? null,
            e.clientTs,
            1,
          ],
        )
        if (rows.length > 0) inseres.push(e.eventId)
        else doublons.push(e.eventId)

        await client.query(
          `insert into kaissi.sync_mutations
             (event_id, organization_id, restaurant_id, device_id, batch_id, status)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (event_id) do nothing`,
          [
            e.eventId,
            e.organizationId,
            e.restaurantId,
            e.deviceId,
            batchId,
            rows.length > 0 ? 'accepte' : 'doublon',
          ],
        )
      }

      const { rows: tete } = await client.query<{ seq: string | null }>(
        `select max(server_seq) as seq from kaissi.order_events where restaurant_id = $1`,
        [appareil.restaurantId],
      )
      return {
        inseres,
        doublons,
        curseur: Number(tete[0]?.seq ?? 0),
      }
    })
  }

  async consignerRejets(
    appareil: AppareilAuthentifie,
    batchId: string,
    rejets: readonly { eventId: string; code: string; message: string }[],
  ): Promise<void> {
    // Un identifiant mal formé ne peut pas être consigné : la clé de
    // `sync_mutations` est un uuid. Le rejet part quand même dans la réponse,
    // donc l'appareil en est informé — mais le registre reste propre.
    const consignables = rejets.filter((r) => estUuid(r.eventId))
    if (consignables.length === 0) return

    await this.sousIdentite(appareil, async (client) => {
      for (const r of consignables) {
        await client.query(
          `insert into kaissi.sync_mutations
             (event_id, organization_id, restaurant_id, device_id, batch_id,
              status, reject_code, reject_message)
           values ($1,$2,$3,$4,$5,'rejete',$6,$7)
           -- « do nothing » et non « do update » : le registre d'idempotence
           -- reste en INSERTION SEULE, comme les journaux. Un appareil ne
           -- doit pas pouvoir réécrire le verdict d'une opération passée.
           on conflict (event_id) do nothing`,
          [
            r.eventId,
            appareil.organizationId,
            appareil.restaurantId,
            appareil.deviceId,
            batchId,
            r.code,
            r.message,
          ],
        )
      }
    })
  }

  /**
   * Écrit les services de caisse d'un terminal.
   *
   * Trois choses valent d'être dites :
   *
   * 1. `organization_id`, `restaurant_id` et `device_id` viennent du JETON,
   *    jamais du corps de la requête. Un terminal compromis ne peut pas
   *    écrire un shift dans le restaurant du voisin (défense en profondeur —
   *    RLS le refuserait déjà).
   * 2. `user_id` est résolu par une SOUS-REQUÊTE sur `kaissi.users` : un
   *    employé qui n'existe que dans la graine locale de la tablette
   *    ferait sinon échouer la clé étrangère, et le shift ne remonterait
   *    JAMAIS. Un shift sans nom d'employé vaut mieux qu'un shift perdu.
   * 3. `on conflict (id) do update` : la tablette renvoie le shift à son
   *    ouverture PUIS à sa clôture. C'est le même shift, enrichi.
   */
  async enregistrerShifts(
    appareil: AppareilAuthentifie,
    shifts: readonly ShiftSynchronise[],
  ): Promise<readonly string[]> {
    const recevables = shifts.filter((s) => estUuid(s.id))
    if (recevables.length === 0) return []

    const ecrits: string[] = []
    await this.sousIdentite(appareil, async (client) => {
      for (const s of recevables) {
        await client.query(
          // `closed_by` passe par le MÊME filtre que `user_id` : un employé
          // inconnu du serveur devient nul plutôt que de faire échouer la
          // clé étrangère — un service de caisse ne doit pas se perdre parce
          // qu'un employé a été archivé entre-temps.
          `insert into kaissi.shifts
             (id, organization_id, restaurant_id, device_id, user_id, opened_at,
              opening_float_millimes, closed_at, counted_millimes,
              expected_millimes, variance_millimes, closed_by)
           values (
             $1, $2, $3, $4,
             (select u.id from kaissi.users u
               where u.id = $5::uuid and u.organization_id = $2),
             $6, $7, $8, $9, $10, $11,
             (select u.id from kaissi.users u
               where u.id = $12::uuid and u.organization_id = $2))
           on conflict (id) do update set
             closed_at         = excluded.closed_at,
             counted_millimes  = excluded.counted_millimes,
             expected_millimes = excluded.expected_millimes,
             variance_millimes = excluded.variance_millimes,
             -- COALESCE : une tablette antérieure a la migration locale 006
             -- renvoie le meme shift SANS closed_by. Ecraser par nul
             -- effacerait une information deja remontee par une tablette a
             -- jour. (Sans accents graves ici : ce SQL vit dans un littéral
             -- gabarit, et un accent grave le fermerait au milieu.)
             closed_by         = coalesce(excluded.closed_by, kaissi.shifts.closed_by),
             updated_at        = now()`,
          [
            s.id,
            appareil.organizationId,
            appareil.restaurantId,
            appareil.deviceId,
            s.employeId && estUuid(s.employeId) ? s.employeId : null,
            s.ouvertA,
            Math.max(Math.round(s.fondDeCaisseMillimes) || 0, 0),
            s.fermeA,
            s.compteMillimes === null ? null : Math.round(s.compteMillimes),
            s.attenduMillimes === null ? null : Math.round(s.attenduMillimes),
            s.ecartMillimes === null ? null : Math.round(s.ecartMillimes),
            s.fermePar && estUuid(s.fermePar) ? s.fermePar : null,
          ],
        )
        ecrits.push(s.id)
      }
    })
    return ecrits
  }

  async statutsDesCommandes(
    restaurantId: string,
    orderIds: readonly string[],
  ): Promise<Map<string, string>> {
    const propres = uuidsValides(orderIds)
    if (propres.length === 0) return new Map()
    const { rows } = await this.pool.query<{ id: string; status: string }>(
      `select id, status from kaissi.orders where restaurant_id = $1 and id = any($2::uuid[])`,
      [restaurantId, propres],
    )
    return new Map(rows.map((r) => [r.id, r.status]))
  }

  async evenementsDepuis(
    restaurantId: string,
    depuis: number,
    limite: number,
  ): Promise<readonly EvenementCommande[]> {
    // L'index `order_events_pull_idx (restaurant_id, server_seq)` sert
    // exactement cette requête : c'est le chemin le plus sollicité du système.
    const { rows } = await this.pool.query(
      `select event_id, order_id, organization_id, restaurant_id, device_id,
              seq_device, server_seq, type, payload, actor_user_id, client_ts
       from kaissi.order_events
       where restaurant_id = $1 and server_seq > $2
       order by server_seq
       limit $3`,
      [restaurantId, depuis, limite],
    )
    return rows.map(versEvenement)
  }

  async catalogueDepuis(
    restaurantId: string,
    depuis: number,
    limite: number,
  ): Promise<readonly ChangementCatalogue[]> {
    const { rows } = await this.pool.query<{
      seq: string
      entity_type: string
      entity_id: string
      op: string
      payload: Record<string, unknown> | null
    }>(
      `select seq, entity_type, entity_id, op, payload
       from kaissi.change_log
       where restaurant_id = $1 and seq > $2
       order by seq
       limit $3`,
      [restaurantId, depuis, limite],
    )
    return rows.map((r) => ({
      seq: Number(r.seq),
      entite: r.entity_type,
      entiteId: r.entity_id,
      operation: r.op as ChangementCatalogue['operation'],
      donnees: r.payload,
    }))
  }

  async curseursDeTete(
    restaurantId: string,
  ): Promise<{ catalogue: number; evenements: number }> {
    const { rows } = await this.pool.query<{ catalogue: string | null; evenements: string | null }>(
      `select
         (select max(seq) from kaissi.change_log where restaurant_id = $1) as catalogue,
         (select max(server_seq) from kaissi.order_events where restaurant_id = $1) as evenements`,
      [restaurantId],
    )
    return {
      catalogue: Number(rows[0]?.catalogue ?? 0),
      evenements: Number(rows[0]?.evenements ?? 0),
    }
  }

  async majCurseurs(
    appareil: AppareilAuthentifie,
    curseurs: { catalogue?: number; evenements?: number },
    quoi: 'push' | 'pull',
  ): Promise<void> {
    await this.sousIdentite(appareil, async (client) => {
      await client.query(
        `insert into kaissi.sync_cursors
           (device_id, organization_id, restaurant_id, last_catalog_seq,
            last_event_seq, last_push_at, last_pull_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (device_id) do update set
           last_catalog_seq = greatest(kaissi.sync_cursors.last_catalog_seq,
                                       excluded.last_catalog_seq),
           last_event_seq   = greatest(kaissi.sync_cursors.last_event_seq,
                                       excluded.last_event_seq),
           last_push_at = coalesce(excluded.last_push_at, kaissi.sync_cursors.last_push_at),
           last_pull_at = coalesce(excluded.last_pull_at, kaissi.sync_cursors.last_pull_at),
           updated_at = now()`,
        [
          appareil.deviceId,
          appareil.organizationId,
          appareil.restaurantId,
          curseurs.catalogue ?? 0,
          curseurs.evenements ?? 0,
          quoi === 'push' ? new Date().toISOString() : null,
          quoi === 'pull' ? new Date().toISOString() : null,
        ],
      )
      await client.query(
        `update kaissi.devices set last_seen_at = now() where id = $1`,
        [appareil.deviceId],
      )
    })
  }

  /**
   * Reprojection serveur : journal → `orders` / `order_items` / `payments`.
   *
   * Utilise `reduireEvenements` et `calculerTotaux` de `@kaissi/domain` —
   * le MÊME code que la tablette. C'est ce qui garantit qu'un total calculé
   * hors ligne et le total du rapport du back-office ne divergent jamais.
   */
  /**
   * Commandes dont la projection est à refaire.
   *
   * `toutes` à faux — le défaut — ne rend que celles ABSENTES de `orders` :
   * c'est le cas qui répare une panne, et il ne touche à rien d'autre.
   * À vrai, il rend toute la journée, ce qui n'a de sens qu'après un
   * changement de calcul des totaux, et hors service.
   *
   * Réservé à l'outillage d'exploitation : le service de synchronisation
   * ne reprojette, lui, que les commandes de son lot.
   */
  async commandesAReprojeter(
    restaurantId: string,
    toutes = false,
  ): Promise<string[]> {
    const { rows } = await this.pool.query<{ order_id: string }>(
      toutes
        ? `select distinct e.order_id
             from kaissi.order_events e
            where e.restaurant_id = $1
            order by e.order_id`
        : `select distinct e.order_id
             from kaissi.order_events e
        left join kaissi.orders o on o.id = e.order_id
            where e.restaurant_id = $1 and o.id is null
            order by e.order_id`,
      [restaurantId],
    )
    return rows.map((l) => l.order_id)
  }

  async projectionsOrphelines(
    fenetre: number,
    plafond: number,
  ): Promise<{ restaurantId: string; orderId: string }[]> {
    // `not exists` plutôt qu'une jointure externe suivie d'un `is null` :
    // l'anti-jointure s'arrête au premier enregistrement trouvé, là où la
    // jointure matérialise la paire avant de la jeter.
    //
    // La borne est calculée à partir du MAXIMUM courant de `server_seq`, et
    // non d'une valeur mémorisée : le service peut redémarrer sur une autre
    // machine, un autre conteneur, ou après des semaines d'arrêt.
    const { rows } = await this.pool.query<{ restaurant_id: string; order_id: string }>(
      `with borne as (
         select greatest(coalesce(max(server_seq), 0) - $1, 0) as depuis
           from kaissi.order_events
       )
       select distinct e.restaurant_id, e.order_id
         from kaissi.order_events e, borne
        where e.server_seq > borne.depuis
          and not exists (select 1 from kaissi.orders o where o.id = e.order_id)
        order by e.restaurant_id, e.order_id
        limit $2`,
      [fenetre, plafond],
    )
    return rows.map((l) => ({ restaurantId: l.restaurant_id, orderId: l.order_id }))
  }

  async reprojeter(restaurantId: string, orderIds: readonly string[]): Promise<void> {
    if (orderIds.length === 0) return
    const client = await this.pool.connect()
    const produitsTouches = new Set<string>()
    try {
      const config = await chargerConfig(client, restaurantId)
      for (const orderId of orderIds) {
        const { rows } = await client.query(
          `select event_id, order_id, organization_id, restaurant_id, device_id,
                  seq_device, server_seq, type, payload, actor_user_id, client_ts
           from kaissi.order_events
           where order_id = $1 and restaurant_id = $2
           order by server_seq`,
          [orderId, restaurantId],
        )
        if (rows.length === 0) continue

        const etat = reduireEvenements(rows.map(versEvenement))
        const totaux = calculerTotaux({
          lignes: etat.lignes,
          remiseGlobale: etat.remiseGlobale ?? undefined,
          config,
        })

        await client.query('begin')
        try {
          // Un numéro de ticket DÉJÀ PRIS ne fait pas disparaître la vente.
          //
          // C'est le défaut qui a rendu deux ventes réelles invisibles au
          // back-office : deux terminaux numérotaient tous les deux en « P1 »,
          // la contrainte d'unicité refusait le second, et la projection
          // entière échouait — silencieusement, puisque les événements, eux,
          // étaient bien arrivés.
          //
          // La contrainte est juste : deux tickets ne doivent pas porter le
          // même numéro. C'est la conséquence qui était fausse. Perdre une
          // vente coûte infiniment plus cher qu'un numéro désambiguïsé, et le
          // numéro d'origine reste intact dans le journal, qui fait foi.
          const { numero, collision } = await numeroTicketLibre(
            client,
            etat.restaurantId,
            etat.id,
            etat.numeroTicket,
            etat.deviceProprietaireId,
          )
          const exceptions = collision ? [...etat.exceptions, collision] : etat.exceptions

          await client.query(
            `insert into kaissi.orders (
               id, organization_id, restaurant_id, table_id, device_id, opened_by,
               closed_by, type, status, covers, ticket_number,
               subtotal_millimes, discount_millimes, tax_millimes, service_millimes,
               stamp_duty_millimes, total_millimes, paid_millimes,
               tax_breakdown, exceptions, opened_at, sent_at, closed_at,
               cancelled_at, cancel_reason, last_event_seq, event_count
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                       $19,$20,$21,$22,$23,$24,$25,$26,$27)
             on conflict (id) do update set
               table_id = excluded.table_id,
               status = excluded.status,
               covers = excluded.covers,
               closed_by = excluded.closed_by,
               ticket_number = coalesce(excluded.ticket_number, kaissi.orders.ticket_number),
               subtotal_millimes = excluded.subtotal_millimes,
               discount_millimes = excluded.discount_millimes,
               tax_millimes = excluded.tax_millimes,
               service_millimes = excluded.service_millimes,
               stamp_duty_millimes = excluded.stamp_duty_millimes,
               total_millimes = excluded.total_millimes,
               paid_millimes = excluded.paid_millimes,
               tax_breakdown = excluded.tax_breakdown,
               exceptions = excluded.exceptions,
               sent_at = excluded.sent_at,
               closed_at = excluded.closed_at,
               cancelled_at = excluded.cancelled_at,
               cancel_reason = excluded.cancel_reason,
               last_event_seq = excluded.last_event_seq,
               event_count = excluded.event_count,
               updated_at = now()`,
            [
              etat.id, etat.organizationId, etat.restaurantId, etat.tableId,
              etat.deviceProprietaireId, etat.ouvertePar, etat.closePar,
              etat.type, etat.statut, etat.couverts, numero,
              totaux.sousTotalMillimes, totaux.totalRemisesMillimes,
              totaux.taxeMillimes, totaux.serviceMillimes,
              totaux.timbreFiscalMillimes, totaux.totalMillimes, totalVerse(etat),
              JSON.stringify(totaux.ventilationTaxes), JSON.stringify(exceptions),
              etat.ouverteA ?? new Date().toISOString(), etat.envoyeeA, etat.closeA,
              etat.annuleeA, etat.annuleeMotif, etat.derniereSeqServeur ?? 0,
              etat.nombreEvenements,
            ],
          )

          await client.query('delete from kaissi.order_items where order_id = $1', [orderId])
          let position = 0
          for (const ligne of etat.lignes) {
            const calc = totaux.lignes.find((c) => c.id === ligne.id)
            await client.query(
              `insert into kaissi.order_items (
                 id, organization_id, restaurant_id, order_id, product_id, variant_id,
                 station_id, tax_rate_id, designation, qty, unit_price_millimes,
                 modifiers_millimes, line_gross_millimes, line_discount_millimes,
                 global_discount_share_millimes, line_total_millimes, line_tax_millimes,
                 modifiers, note, position, voided_at
               ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
              [
                ligne.id, etat.organizationId, etat.restaurantId, orderId,
                ligne.produitId, ligne.variantId, ligne.stationId, ligne.tauxTaxeId,
                ligne.designation, ligne.quantite,
                calc?.prixUnitaireMillimes ?? ligne.prixBaseMillimes,
                ligne.modificateursMillimes, calc?.totalBrutMillimes ?? 0,
                calc?.remiseLigneMillimes ?? 0, calc?.remiseGlobaleRepartieMillimes ?? 0,
                calc?.baseApresRemisesMillimes ?? 0, calc?.taxeMillimes ?? 0,
                JSON.stringify(ligne.modificateurs), ligne.note, position,
                ligne.annulee ? ligne.ajouteeA : null,
              ],
            )
            position += 1
          }

          await client.query('delete from kaissi.payments where order_id = $1', [orderId])
          for (const p of etat.paiements) {
            await client.query(
              `insert into kaissi.payments (
                 id, organization_id, restaurant_id, order_id, method_id, type,
                 amount_millimes, received_millimes, change_millimes, reference,
                 device_id, voided_at, created_at
               ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                p.id, etat.organizationId, etat.restaurantId, orderId,
                p.methodeId, p.mode, p.montantMillimes, p.recuMillimes,
                p.renduMillimes ?? 0, p.reference, etat.deviceProprietaireId,
                p.annule ? p.enregistreA : null, p.enregistreA,
              ],
            )
          }
          await client.query('commit')
        } catch (erreur) {
          await client.query('rollback').catch(() => undefined)
          throw erreur
        }

        for (const ligne of etat.lignes) {
          if (ligne.produitId) produitsTouches.add(ligne.produitId)
        }
      }

      /*
       * Aligne la carte sur le stock, une fois toutes les commandes du lot
       * projetées.
       *
       * C'est ICI, et pas dans la tablette, que se décide qu'un produit sort
       * de la carte : le serveur travaille sur `stock_actuel`, calculé à
       * l'instant, tandis qu'une tablette hors ligne ne connaîtrait qu'un
       * souvenir vieux de plusieurs heures. La caisse, elle, ne fait
       * qu'appliquer un réglage de catalogue — le même chemin qu'un
       * changement de prix.
       *
       * HORS de la transaction de projection, et sans jamais la faire
       * échouer : perdre une vente pour un réglage de carte serait absurde.
       */
      if (produitsTouches.size > 0) {
        try {
          await client.query('select kaissi.appliquer_rupture_auto($1, $2::uuid[])', [
            restaurantId,
            [...produitsTouches],
          ])
        } catch (erreur) {
          console.warn('[sync] rupture automatique non appliquée', erreur)
        }
      }
    } finally {
      client.release()
    }
  }

  async purgerJournalPrets(jours: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `delete from kaissi.change_log
        where entity_type = 'kitchen_ready'
          and created_at < now() - ($1 || ' days')::interval`,
      [String(jours)],
    )
    return rowCount ?? 0
  }

  // ── Alertes de stock (0028) ───────────────────────────────────────────────
  //
  // Ces quatre lectures ne passent PAS par `sousIdentite` : elles balaient
  // TOUS les établissements, et il n'y a précisément aucun appareil au nom de
  // qui les faire. C'est le même régime que `projectionsOrphelines` — un
  // travail de service, jamais déclenché par une requête d'appareil, et donc
  // jamais un chemin par lequel un restaurant pourrait lire un autre.

  async produitsEnAlerte(plafond: number): Promise<readonly ProduitEnAlerte[]> {
    const { rows } = await this.pool.query<{
      restaurant_id: string
      organization_id: string
      product_id: string
      name: string
      niveau: 'rupture' | 'faible'
      qty_on_hand: string
      min_qty: string | null
    }>(
      `with etat as (
         select s.restaurant_id, s.organization_id, s.product_id, p.name,
                s.qty_on_hand, s.min_qty,
                case when s.qty_on_hand <= 0 then 'rupture' else 'faible' end as niveau
           from kaissi.stock_actuel s
           join kaissi.stock_items i on i.product_id = s.product_id
           join kaissi.products    p on p.id         = s.product_id
          where p.archived_at is null
            -- auto_rupture coupé veut dire « ce comptage n'est qu'indicatif ».
            -- Alerter dessus produirait exactement le bruit que ce réglage
            -- sert à éteindre.
            and i.auto_rupture
            and (s.qty_on_hand <= 0
                 or (s.min_qty is not null and s.qty_on_hand <= s.min_qty))
       )
       select restaurant_id, organization_id, product_id, name, niveau,
              qty_on_hand, min_qty
         from etat e
        where not exists (
                select 1
                  from kaissi.stock_alerts a
                 where a.product_id = e.product_id
                   and a.resolue_a is null
                   -- Une alerte ouverte de niveau ÉGAL ou SUPÉRIEUR masque le
                   -- produit. Une aggravation, elle, passe : « faible » puis
                   -- zéro sont deux nouvelles différentes.
                   and (a.niveau = e.niveau or a.niveau = 'rupture')
              )
        order by e.restaurant_id, e.niveau, e.name
        limit $1`,
      [plafond],
    )
    return rows.map((l) => ({
      restaurantId: l.restaurant_id,
      organizationId: l.organization_id,
      productId: l.product_id,
      nom: l.name,
      niveau: l.niveau,
      // `numeric` revient en CHAÎNE avec le pilote pg — il refuse de perdre
      // de la précision à notre place. 0,25 kg existe (RÈGLE 1).
      qty: Number(l.qty_on_hand),
      seuil: l.min_qty === null ? null : Number(l.min_qty),
    }))
  }

  async cloreAlertesResolues(): Promise<number> {
    // Le motif a disparu : le stock est repassé au-dessus du seuil, ou le
    // seuil lui-même a été retiré.
    const remontees = await this.pool.query(
      `update kaissi.stock_alerts a
          set resolue_a = now()
         from kaissi.stock_actuel s
        where a.resolue_a is null
          and s.product_id = a.product_id
          and ((a.niveau = 'rupture' and s.qty_on_hand > 0)
            or (a.niveau = 'faible'
                and (s.min_qty is null or s.qty_on_hand > s.min_qty)))`,
    )
    // Le suivi de stock a été arrêté, ou le produit supprimé de la carte :
    // laisser l'alerte ouverte la rendrait ÉTERNELLE — plus rien ne pourrait
    // jamais la fermer, et le produit ne serait plus jamais alerté.
    const orphelines = await this.pool.query(
      `update kaissi.stock_alerts a
          set resolue_a = now()
        where a.resolue_a is null
          and not exists (
                select 1 from kaissi.stock_actuel s
                 where s.product_id = a.product_id
              )`,
    )
    return (remontees.rowCount ?? 0) + (orphelines.rowCount ?? 0)
  }

  async enregistrerAlerte(produit: ProduitEnAlerte, canaux: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      // La clôture d'abord : l'index unique partiel n'admet QU'UNE alerte
      // ouverte par produit. C'est le cas d'une aggravation — le « faible »
      // cède la place au « rupture », et l'historique garde les deux.
      await client.query(
        `update kaissi.stock_alerts
            set resolue_a = now()
          where product_id = $1 and resolue_a is null`,
        [produit.productId],
      )
      await client.query(
        `insert into kaissi.stock_alerts
           (organization_id, restaurant_id, product_id, niveau, qty, canaux)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          produit.organizationId,
          produit.restaurantId,
          produit.productId,
          produit.niveau,
          produit.qty,
          canaux,
        ],
      )
      await client.query('commit')
    } catch (erreur) {
      await client.query('rollback').catch(() => undefined)
      throw erreur
    } finally {
      client.release()
    }
  }

  async abonnementsPush(restaurantId: string): Promise<readonly AbonnementPush[]> {
    const { rows } = await this.pool.query<AbonnementPush>(
      `select id, endpoint, p256dh, auth
         from kaissi.push_subscriptions
        where restaurant_id = $1 and alertes_stock
        order by created_at`,
      [restaurantId],
    )
    return rows
  }

  async supprimerAbonnement(endpoint: string): Promise<void> {
    await this.pool.query(
      `delete from kaissi.push_subscriptions where endpoint = $1`,
      [endpoint],
    )
  }

  async emailsGestionnaires(restaurantId: string): Promise<readonly string[]> {
    const { rows } = await this.pool.query<{ email: string }>(
      `select distinct u.email
         from kaissi.memberships m
         join kaissi.users u on u.id = m.user_id
        where m.restaurant_id = $1
          and m.revoked_at is null
          and m.role in ('admin', 'gerant')
          -- Un employé suspendu ou parti ne reçoit plus rien : son adresse
          -- peut avoir été rendue, et l'alerte parlerait d'un stock qui ne le
          -- regarde plus.
          and u.status = 'actif'
          and u.archived_at is null
          and btrim(u.email) <> ''
        order by u.email`,
      [restaurantId],
    )
    return rows.map((l) => l.email)
  }

  async fermer(): Promise<void> {
    await this.pool.end()
  }
}

async function chargerConfig(client: PoolClient, restaurantId: string): Promise<ConfigCalcul> {
  const { rows } = await client.query<{
    id: string
    name: string
    rate_bp: number
    is_included: boolean
  }>(
    `select id, name, rate_bp, is_included from kaissi.tax_rates
     where restaurant_id = $1 and archived_at is null`,
    [restaurantId],
  )
  return {
    tauxTaxes: Object.fromEntries(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          nom: r.name,
          tauxBp: r.rate_bp as PointsDeBase,
          incluse: r.is_included,
        },
      ]),
    ),
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function versEvenement(r: any): EvenementCommande {
  return {
    eventId: r.event_id,
    orderId: r.order_id,
    organizationId: r.organization_id,
    restaurantId: r.restaurant_id,
    deviceId: r.device_id,
    seqDevice: Number(r.seq_device),
    serverSeq: r.server_seq === null ? null : Number(r.server_seq),
    type: r.type,
    payload: r.payload,
    acteurId: r.actor_user_id,
    clientTs:
      r.client_ts instanceof Date ? r.client_ts.toISOString() : String(r.client_ts),
  }
}

/**
 * Prochain préfixe de ticket libre : P1, P2, P3…
 *
 * On balaie plutôt que de compter les appareils : la contrainte
 * `unique (restaurant_id, ticket_prefix)` ne relâche PAS un préfixe quand
 * l'appareil est révoqué — et c'est délibéré, sinon un nouveau terminal
 * réutiliserait la numérotation d'un ancien et deux tickets d'archive
 * porteraient le même numéro. Compter donnerait donc une collision dès la
 * première révocation.
 */
async function prochainPrefixeLibre(
  client: PoolClient,
  restaurantId: string,
): Promise<string> {
  const { rows } = await client.query<{ ticket_prefix: string }>(
    'select ticket_prefix from kaissi.devices where restaurant_id = $1',
    [restaurantId],
  )
  const pris = new Set(rows.map((l) => l.ticket_prefix))
  for (let n = 1; n <= 999; n += 1) {
    const candidat = `P${n}`
    if (!pris.has(candidat)) return candidat
  }
  throw new Error("Plus aucun préfixe de ticket disponible pour cet établissement.")
}

/**
 * Rend un numéro de ticket qui n'entre en collision avec AUCUNE autre vente.
 *
 * ── Pourquoi ceci existe ──────────────────────────────────────────────────
 *
 * `unique (restaurant_id, ticket_number)` est une bonne contrainte : deux
 * tickets ne doivent pas porter le même numéro. Mais elle s'appliquait à une
 * PROJECTION, et faire échouer une projection revient à faire disparaître
 * une vente du back-office alors que ses événements sont bien arrivés.
 *
 * C'est arrivé en production : deux terminaux numérotaient tous les deux en
 * « P1 » — le POS n'adoptait pas le préfixe attribué par le serveur — et les
 * ventes du second n'ont jamais été projetées. Le journal, lui, les avait.
 *
 * La cause est corrigée côté POS. Ceci est la ceinture : quelle que soit la
 * raison d'une collision future — une tablette restaurée depuis une
 * sauvegarde, un préfixe saisi deux fois à la main — une vente ne doit PAS
 * se perdre pour un numéro.
 *
 * ── Ce que ça produit ─────────────────────────────────────────────────────
 *
 * `P1-000002` déjà pris devient `P1-000002~25f8`, où le suffixe est le début
 * de l'identifiant de l'appareil : déterministe, donc la même vente
 * reprojetée deux fois donne le même numéro, et lisible, donc on voit d'un
 * coup d'œil que quelque chose s'est passé.
 *
 * Le numéro D'ORIGINE n'est jamais perdu : il reste dans `order_events`, qui
 * fait foi, et la collision est enregistrée dans `orders.exceptions` — que le
 * back-office indexe déjà (`orders_exceptions_idx`).
 */
async function numeroTicketLibre(
  client: PoolClient,
  restaurantId: string,
  orderId: string,
  numero: string | null,
  deviceId: string | null,
): Promise<{ numero: string | null; collision: Record<string, unknown> | null }> {
  if (!numero) return { numero: null, collision: null }

  const prisPar = async (candidat: string) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from kaissi.orders
        where restaurant_id = $1 and ticket_number = $2 and id <> $3
        limit 1`,
      [restaurantId, candidat, orderId],
    )
    return rows[0]?.id ?? null
  }

  const occupant = await prisPar(numero)
  if (!occupant) return { numero, collision: null }

  // Le suffixe vient de l'APPAREIL, pas d'un compteur : deux reprojections
  // de la même vente doivent donner le même numéro, sinon chaque balayage
  // renommerait le ticket et l'historique deviendrait illisible.
  const base = `${numero}~${(deviceId ?? 'inconnu').replace(/-/g, '').slice(0, 4)}`
  let candidat = base
  // Borne : sans elle, une base corrompue ferait tourner ce service en rond.
  for (let n = 2; n <= 50 && (await prisPar(candidat)) !== null; n += 1) {
    candidat = `${base}-${n}`
  }

  return {
    numero: candidat,
    collision: {
      type: 'numero_ticket_en_collision',
      numeroDOrigine: numero,
      numeroRetenu: candidat,
      dejaPortePar: occupant,
      deviceId,
    },
  }
}
