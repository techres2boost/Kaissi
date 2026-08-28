/**
 * @kaissi/db-local — schéma SQLite miroir et migrations locales versionnées.
 *
 * Le POS ouvre sa base, applique ses migrations et lit son catalogue ICI.
 * Aucun accès réseau : c'est ce paquet qui rend le mode avion possible.
 */

export * from './adaptateur.js'
export * from './adaptateurs/capacitor.js'
export * from './migrateur.js'
export * from './migrations/index.js'
export * from './graine.js'
export * from './depots/catalogue.js'
export * from './depots/journal.js'
export * from './depots/etat.js'
export * from './depots/caisse.js'
export * from './depots/impression.js'
export * from './depots/stations.js'
export * from './depots/employes.js'
export * from './projecteur.js'
