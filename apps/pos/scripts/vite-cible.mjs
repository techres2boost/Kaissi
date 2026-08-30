#!/usr/bin/env node
/**
 * Lance Vite pour une cible donnée, sur n'importe quel système.
 *
 * Pourquoi ce détour plutôt que `VITE_CIBLE=web vite build` dans
 * package.json : cette syntaxe est celle d'un shell POSIX. Sur Windows, pnpm
 * confie le script à `cmd.exe`, qui répond « 'VITE_CIBLE' is not recognized
 * as an internal or external command » — une erreur qui ne dit ni ce qui
 * manque, ni que le problème n'existe que là.
 *
 * On pose donc la variable en Node, qui la transmet au processus enfant de la
 * même façon partout. Aucune dépendance ajoutée pour ça.
 *
 *   node scripts/vite-cible.mjs <android|web> <build|dev|preview> [options…]
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [cible, commande, ...reste] = process.argv.slice(2)

if (cible !== 'android' && cible !== 'web') {
  console.error('Cible attendue : « android » ou « web ».')
  process.exit(1)
}
if (!commande) {
  console.error('Commande attendue : « build », « dev » ou « preview ».')
  process.exit(1)
}

const racine = dirname(dirname(fileURLToPath(import.meta.url)))

// `vite.config.ts` lit VITE_CIBLE et en fait une CONSTANTE du bundle : sur la
// cible Android, la branche du moteur WebAssembly disparaît complètement.
//
// `--impression` allume le module ESC/POS, éteint par défaut dans le MVP.
// Passer par un drapeau plutôt que par une variable évite le même piège
// Windows à ceux qui rallument l'impression.
const options = reste.filter((o) => o !== '--impression')
const environnement = {
  ...process.env,
  VITE_CIBLE: cible,
  ...(reste.includes('--impression') ? { VITE_IMPRESSION: '1' } : {}),
}

// `shell: true` sur Windows : sans lui, `spawn` ne trouve pas « vite », qui
// y est un fichier .cmd et non un exécutable.
const enfant = spawn('vite', [commande, ...options], {
  cwd: racine,
  env: environnement,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

enfant.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
enfant.on('error', (erreur) => {
  console.error(`Impossible de lancer Vite : ${erreur.message}`)
  console.error('Avez-vous lancé « pnpm install » à la racine du dépôt ?')
  process.exit(1)
})
