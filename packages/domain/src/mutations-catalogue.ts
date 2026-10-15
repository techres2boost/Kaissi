/**
 * Les mutations du CATALOGUE émises par une caisse.
 *
 * ── Pourquoi un type à part, et pas un `order_event` de plus ──────────────
 *
 * Un événement de commande raconte ce qui est arrivé à UNE vente, et sa règle
 * d'or est l'immuabilité : on n'efface rien, on ajoute. Un article du
 * catalogue, lui, est une ligne MUTABLE du référentiel — son prix change, son
 * nom se corrige, il s'archive.
 *
 * Les mélanger aurait fait porter à `order_events` des lignes qui n'y ont pas
 * leur place, et la reprojection d'une commande aurait dû les ignorer une par
 * une. Ce sont deux journaux, deux routes, deux tables d'arrivée.
 *
 * ── Ce qui reste commun, et qui n'est pas négociable ──────────────────────
 *
 *  • l'identifiant est un UUIDv7 généré PAR L'APPAREIL (règle 2) : l'entité
 *    existe et sert avant d'avoir vu le réseau ;
 *  • `mutationId` est la clé d'idempotence (règle 5). La même mutation
 *    renvoyée cinq fois n'est appliquée qu'une fois ;
 *  • tout montant est en millimes entiers, tout taux en points de base
 *    entiers (règle 1).
 *
 * ── Ce qui est ouvert, et ce qui reste fermé ──────────────────────────────
 *
 * CRÉER, jamais MODIFIER. Deux événements additifs commutent ; deux écritures
 * sur la même ligne, non. La création ne pose pas de problème — deux caisses
 * hors ligne créent deux entités DISTINCTES (identifiants différents), au pire
 * deux fois le même nom, que le back-office fusionne. C'est un désagrément,
 * pas une perte.
 *
 * C'est la MODIFICATION qui trancherait, et c'est pour cela qu'elle n'est pas
 * ici : elle exigera le dernier-écrivain-gagne arbitré par
 * `(server_seq, device_id)`, comme le numéro de table. On ne l'ajoute pas
 * « en passant ». Une caisse crée donc un article, une catégorie, une
 * réduction, un groupe de modificateurs — elle ne les édite ni ne les
 * archive. Cela reste la décision du back-office, qui redescend par
 * `change_log`.
 *
 * Le RATTACHEMENT d'un groupe de modificateurs à des produits est additif à
 * dessein : deux caisses qui rattachent chacune un groupe au même produit
 * produisent un produit à deux groupes, sans conflit — exactement comme deux
 * articles ajoutés à la même table.
 */

import type { Millimes, PointsDeBase } from './monnaie.js'
import type { Uuid } from './types.js'

export type TypeMutationCatalogue =
  | 'catalogue.produit.cree'
  | 'catalogue.categorie.cree'
  | 'catalogue.reduction.cree'
  | 'catalogue.modificateur.cree'

/** Ce que toute mutation porte, quelle que soit l'entité créée. */
export interface MutationBase {
  /** Clé d'IDEMPOTENCE. UUIDv7 généré par l'appareil, jamais réutilisé. */
  readonly mutationId: Uuid
  readonly type: TypeMutationCatalogue
  readonly organizationId: Uuid
  readonly restaurantId: Uuid
  readonly deviceId: Uuid
  /**
   * QUI demande.
   *
   * L'appareil le déclare, le serveur ne le croit pas : il relit le rôle en
   * base avant d'appliquer. Un PIN trace, il ne protège pas — la garde est
   * côté serveur, ou elle n'existe pas.
   */
  readonly parEmployeId: Uuid
  readonly clientTs: string
  readonly protocolVersion: number
}

export interface MutationProduitCree extends MutationBase {
  readonly type: 'catalogue.produit.cree'
  readonly produitId: Uuid
  readonly nom: string
  readonly categorieId: Uuid | null
  readonly tauxTvaId: Uuid
  readonly prixBaseMillimes: Millimes
}

export interface MutationCategorieCree extends MutationBase {
  readonly type: 'catalogue.categorie.cree'
  readonly categorieId: Uuid
  readonly nom: string
  /** `#RRGGBB`, ou `null` : la caisse choisit une couleur par défaut. */
  readonly couleur: string | null
  /** Poste de préparation de la catégorie (règle « le poste appartient à la catégorie »). */
  readonly stationId: Uuid | null
}

export interface MutationReductionCree extends MutationBase {
  readonly type: 'catalogue.reduction.cree'
  readonly reductionId: Uuid
  readonly nom: string
  readonly kind: 'pourcentage' | 'montant'
  /** Présent SI `kind = pourcentage`. Points de base entiers (10 % = 1000). */
  readonly valeurBp: PointsDeBase | null
  /** Présent SI `kind = montant`. Millimes entiers. */
  readonly montantMillimes: Millimes | null
}

/** Un choix d'un groupe de modificateurs — « Saignant », « + Fromage ». */
export interface ChoixModificateur {
  readonly id: Uuid
  readonly nom: string
  readonly prixDeltaMillimes: Millimes
}

export interface MutationModificateurCree extends MutationBase {
  readonly type: 'catalogue.modificateur.cree'
  readonly groupeId: Uuid
  readonly nom: string
  readonly minSelect: number
  readonly maxSelect: number
  readonly choix: readonly ChoixModificateur[]
  /** Les produits auxquels rattacher le groupe. Additif, jamais un conflit. */
  readonly produitIds: readonly Uuid[]
}

export type MutationCatalogue =
  | MutationProduitCree
  | MutationCategorieCree
  | MutationReductionCree
  | MutationModificateurCree

/** Longueurs retenues côté Postgres (`check (length(btrim(name)) between …)`). */
export const NOM_PRODUIT_MAX = 200
export const NOM_CATEGORIE_MAX = 100
export const NOM_REDUCTION_MAX = 60
export const NOM_MODIF_GROUPE_MAX = 100
export const NOM_MODIF_CHOIX_MAX = 100

/** Les rôles autorisés à toucher au catalogue. Relu EN BASE par le serveur. */
export const ROLES_CATALOGUE = ['admin', 'gerant'] as const
export type RoleCatalogue = (typeof ROLES_CATALOGUE)[number]

export function peutModifierCatalogue(role: string): boolean {
  return (ROLES_CATALOGUE as readonly string[]).includes(role)
}

export interface ResultatValidation {
  readonly valide: boolean
  readonly motif?: string
}

function nomValide(nom: string, max: number, quoi: string): ResultatValidation | null {
  const n = nom.trim()
  if (n.length === 0) return { valide: false, motif: `Le nom ${quoi} est vide.` }
  if (n.length > max) return { valide: false, motif: `Le nom dépasse ${max} caractères.` }
  return null
}

/** Un montant entier et positif — millimes, jamais décimal (règle 1). */
function millimesValide(v: unknown, quoi: string): ResultatValidation | null {
  if (!Number.isInteger(v)) {
    // Un prix en dinars décimaux (14.5) au lieu de millimes entiers (14500)
    // passerait ici sans bruit et vendrait la pizza à 14 millimes.
    return { valide: false, motif: `${quoi} doit être un entier de millimes.` }
  }
  if ((v as number) < 0) return { valide: false, motif: `${quoi} ne peut pas être négatif.` }
  return null
}

/**
 * Valide une mutation — LE MÊME code des deux côtés.
 *
 * C'est une règle, donc elle vit ici et nulle part ailleurs. Dupliquée, elle
 * divergerait : la caisse accepterait un nom de 250 caractères que Postgres
 * refuserait, et la vente partirait dans un rejet que personne ne comprend.
 *
 * Elle ne dit RIEN des droits : un employé peut être valide et sans le rôle.
 * Les deux questions se posent séparément — sinon on finit par croire qu'un
 * formulaire correct est un formulaire autorisé.
 */
export function validerMutationCatalogue(m: MutationCatalogue): ResultatValidation {
  switch (m.type) {
    case 'catalogue.produit.cree': {
      const nom = nomValide(m.nom, NOM_PRODUIT_MAX, 'de l’article')
      if (nom) return nom
      const prix = millimesValide(m.prixBaseMillimes, 'Le prix')
      if (prix) return prix
      if (!m.tauxTvaId) return { valide: false, motif: 'Aucun taux de TVA n’est associé.' }
      return { valide: true }
    }
    case 'catalogue.categorie.cree': {
      const nom = nomValide(m.nom, NOM_CATEGORIE_MAX, 'de la catégorie')
      if (nom) return nom
      if (m.couleur !== null && !/^#[0-9a-fA-F]{6}$/.test(m.couleur)) {
        return { valide: false, motif: 'La couleur doit s’écrire « #RRGGBB ».' }
      }
      return { valide: true }
    }
    case 'catalogue.reduction.cree': {
      const nom = nomValide(m.nom, NOM_REDUCTION_MAX, 'de la réduction')
      if (nom) return nom
      if (m.kind === 'pourcentage') {
        if (!Number.isInteger(m.valeurBp) || (m.valeurBp as number) < 0 || (m.valeurBp as number) > 10000) {
          return { valide: false, motif: 'Le pourcentage doit être entre 0 et 100 (points de base entiers).' }
        }
        if (m.montantMillimes !== null) {
          return { valide: false, motif: 'Une réduction en pourcentage ne porte pas de montant.' }
        }
      } else {
        const montant = millimesValide(m.montantMillimes, 'Le montant')
        if (montant) return montant
        if (m.valeurBp !== null) {
          return { valide: false, motif: 'Une réduction en montant ne porte pas de pourcentage.' }
        }
      }
      return { valide: true }
    }
    case 'catalogue.modificateur.cree': {
      const nom = nomValide(m.nom, NOM_MODIF_GROUPE_MAX, 'du groupe')
      if (nom) return nom
      if (!Number.isInteger(m.minSelect) || m.minSelect < 0) {
        return { valide: false, motif: 'Le minimum doit être un entier positif.' }
      }
      if (!Number.isInteger(m.maxSelect) || m.maxSelect < 0) {
        return { valide: false, motif: 'Le maximum doit être un entier positif.' }
      }
      if (m.maxSelect !== 0 && m.maxSelect < m.minSelect) {
        return { valide: false, motif: 'Le maximum ne peut pas être inférieur au minimum (0 = sans limite).' }
      }
      if (m.choix.length === 0) {
        return { valide: false, motif: 'Un groupe sans choix ne propose rien.' }
      }
      for (const c of m.choix) {
        const nc = nomValide(c.nom, NOM_MODIF_CHOIX_MAX, 'du choix')
        if (nc) return nc
        // Un supplément peut être NÉGATIF (petite portion à −1,500) : on
        // vérifie l'entier, pas le signe.
        if (!Number.isInteger(c.prixDeltaMillimes)) {
          return { valide: false, motif: 'Le prix d’un choix doit être un entier de millimes.' }
        }
      }
      return { valide: true }
    }
    default:
      return { valide: false, motif: 'Type de mutation inconnu.' }
  }
}
