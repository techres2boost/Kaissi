#!/usr/bin/env node
/**
 * Garde : aucune icône PROVISOIRE dans l'application livrée.
 *
 * Apple a refusé la 1.0 (60) au titre de la règle 2.3.8 : l'icône et l'écran
 * de démarrage étaient ceux que Capacitor pose par défaut (une croix bleue),
 * différents du « K » de la fiche du magasin. Rien n'échouait : un projet
 * natif tout neuf est valide avec l'icône par défaut. Cette garde refuse
 * désormais les fichiers par défaut — reconnus à leur empreinte — et une
 * icône iOS transparente, que App Store Connect refuse au téléversement.
 *
 * Régénérer les icônes : `bash apps/pos/scripts/generer-icones.sh`.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Empreintes SHA-256 des fichiers par défaut de Capacitor. */
const PAR_DEFAUT = new Set([
  '29e4777e319de3ee5a52c3a8004ec19d0568414004257e36d7c94a077d71c93b', // AppIcon iOS
  '87cb2f2ffe992652bb4fa768c73719a37b5852ab17fbf8e170e888f7a42b0761', // ic_launcher xxxhdpi
  'bd24fd383253bf8d43f0a81f11c071d76d1d555114376dd647cd9fb38fa0a9da', // ic_launcher_foreground xxxhdpi
  '1b5002b74a5500e697298ced06ca2811ac33f2771f236f3c720ff23243890530', // splash iOS
  '5cf98b4451bd99b20df26f9e608a46946118be6b0ae90762f9ca1786a30c76ff', // splash Android
])

const FICHIERS = [
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
  'android/app/src/main/res/drawable/splash.png',
]

let fautes = 0
for (const f of FICHIERS) {
  const octets = readFileSync(join(ici, f))
  const empreinte = createHash('sha256').update(octets).digest('hex')
  if (PAR_DEFAUT.has(empreinte)) {
    console.error(`  ✗ ${f} est l'image PAR DÉFAUT de Capacitor (règle Apple 2.3.8).`)
    fautes += 1
  }
}

// L'icône iOS : 1024 × 1024, SANS canal alpha (type de couleur PNG 2 = RVB).
const icone = readFileSync(join(ici, FICHIERS[0]))
const largeur = icone.readUInt32BE(16)
const hauteur = icone.readUInt32BE(20)
const typeCouleur = icone[25]
if (largeur !== 1024 || hauteur !== 1024) {
  console.error(`  ✗ L'icône iOS fait ${largeur} × ${hauteur} : 1024 × 1024 attendu.`)
  fautes += 1
}
if (typeCouleur === 4 || typeCouleur === 6) {
  console.error("  ✗ L'icône iOS a un canal alpha : App Store Connect la refusera.")
  fautes += 1
}

if (fautes > 0) {
  console.error('\n  Régénérer : bash apps/pos/scripts/generer-icones.sh\n')
  process.exit(1)
}
console.log('  ✓ Icônes et écrans de démarrage : ceux de Kaissi, icône iOS opaque 1024 × 1024.')
