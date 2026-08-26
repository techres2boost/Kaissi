/**
 * Rôles et permissions.
 *
 * Double application, toujours :
 *   • l'APPAREIL masque ce qui est interdit — c'est de l'ergonomie ;
 *   • le SERVEUR revalide à la réconciliation — c'est la sécurité.
 * Un terminal compromis ne doit rien pouvoir forcer. Ce module est donc
 * exécuté des DEUX côtés, comme les calculs de totaux.
 *
 * Les opérations à autorisation renforcée exigent le PIN d'un manager, et
 * génèrent un événement d'audit **même lorsqu'elles sont refusées** : un
 * caissier qui tente dix fois une remise de 50 % est une information.
 */

import { BASE_POINTS, type PointsDeBase } from './monnaie.js'
import type { Uuid } from './types.js'

export type Role = 'admin' | 'gerant' | 'caissier' | 'serveur' | 'cuisine'

export type Permission =
  | 'commande.ouvrir'
  | 'commande.ajouter_ligne'
  | 'commande.annuler_ligne'
  | 'commande.envoyer_cuisine'
  | 'commande.transferer_table'
  | 'commande.annuler'
  | 'remise.appliquer'
  | 'prix.forcer'
  | 'paiement.encaisser'
  | 'paiement.rembourser'
  | 'paiement.annuler'
  | 'tiroir.ouvrir_hors_vente'
  | 'shift.ouvrir'
  | 'shift.cloturer'
  | 'caisse.mouvement'
  | 'rapport.consulter'
  | 'rapport.voir_marges'
  | 'catalogue.modifier'
  | 'employe.gerer'

/** Attributions par rôle. Un rôle plus élevé n'hérite pas : tout est explicite. */
const PERMISSIONS_PAR_ROLE: Readonly<Record<Role, readonly Permission[]>> = {
  cuisine: ['commande.envoyer_cuisine'],

  serveur: [
    'commande.ouvrir',
    'commande.ajouter_ligne',
    'commande.annuler_ligne',
    'commande.envoyer_cuisine',
    'commande.transferer_table',
    'remise.appliquer',
  ],

  caissier: [
    'commande.ouvrir',
    'commande.ajouter_ligne',
    'commande.annuler_ligne',
    'commande.envoyer_cuisine',
    'commande.transferer_table',
    'remise.appliquer',
    'paiement.encaisser',
    'shift.ouvrir',
    'shift.cloturer',
    'caisse.mouvement',
  ],

  gerant: [
    'commande.ouvrir',
    'commande.ajouter_ligne',
    'commande.annuler_ligne',
    'commande.envoyer_cuisine',
    'commande.transferer_table',
    'commande.annuler',
    'remise.appliquer',
    'prix.forcer',
    'paiement.encaisser',
    'paiement.rembourser',
    'paiement.annuler',
    'tiroir.ouvrir_hors_vente',
    'shift.ouvrir',
    'shift.cloturer',
    'caisse.mouvement',
    'rapport.consulter',
    'rapport.voir_marges',
    'catalogue.modifier',
    'employe.gerer',
  ],

  admin: [
    'commande.ouvrir',
    'commande.ajouter_ligne',
    'commande.annuler_ligne',
    'commande.envoyer_cuisine',
    'commande.transferer_table',
    'commande.annuler',
    'remise.appliquer',
    'prix.forcer',
    'paiement.encaisser',
    'paiement.rembourser',
    'paiement.annuler',
    'tiroir.ouvrir_hors_vente',
    'shift.ouvrir',
    'shift.cloturer',
    'caisse.mouvement',
    'rapport.consulter',
    'rapport.voir_marges',
    'catalogue.modifier',
    'employe.gerer',
  ],
}

/**
 * Surcharges fines, stockées en JSON sur l'appartenance.
 * `remiseMaxBp` plafonne la remise qu'un employé peut accorder SEUL ;
 * au-delà, le PIN d'un manager est requis.
 */
export interface Surcharges {
  readonly accordees?: readonly Permission[]
  readonly retirees?: readonly Permission[]
  readonly remiseMaxBp?: number
}

export interface Employe {
  readonly id: Uuid
  readonly nom: string
  readonly role: Role
  readonly surcharges?: Surcharges
}

/** Remise maximale accordée par défaut, par rôle, en points de base. */
const REMISE_MAX_PAR_DEFAUT: Readonly<Record<Role, number>> = {
  cuisine: 0,
  serveur: 500, // 5 %
  caissier: 1000, // 10 %
  gerant: BASE_POINTS, // sans limite
  admin: BASE_POINTS,
}

/** Permissions effectives d'un employé, surcharges appliquées. */
export function permissionsDe(employe: Employe): ReadonlySet<Permission> {
  const base = new Set<Permission>(PERMISSIONS_PAR_ROLE[employe.role])
  for (const p of employe.surcharges?.accordees ?? []) base.add(p)
  for (const p of employe.surcharges?.retirees ?? []) base.delete(p)
  return base
}

export function peut(employe: Employe, permission: Permission): boolean {
  return permissionsDe(employe).has(permission)
}

/** Plafond de remise applicable à cet employé, en points de base. */
export function remiseMaxBp(employe: Employe): number {
  const surcharge = employe.surcharges?.remiseMaxBp
  if (typeof surcharge === 'number') return Math.max(0, Math.min(surcharge, BASE_POINTS))
  return REMISE_MAX_PAR_DEFAUT[employe.role]
}

/** Résultat d'un contrôle d'autorisation, destiné à l'interface ET à l'audit. */
export type Autorisation =
  | { readonly accorde: true }
  | {
      readonly accorde: false
      /** `true` si le PIN d'un manager débloque l'opération. */
      readonly escaladePossible: boolean
      readonly motif: string
    }

const ACCORDE: Autorisation = { accorde: true }

/**
 * Autorise une opération pour un employé.
 * `escaladePossible` distingue « interdit, mais un manager peut le faire »
 * de « interdit, point » — la première ouvre une saisie de PIN, la seconde
 * affiche une explication.
 */
export function autoriser(employe: Employe, permission: Permission): Autorisation {
  if (peut(employe, permission)) return ACCORDE
  return {
    accorde: false,
    escaladePossible: PERMISSIONS_PAR_ROLE.gerant.includes(permission),
    motif: `Le rôle « ${employe.role} » n'a pas la permission « ${permission} ».`,
  }
}

/** Autorise une remise en tenant compte du plafond propre à l'employé. */
export function autoriserRemise(employe: Employe, tauxBp: PointsDeBase | number): Autorisation {
  const base = autoriser(employe, 'remise.appliquer')
  if (!base.accorde) return base
  const plafond = remiseMaxBp(employe)
  if (tauxBp <= plafond) return ACCORDE
  return {
    accorde: false,
    escaladePossible: true,
    motif:
      `Remise de ${(tauxBp / 100).toFixed(2)} % supérieure au plafond de ` +
      `${(plafond / 100).toFixed(2)} % accordé à ${employe.nom}.`,
  }
}

/**
 * Opérations qui exigent une justification écrite. Sans motif, l'audit ne
 * sert à rien : « annulation par Ahmed » n'explique rien, « annulation par
 * Ahmed — client parti sans payer » explique tout.
 */
export const EXIGENT_UN_MOTIF: readonly Permission[] = [
  'commande.annuler',
  'paiement.rembourser',
  'paiement.annuler',
  'tiroir.ouvrir_hors_vente',
  'prix.forcer',
]

export function exigeUnMotif(permission: Permission): boolean {
  return EXIGENT_UN_MOTIF.includes(permission)
}
