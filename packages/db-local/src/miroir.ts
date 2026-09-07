/**
 * Le MIROIR du référentiel : ce que le serveur descend, ce que la base locale
 * en garde.
 *
 * ── Pourquoi ce fichier vit dans `db-local` et non dans le POS ────────────
 *
 * Parce qu'il parle du SCHÉMA LOCAL, pas du réseau. Le POS ne fait que lui
 * passer la page de changements qu'il vient de recevoir. Ici, ce code est
 * testable contre une vraie base SQLite — et il devait l'être : c'est lui qui
 * fait qu'un PIN réinitialisé au back-office prend effet sur la tablette.
 * Tant qu'il vivait au milieu du branchement réseau, aucun test ne
 * l'atteignait sans monter un serveur.
 *
 * ── Le miroir ne raisonne pas, il recopie ─────────────────────────────────
 *
 * Aucun arbitrage : un appareil ne modifie JAMAIS le référentiel, il le
 * reçoit. La ligne locale est donc écrasée par celle du serveur, sans
 * comparer les dates ni fusionner quoi que ce soit.
 */

import type { AdaptateurSqlite } from './adaptateur.js'

/** Un changement de référentiel, tel que `change_log` le descend. */
export interface ChangementMiroir {
  readonly seq: number
  readonly entite: string
  readonly entiteId: string
  readonly operation: string
  readonly donnees: Record<string, unknown> | null
}

/**
 * Tables du référentiel répliquées localement, avec leurs colonnes.
 *
 * Liste EXPLICITE et non « toutes les colonnes reçues » : le serveur peut
 * être plus récent que l'application et envoyer des colonnes que ce schéma
 * local ne connaît pas encore. Les ignorer est exactement ce que demande le
 * support N−2 du protocole.
 */
export const TABLES_MIROIR: Record<
  string,
  { nom: string; colonnes: string[]; /** Clé primaire, `id` par défaut. */ cle?: string }
> = {
  tax_rates: {
    nom: 'tax_rates',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'rate_bp',
               'is_included', 'is_default', 'archived_at'],
  },
  categories: {
    nom: 'categories',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'position',
               'color', 'station_id', 'archived_at'],
  },
  stations: {
    nom: 'stations',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'printer_host',
               'printer_port', 'position', 'archived_at'],
  },
  products: {
    nom: 'products',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'category_id', 'station_id',
               'tax_rate_id', 'name', 'description', 'base_price_millimes', 'color',
               'position', 'is_available', 'unavailable_reason', 'track_stock',
               'archived_at'],
  },
  product_variants: {
    nom: 'product_variants',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'product_id', 'name',
               'price_delta_millimes', 'position', 'is_available', 'archived_at'],
  },
  modifier_groups: {
    nom: 'modifier_groups',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'min_select',
               'max_select', 'is_required', 'position', 'archived_at'],
  },
  modifiers: {
    nom: 'modifiers',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'modifier_group_id', 'name',
               'price_delta_millimes', 'position', 'is_available', 'archived_at'],
  },
  areas: {
    nom: 'areas',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'position', 'archived_at'],
  },
  tables: {
    nom: 'tables',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'area_id', 'label',
               'seats', 'archived_at'],
  },
  payment_methods: {
    nom: 'payment_methods',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'type',
               'opens_drawer', 'position', 'is_active', 'archived_at'],
  },
  // Côté serveur, un employé est la jointure de users et memberships ; le
  // journal de changements l'envoie déjà aplati à cette forme-là. L'appareil
  // reçoit le HACHAGE Argon2id du PIN, jamais le PIN : c'est ce qui lui
  // permet de valider une prise de poste sans réseau.
  employees: {
    nom: 'employees',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'full_name', 'role',
               'pin_hash', 'permissions', 'is_active', 'archived_at'],
  },
  /*
   * Les réductions habituelles de l'établissement (Postgres 0030).
   *
   * Elles descendent par le catalogue pour une raison de fond : la caisse
   * doit pouvoir proposer « Happy hour » à 19 h un soir de coupure réseau.
   * Une liste chargée au moment du clic ne tomberait qu'en service, au pire
   * moment.
   */
  discounts: {
    nom: 'discounts',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'kind',
               'value_bp', 'amount_millimes', 'position', 'archived_at'],
  },
  /*
   * Le carnet de clients (Postgres 0031).
   *
   * En lecture seule sur la tablette : elle rattache un client existant à une
   * commande — un événement de commande, qui passe par l'outbox — mais ne
   * crée pas de fiche hors ligne. Cela demanderait une route de remontée pour
   * du référentiel, que le protocole n'a pas.
   */
  customers: {
    nom: 'customers',
    colonnes: ['id', 'organization_id', 'restaurant_id', 'name', 'phone', 'email',
               'note', 'archived_at'],
  },
  /*
   * « Commande prête », posé par la cuisine (Postgres 0029).
   *
   * Ce n'est pas du référentiel — c'est le seul marqueur transactionnel qui
   * descende par ce canal. Il y passe justement parce que le canal existe :
   * un troisième flux aurait voulu son curseur, sa route et sa dégradation
   * silencieuse, pour un booléen. Ici, la caisse ne fait qu'appliquer, comme
   * pour un changement de prix.
   *
   * `cleared_at` est ce qui distingue « plus prêt » de « jamais reçu » : le
   * serveur MET À JOUR la ligne au lieu de la supprimer, sinon le retrait ne
   * descendrait pas et le badge resterait allumé.
   */
  kitchen_ready: {
    nom: 'kitchen_ready',
    cle: 'order_id',
    colonnes: ['order_id', 'organization_id', 'restaurant_id', 'ready_at', 'cleared_at'],
  },
}

/** SQLite ne connaît ni booléen ni objet : on convertit à la frontière. */
function normaliser(valeur: unknown): string | number | null {
  if (valeur === null || valeur === undefined) return null
  if (typeof valeur === 'boolean') return valeur ? 1 : 0
  if (typeof valeur === 'number') return valeur
  if (typeof valeur === 'string') return valeur
  return JSON.stringify(valeur)
}

/**
 * Applique une page de changements du référentiel à la base locale.
 *
 * L'appelant fournit la transaction : le curseur de synchronisation et les
 * lignes qu'il décrit doivent avancer ensemble. Écrire le curseur alors que
 * les lignes n'ont pas été posées ferait sauter ces changements POUR
 * TOUJOURS — l'appareil ne les redemanderait jamais.
 *
 * Rend le nombre de lignes effectivement touchées, ce que l'écran Diagnostic
 * affiche : « le catalogue est à jour » est une phrase qu'on doit pouvoir
 * vérifier, pas croire.
 */
export async function appliquerMiroir(
  db: AdaptateurSqlite,
  changements: readonly ChangementMiroir[],
): Promise<number> {
  let touchees = 0
  for (const c of changements) {
    const table = TABLES_MIROIR[c.entite]
    if (!table) continue // entité que cette version ne connaît pas encore

    // La clé n'est pas toujours `id` : `kitchen_ready` est identifiée par la
    // COMMANDE qui est prête. Le serveur journalise cet identifiant-là dans
    // `entity_id`, et c'est celui-ci qui sert de clé — sans quoi chaque
    // « prêt » créerait une ligne.
    const cle = table.cle ?? 'id'

    if (c.operation === 'delete') {
      await db.executer(`DELETE FROM ${table.nom} WHERE ${cle} = ?`, [c.entiteId])
      touchees += 1
      continue
    }
    if (!c.donnees) continue

    // Les colonnes que CETTE version connaît, et que le serveur a envoyées.
    // L'intersection dans les deux sens : un serveur plus récent peut en
    // ajouter, une tablette en retard peut en ignorer. Support N−2.
    const colonnes = table.colonnes.filter((col) => col in c.donnees!)
    if (colonnes.length === 0) continue
    const valeur = (col: string) => normaliser(c.donnees![col])

    /*
     * UPDATE si la ligne existe, INSERT sinon — et non un `INSERT … ON
     * CONFLICT`.
     *
     * L'upsert paraissait plus court, et il l'était tant que le serveur
     * envoyait la ligne ENTIÈRE. Une charge partielle — le jour où un
     * déclencheur n'enverrait que ce qui a changé — se casse sur le
     * `NOT NULL` d'une colonne absente : SQLite construit la ligne du INSERT
     * AVANT de détecter le conflit. Et comme la page entière est appliquée
     * dans une transaction, cette seule erreur annulerait tout le rattrapage
     * du catalogue, indéfiniment. Une caisse cesserait de recevoir ses prix
     * pour une colonne manquante.
     */
    const existante = await db.lireUne<{ presente: number }>(
      `SELECT 1 AS presente FROM ${table.nom} WHERE ${cle} = ?`,
      [c.entiteId],
    )

    if (existante) {
      /*
       * Toutes les colonnes reçues sont réécrites, `pin_hash` compris.
       *
       * C'est la ligne qui fait qu'un PIN réinitialisé prend effet. En
       * exclure une « parce qu'elle ne change jamais » laisserait la
       * tablette accepter l'ancien code indéfiniment, sans que rien ne le
       * signale : la caisse dirait « à jour », et elle le serait — pour tout
       * sauf ça.
       */
      const aEcrire = colonnes.filter((col) => col !== cle)
      if (aEcrire.length === 0) continue
      await db.executer(
        `UPDATE ${table.nom} SET ${aEcrire.map((col) => `${col} = ?`).join(', ')}
         WHERE ${cle} = ?`,
        [...aEcrire.map(valeur), c.entiteId],
      )
    } else {
      await db.executer(
        `INSERT INTO ${table.nom} (${colonnes.join(', ')})
         VALUES (${colonnes.map(() => '?').join(', ')})`,
        colonnes.map(valeur),
      )
    }
    touchees += 1
  }
  return touchees
}
