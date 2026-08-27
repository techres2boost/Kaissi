/**
 * Résolveur de modules : fait pointer un import « ./x.js » vers « ./x.ts ».
 *
 * Pourquoi il existe : les paquets de ce dépôt sont écrits en TypeScript ESM,
 * où la convention (moduleResolution NodeNext) veut qu'on importe avec
 * l'extension « .js » le fichier qui s'appelle « .ts ». Vitest et le back-office
 * gèrent cette réécriture ; Node, lui, ne la fait PAS. Sans ce hook,
 * « node --experimental-strip-types src/index.ts » échoue dès le premier import
 * relatif sur « ERR_MODULE_NOT_FOUND …/depot-postgres.js ».
 *
 * On garde ainsi la propriété que le Dockerfile revendique — exécuter la
 * SOURCE, sans étape de compilation, donc sans risque que le binaire déployé
 * diverge du code relu — sans ajouter d'outil tiers (tsx, ts-node…).
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, next) {
  // Uniquement les imports RELATIFS en « .js ». Les bare specifiers
  // (« @kaissi/domain ») passent par package.json, qui pointe déjà « .ts ».
  if (
    specifier.endsWith('.js') &&
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL
  ) {
    const candidatTs = specifier.slice(0, -3) + '.ts'
    try {
      const urlTs = new URL(candidatTs, context.parentURL)
      // On ne réécrit QUE si le « .ts » existe : un vrai « .js » reste servi
      // tel quel, et on ne masque pas une faute de chemin par un silence.
      if (existsSync(fileURLToPath(urlTs))) {
        return next(candidatTs, context)
      }
    } catch {
      // URL invalide : on laisse Node produire son erreur d'origine.
    }
  }
  return next(specifier, context)
}
