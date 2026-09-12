#!/usr/bin/env node
/**
 * Les fichiers de construction Gradle sont-ils encore ceux du dépôt ?
 *
 * ── La panne qui a rendu ce script nécessaire ─────────────────────────────
 *
 * Un poste tout neuf, un JDK 21 fraîchement installé, `pnpm verifier:jdk`
 * qui répond ✓ — et pourtant :
 *
 *     * Where:
 *     Settings file '…\android\settings.gradle' line: 8
 *     > startup failed:
 *       settings file '…': 8: Unexpected character: '"' @ line 8, column 1.
 *          "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
 *
 * Le chemin du JDK s'était retrouvé COLLÉ dans `settings.gradle`, pendant le
 * dépannage de l'étape précédente. Le fichier du dépôt en fait quatre lignes
 * et n'en a pas de huitième : la ligne était locale, et elle n'a aucun sens
 * en Groovy.
 *
 * Rien ne pouvait le dire. La faute est signalée en COMPILANT le script de
 * settings, donc avant que le moindre code de Gradle ne tourne — un contrôle
 * écrit dans ce fichier ne s'exécuterait jamais. Et le vérificateur de JDK,
 * lui, répondait ✓ à juste titre : le JDK n'était plus en cause.
 *
 * ── Ce que ce script décide, et ce qu'il ne décide pas ────────────────────
 *
 * Modifier `app/build.gradle` est légitime — on y touche pour la signature,
 * pour une dépendance. Le script ne l'interdit donc pas : il PRÉVIENT.
 *
 * Il REFUSE en revanche ce qui ne peut pas être voulu : une ligne qui, hors
 * commentaire, commence par un guillemet ou par un chemin Windows. Ce n'est
 * pas du Groovy, ça n'a jamais compilé, et c'est la signature d'un
 * copier-coller égaré.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ANDROID = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'android')

/** Les fichiers de construction VERSIONNÉS, ceux dont l'état est connu. */
export const FICHIERS = [
  'settings.gradle',
  'build.gradle',
  'gradle.properties',
  'variables.gradle',
  'app/build.gradle',
]

/**
 * Cette ligne peut-elle appartenir à un script Gradle ?
 *
 * Volontairement grossier : on ne réimplémente pas un analyseur Groovy, on
 * reconnaît le copier-coller. Une ligne de code Groovy ne commence jamais par
 * un guillemet ni par « C:\ » — la première est une chaîne sans destination,
 * la seconde n'est même pas une expression.
 */
export function lignePlausible(ligne) {
  const nu = ligne.trim()
  if (nu === '') return true
  if (nu.startsWith('//') || nu.startsWith('/*') || nu.startsWith('*') || nu.startsWith('#')) {
    return true
  }
  if (nu.startsWith('"') || nu.startsWith("'")) return false
  // « C:\… » ou « C:/… » : un chemin absolu Windows posé nu dans le fichier.
  if (/^[A-Za-z]:[\\/]/.test(nu)) return false
  return true
}

/* ─────────────────────────────────────────────────────────────────────────
 * LE COUPLE AGP / GRADLE / API — trois versions qui ne se choisissent pas
 * séparément
 *
 * PANNE ANTICIPÉE, celle qui suit toujours une montée de niveau d'API. Play
 * exige de viser l'API 36 ; viser 36 oblige à compiler contre 36 ; compiler
 * contre 36 oblige à un plugin Android qui la connaît ; et ce plugin exige à
 * son tour un Gradle minimal. Toucher une seule des trois lignes casse la
 * construction, avec un message qui ne parle que de la version qu'il a sous
 * les yeux — jamais de celle qu'il aurait fallu bouger.
 *
 * Ce contrôle les lit toutes les trois et dit laquelle est en retard. Il ne
 * remplace PAS une vraie construction : il attrape l'incohérence évidente,
 * en une seconde, avant les quatre minutes de Gradle.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Le Gradle minimal exigé par chaque plugin Android, par ordre croissant.
 *
 * Source : la table de compatibilité d'Android Studio. Elle est recopiée ici
 * parce qu'aucun fichier du projet ne la porte — et c'est précisément ce qui
 * rend l'erreur si facile à commettre.
 */
export const COUPLES = [
  { agp: '8.7', gradle: '8.9' },
  { agp: '8.9', gradle: '8.11.1' },
  { agp: '8.11', gradle: '8.13' },
  { agp: '8.12', gradle: '8.13' },
]

/** « 8.11.1 » → [8, 11, 1], pour comparer des versions sans se tromper. */
export function segments(version) {
  return String(version)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
}

/** a ≥ b ? */
export function auMoins(a, b) {
  const [x, y] = [segments(a), segments(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

/** Le Gradle minimal pour un AGP donné — la dernière règle qui s'applique. */
export function gradleMinimal(agp) {
  let minimal = null
  for (const couple of COUPLES) if (auMoins(agp, couple.agp)) minimal = couple.gradle
  return minimal
}

/**
 * Les trois versions se tiennent-elles ?
 *
 * Pure, pour être testable sur des valeurs fabriquées : c'est la seule façon
 * de vérifier qu'elle attrape une incohérence sans casser le vrai projet.
 */
export function verifierCouple({ agp, gradle, compileSdk, targetSdk }) {
  const soucis = []

  if (compileSdk < targetSdk) {
    soucis.push(
      `compileSdk ${compileSdk} est INFÉRIEUR à targetSdk ${targetSdk} : on ne ` +
        `peut pas viser une API contre laquelle on ne compile pas.`,
    )
  }

  const minimal = gradleMinimal(agp)
  if (minimal && !auMoins(gradle, minimal)) {
    soucis.push(
      `AGP ${agp} exige Gradle ${minimal} ou plus, or le wrapper est en ${gradle}.\n` +
        `      → corrigez « distributionUrl » dans ` +
        `android/gradle/wrapper/gradle-wrapper.properties`,
    )
  }

  return { ok: soucis.length === 0, soucis }
}

/** Lit les trois versions dans les fichiers du projet. */
export function versionsDuProjet(racine = ANDROID) {
  const lire = (relatif) => readFileSync(join(racine, relatif), 'utf8')
  const agp = /com\.android\.tools\.build:gradle:([\d.]+)/.exec(lire('build.gradle'))?.[1]
  const gradle = /gradle-([\d.]+)-(?:all|bin)\.zip/.exec(
    lire('gradle/wrapper/gradle-wrapper.properties'),
  )?.[1]
  const variables = lire('variables.gradle')
  const nombre = (nom) => {
    const t = new RegExp(`${nom}\\s*=\\s*(\\d+)`).exec(variables)
    return t ? Number.parseInt(t[1], 10) : null
  }
  return { agp, gradle, compileSdk: nombre('compileSdkVersion'), targetSdk: nombre('targetSdkVersion') }
}

/** Les lignes suspectes d'un fichier, avec leur numéro — comme Gradle les compte. */
export function lignesSuspectes(contenu) {
  return contenu
    .split(/\r?\n/)
    .map((texte, index) => ({ numero: index + 1, texte }))
    .filter((l) => !lignePlausible(l.texte))
}

/** Les fichiers que git voit modifiés, parmi ceux qui nous intéressent. */
function modifiesSelonGit() {
  const lance = spawnSync(
    'git',
    ['status', '--porcelain', '--', ...FICHIERS.map((f) => join('android', f))],
    { cwd: resolve(ANDROID, '..'), encoding: 'utf8' },
  )
  // Pas de git (une archive téléchargée, par exemple) : on ne conclut rien.
  if (lance.status !== 0) return null
  return (lance.stdout ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  let refus = 0
  let avertissements = 0

  for (const relatif of FICHIERS) {
    const chemin = join(ANDROID, relatif)
    if (!existsSync(chemin)) continue
    const suspectes = lignesSuspectes(readFileSync(chemin, 'utf8'))
    if (suspectes.length === 0) continue
    refus += 1
    console.error(`\n✗ android/${relatif} contient une ligne qui n'est pas du Groovy :\n`)
    for (const l of suspectes.slice(0, 5)) {
      console.error(`    ligne ${l.numero} : ${l.texte.trim()}`)
    }
    console.error(
      "\n  C'est la signature d'un copier-coller égaré — typiquement un chemin de\n" +
        '  JDK collé pendant un dépannage. Gradle échouera en COMPILANT ce\n' +
        "  fichier, donc avant d'afficher quoi que ce soit d'utile.\n\n" +
        '  Pour restaurer la version du dépôt :\n\n' +
        `      git checkout -- apps/pos/android/${relatif}\n\n` +
        '  Pour désigner un JDK à Gradle sans toucher au dépôt :\n\n' +
        '      pnpm verifier:jdk --ecrire\n',
    )
  }

  if (refus > 0) process.exit(1)

  /*
   * Le couple de versions, une fois la syntaxe assurée : inutile de vérifier
   * la cohérence de fichiers qu'on vient de déclarer illisibles.
   */
  const versions = versionsDuProjet()
  const couple = verifierCouple(versions)
  if (!couple.ok) {
    console.error('\n✗ Les versions de construction ne se tiennent pas :\n')
    for (const souci of couple.soucis) console.error(`    • ${souci}`)
    console.error(
      '\n  Gradle échouerait plus tard, avec un message qui ne nomme que la\n' +
        '  version qu\'il a sous les yeux — jamais celle qu\'il faut bouger.\n',
    )
    process.exit(1)
  }
  console.log(
    `  ✓ AGP ${versions.agp} · Gradle ${versions.gradle} · ` +
      `compileSdk ${versions.compileSdk} · targetSdk ${versions.targetSdk}`,
  )

  const modifies = modifiesSelonGit()
  if (modifies && modifies.length > 0) {
    avertissements = modifies.length
    console.error('\n⚠ Fichiers de construction modifiés localement :\n')
    for (const f of modifies) console.error(`    ${f}`)
    console.error(
      "\n  Rien d'anormal si c'est voulu — la signature de production se règle\n" +
        '  ainsi. Mais si la construction échoue sans raison apparente, comparez :\n\n' +
        '      git diff -- apps/pos/android\n',
    )
  }

  console.log(
    avertissements > 0
      ? `  ✓ Scripts Gradle syntaxiquement plausibles (${avertissements} modifié(s) localement).`
      : '  ✓ Scripts Gradle intacts.',
  )
}
