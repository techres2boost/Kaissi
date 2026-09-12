#!/usr/bin/env node
/**
 * Un AAB signé, en une commande — contrôles compris.
 *
 * ── Pourquoi une commande de plus ─────────────────────────────────────────
 *
 * La chaîne du Play Store fait cinq étapes, et l'ordre compte : construire le
 * bundle web, le copier dans le projet Android, puis empaqueter. Les taper à
 * la main marche — jusqu'à ce qu'un maillon manque, et alors l'erreur ne
 * ressemble jamais à la cause.
 *
 * Deux fois de suite, sur le terrain, la panne n'était pas dans le projet :
 *
 *   • un JDK 25 → « Unsupported class file major version 69 », un message qui
 *     ne nomme ni Java ni sa version, et dont le mot « BUG! » accuse le dépôt ;
 *   • un chemin de JDK collé par erreur dans `settings.gradle` → une faute de
 *     syntaxe Groovy à la ligne 8 d'un fichier qui n'en compte que quatre.
 *
 * Les deux sont désormais détectés AVANT que Gradle ne démarre, parce que
 * Gradle ne peut pas les détecter lui-même : il échoue en compilant ses
 * propres scripts, donc avant d'exécuter le moindre contrôle qu'on y
 * écrirait.
 *
 * ── Ce que ce script ne fait pas ──────────────────────────────────────────
 *
 * Il ne crée pas de keystore et n'en invente aucun. Sans
 * `android/keystore.properties`, Gradle produit un AAB NON signé, que Play
 * refuse — le script le dit, plutôt que de laisser découvrir le refus après
 * l'envoi.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'
import { codeDeVersion, lireVersion } from './version.mjs'

const POS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ANDROID = join(POS, 'android')

/** Lance une étape et s'arrête net si elle échoue : la suite n'aurait aucun sens. */
function etape(titre, commande, arguments_, options = {}) {
  console.log(`\n▸ ${titre}`)
  const lance = spawnSync(commande, arguments_, {
    stdio: 'inherit',
    cwd: options.cwd ?? POS,
    // Sur Windows, `pnpm` et `gradlew.bat` sont des scripts : sans shell,
    // spawn ne les trouve pas et rend ENOENT — une panne qui ressemble à
    // « pnpm n'est pas installé ».
    shell: platform() === 'win32',
  })
  if (lance.status !== 0) {
    console.error(`\n✗ Arrêt : « ${titre} » a échoué.`)
    process.exit(lance.status ?? 1)
  }
}

const cible = process.argv.includes('--apk') ? 'apk' : 'aab'

/*
 * Le numéro de version, DIT AVANT de construire.
 *
 * PANNE OBSERVÉE au premier envoi : « Version code 101 has already been used ».
 * Le numéro avait été consommé par un téléversement précédent — et « Discard
 * draft release », qui semble tout annuler, ne le libère pas. On construit,
 * on téléverse, et on l'apprend après coup.
 *
 * L'afficher ici ne l'empêche pas, rien ne le peut depuis ce poste : Play
 * seul sait ce qu'il a déjà reçu. Mais on peut le comparer d'un coup d'œil à
 * la console Play avant de lancer cinq minutes de construction.
 */
const version = lireVersion()
console.log(
  `\n  Version ${version} · versionCode ${codeDeVersion(version)}\n` +
    '  (déjà téléversé sur Play ? → pnpm pos:version --monter)',
)

etape('Le JDK est-il dans la plage éprouvée ?', 'node', ['scripts/verifier-jdk.mjs'])
etape('Les scripts Gradle sont-ils intacts ?', 'node', ['scripts/verifier-gradle.mjs'])
etape('Bundle web + garde du mode avion', 'pnpm', ['run', 'build'])
etape('Copie dans le projet Android', 'pnpm', ['exec', 'cap', 'sync', 'android'])

if (!existsSync(join(ANDROID, 'keystore.properties'))) {
  console.error(
    '\n✗ android/keystore.properties est absent.\n\n' +
      '  Sans lui, Gradle produit un paquet NON SIGNÉ, que le Play Store refuse.\n' +
      '  Le créer une fois pour la vie du produit :\n\n' +
      '      keytool -genkey -v -keystore ~/kaissi-release.keystore \\\n' +
      '        -alias kaissi -keyalg RSA -keysize 2048 -validity 10000\n\n' +
      '  Puis apps/pos/android/keystore.properties (déjà dans .gitignore) :\n\n' +
      '      storeFile=/chemin/absolu/vers/kaissi-release.keystore\n' +
      '      storePassword=…\n' +
      '      keyAlias=kaissi\n' +
      '      keyPassword=…\n\n' +
      '  ⚠ Sauvegardez ce keystore AILLEURS, aujourd’hui. Le perdre, c’est ne\n' +
      '    plus jamais pouvoir mettre à jour l’application déjà installée.\n\n' +
      '  Pour un paquet de test non signé, sans keystore :\n\n' +
      '      cd apps/pos/android && ./gradlew assembleDebug\n',
  )
  process.exit(1)
}

const gradlew = platform() === 'win32' ? 'gradlew.bat' : './gradlew'
const tache = cible === 'apk' ? 'assembleRelease' : 'bundleRelease'
etape(`Gradle — ${tache}`, gradlew, [tache], { cwd: ANDROID })

const produit =
  cible === 'apk'
    ? join('apps', 'pos', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
    : join('apps', 'pos', 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')

console.log(
  `\n✓ Terminé.\n\n    ${produit}\n\n` +
    (cible === 'aab'
      ? "  C'est ce fichier qu'on envoie au Play Store (Production → Créer une\n" +
        `  version). Il porte le versionCode ${codeDeVersion(version)}.\n\n` +
        '  Play refuse un envoi dont le versionCode n’est pas strictement supérieur\n' +
        '  au précédent, et un numéro est consommé dès le TÉLÉVERSEMENT — «\u00a0Discard\n' +
        '  draft release\u00a0» ne le rend pas. Si Play le refuse :\n\n' +
        '      pnpm pos:version --monter && pnpm pos:aab\n'
      : '  APK signé, installable directement — c’est le chemin le plus rapide\n' +
        '  pour un premier client. Le Play Store, lui, veut l’AAB.\n'),
)
