/**
 * @kaissi/domain — logique métier PURE.
 *
 * Aucune entrée/sortie, aucun accès réseau, aucun accès disque, aucune
 * dépendance à React, à SQLite ou à Postgres. Ce paquet est importé
 * À L'IDENTIQUE par le POS (hors ligne) et par l'API de synchronisation :
 * c'est la garantie qu'un prix se calcule exactement pareil des deux côtés.
 */

export * from './monnaie.js'
export * from './repartition.js'
export * from './types.js'
export * from './totaux.js'
export * from './uuid.js'
export * from './evenements.js'
export * from './reduction.js'
export * from './commande.js'
export * from './audit.js'
