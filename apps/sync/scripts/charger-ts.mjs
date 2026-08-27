/**
 * Installe le résolveur « .js → .ts » pour tout le graphe de modules.
 *
 * Passé à Node via « --import » : il doit être enregistré AVANT que le point
 * d'entrée ne soit résolu, sinon le premier import relatif échoue déjà.
 */

import { register } from 'node:module'

register('./resolveur-ts.mjs', import.meta.url)
