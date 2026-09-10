#!/usr/bin/env node
/**
 * Vérifie que le JDK courant est de ceux que ce projet sait construire.
 *
 * ── La panne qui a rendu ce script nécessaire ─────────────────────────────
 *
 * Sur un poste Windows tout neuf, `./gradlew bundleRelease` s'arrête sur :
 *
 *     A problem occurred evaluating settings 'android'.
 *     > BUG! exception in phase 'semantic analysis' in source unit
 *       '_BuildScript_' Unsupported class file major version 69
 *
 * « Major version 69 » veut dire **JDK 25**. Rien dans ce message ne le dit,
 * rien ne nomme Java, et « BUG! » laisse croire à un défaut du projet. On
 * cherche du côté du dépôt pendant une heure — la cause est sur le poste.
 *
 * ── Pourquoi ce contrôle ne peut PAS vivre dans Gradle ────────────────────
 *
 * L'échec a lieu en évaluant `settings.gradle`, c'est-à-dire pendant la
 * COMPILATION du script Groovy lui-même. Un test écrit dans ce fichier ne
 * s'exécuterait jamais : Gradle n'arrive pas jusque-là. Le garde-fou doit
 * donc être posé AVANT que Gradle ne démarre — d'où un script Node, appelé
 * par les commandes du dépôt.
 *
 * ── Pourquoi on ne monte pas simplement Gradle ────────────────────────────
 *
 * Ce serait la vraie réponse, et elle viendra : Gradle 9 accepte le JDK 25.
 * Mais elle entraîne le plugin Android (AGP 8.7.2), et un couple
 * Gradle/AGP ne se change pas sans construire un APK pour le vérifier — ce
 * qui demande le SDK Android. Tant que ce n'est pas fait ET vérifié, un
 * message clair vaut mieux qu'une montée de version non éprouvée.
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/**
 * La plage éprouvée. 17 est le minimum d'AGP 8.7 ; 23 est le dernier JDK que
 * Gradle 8.11.1 connaît. Au-delà, il ne sait pas lire le bytecode et échoue
 * avant d'avoir rien fait.
 */
const MINIMUM = 17
const MAXIMUM = 23
/** Celui des trois que la documentation recommande, et que la CI utilise. */
const RECOMMANDE = 21

/** « 21.0.10 » → 21 ; « 1.8.0_402 » → 8. */
export function majeureJava(sortie) {
  const trouve = /version "(\d+)(?:\.(\d+))?/.exec(sortie)
  if (!trouve) return null
  const premier = Number(trouve[1])
  // Avant Java 9, la version s'écrivait « 1.8.0_402 » : c'est le SECOND
  // nombre qui compte. Un poste avec un vieux JDK existe encore.
  return premier === 1 ? Number(trouve[2] ?? 0) : premier
}

/** Le numéro de version de classe correspondant — celui du message d'erreur. */
export function versionDeClasse(majeure) {
  return majeure + 44
}

export function diagnostiquer(majeure) {
  if (majeure === null) {
    return {
      ok: false,
      message:
        "Impossible de lire la version de Java.\n" +
        '  Vérifie que `java -version` répond quelque chose.',
    }
  }
  if (majeure > MAXIMUM) {
    return {
      ok: false,
      trop: 'recent',
      message:
        `JDK ${majeure} détecté — Gradle 8.11.1 ne sait pas le lire.\n\n` +
        `  C'est LUI qui produit « Unsupported class file major version ` +
        `${versionDeClasse(majeure)} », un message qui ne nomme ni Java ni sa version` +
        ' — et dont le mot « BUG! » accuse le projet alors que la cause est ici.\n\n' +
        `  Ce projet se construit avec un JDK ${MINIMUM} à ${MAXIMUM} — ${RECOMMANDE} de préférence.`,
    }
  }
  if (majeure < MINIMUM) {
    return {
      ok: false,
      trop: 'ancien',
      message: `JDK ${majeure} détecté — le plugin Android en exige au moins ${MINIMUM}.`,
    }
  }
  return {
    ok: true,
    message:
      `JDK ${majeure} — dans la plage éprouvée (${MINIMUM}–${MAXIMUM})` +
      (majeure === RECOMMANDE ? '.' : `, ${RECOMMANDE} étant celui de la CI.`),
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * TROUVER un JDK utilisable — plutôt que de demander d'en installer un
 *
 * Le message « installez un JDK 21 » est correct et inutile : sur presque
 * tous les postes qui construisent une application Android, un JDK 21 est
 * DÉJÀ là — Android Studio en embarque un (le « JBR »). Le dire et le
 * trouver ne demandent pas le même effort au lecteur.
 * ───────────────────────────────────────────────────────────────────────── */

/** Les endroits où un JDK se trouve, par système. Les plus probables d'abord. */
export function emplacementsProbables(os = platform(), home = homedir()) {
  if (os === 'win32') {
    return [
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Android\\Android Studio Preview\\jbr',
      join(home, 'AppData', 'Local', 'Programs', 'Android Studio', 'jbr'),
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
    ]
  }
  if (os === 'darwin') {
    return [
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      '/Library/Java/JavaVirtualMachines',
      join(home, 'Library', 'Java', 'JavaVirtualMachines'),
    ]
  }
  return ['/usr/lib/jvm', '/usr/lib64/jvm', join(home, '.sdkman', 'candidates', 'java')]
}

/** Un dossier est-il une racine de JDK ? On lit sa version, on ne la devine pas. */
function versionDuJdk(racine) {
  const java = join(racine, 'bin', platform() === 'win32' ? 'java.exe' : 'java')
  if (!existsSync(java)) return null
  const lance = spawnSync(java, ['-version'], { encoding: 'utf8' })
  return majeureJava(`${lance.stderr ?? ''}${lance.stdout ?? ''}`)
}

/**
 * Les JDK utilisables trouvés sur ce poste, du plus proche de la version
 * recommandée au plus éloigné.
 */
export function jdkUtilisables() {
  const candidats = []
  for (const emplacement of emplacementsProbables()) {
    if (!existsSync(emplacement)) continue
    // Soit l'emplacement EST un JDK (le JBR), soit il en contient plusieurs.
    const racines = existsSync(join(emplacement, 'bin'))
      ? [emplacement]
      : readdirSync(emplacement, { withFileTypes: true })
          .filter((e) => e.isDirectory() || e.isSymbolicLink())
          .map((e) => join(emplacement, e.name))
          // macOS range le JDK sous `Contents/Home`.
          .flatMap((r) => [r, join(r, 'Contents', 'Home')])
    for (const racine of racines) {
      const majeure = versionDuJdk(racine)
      if (majeure !== null && majeure >= MINIMUM && majeure <= MAXIMUM) {
        candidats.push({ racine, majeure })
      }
    }
  }
  return candidats.sort(
    (a, b) => Math.abs(a.majeure - RECOMMANDE) - Math.abs(b.majeure - RECOMMANDE),
  )
}

/**
 * Écrit `org.gradle.java.home` dans le `gradle.properties` de l'UTILISATEUR.
 *
 * ── Pourquoi là, et pas dans le projet ───────────────────────────────────
 *
 * `apps/pos/android/gradle.properties` est VERSIONNÉ : y écrire un chemin
 * `C:\Program Files\…` le pousserait à tout le monde, et casserait la
 * construction de tous les autres postes. Le fichier de l'utilisateur
 * (`~/.gradle/gradle.properties`) est per-machine et n'entre jamais dans
 * git — c'est exactement le bon endroit pour un réglage de poste.
 *
 * ⚠ Il vaut pour TOUS les projets Gradle de ce poste. C'est pour cela que
 *   ce n'est pas fait automatiquement : le script le propose, l'opérateur
 *   décide, et la ligne écrite porte un commentaire qui dit comment la
 *   retirer.
 */
export function ecrireOverrideGradle(racineJdk, home = homedir()) {
  const dossier = join(home, '.gradle')
  const fichier = join(dossier, 'gradle.properties')
  if (existsSync(fichier)) {
    const contenu = readFileSync(fichier, 'utf8')
    if (/^\s*org\.gradle\.java\.home\s*=/m.test(contenu)) {
      return {
        ok: false,
        fichier,
        message:
          `${fichier} contient déjà « org.gradle.java.home ».\n` +
          '  Ouvrez-le et corrigez la ligne à la main — l’écraser effacerait un\n' +
          '  réglage que vous avez peut-être posé pour un autre projet.',
      }
    }
  } else {
    mkdirSync(dossier, { recursive: true })
  }
  // Gradle lit ce fichier comme des `.properties` Java : sous Windows, les
  // antislashs y sont des échappements. On les double.
  const chemin = racineJdk.replace(/\\/g, '\\\\')
  appendFileSync(
    fichier,
    `\n# Ajouté par « pnpm verifier:jdk --ecrire » (Kaissi).\n` +
      `# Gradle 8.11 ne lit pas le bytecode des JDK récents ; cette ligne lui\n` +
      `# désigne un JDK de la plage éprouvée. Retirez-la pour revenir au JDK\n` +
      `# du PATH. Vaut pour TOUS les projets Gradle de ce poste.\n` +
      `org.gradle.java.home=${chemin}\n`,
    'utf8',
  )
  return { ok: true, fichier, message: `Ligne ajoutée à ${fichier}.` }
}

/** Point d'entrée : uniquement quand le script est lancé, jamais à l'import. */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  /*
   * `java -version` écrit sur **stderr**, pas sur stdout. C'est historique, et
   * c'est le piège de ce script : `execFileSync` ne rend que stdout, donc la
   * version paraissait illisible sur un poste parfaitement configuré. On lit
   * donc les DEUX flux.
   */
  const lance = spawnSync('java', ['-version'], { encoding: 'utf8' })
  const sortie = `${lance.stderr ?? ''}${lance.stdout ?? ''}`

  const veutEcrire = process.argv.includes('--ecrire')

  const bilan = diagnostiquer(majeureJava(sortie))
  if (bilan.ok) {
    console.log(`  ✓ ${bilan.message}`)
    /*
     * ── `--ecrire` ne doit PAS être ignoré ici ────────────────────────────
     *
     * PANNE OBSERVÉE. Sur un poste dont le JDK du PATH était déjà bon, mais
     * dont Gradle prenait un AUTRE Java (variable `JAVA_HOME`, réglage
     * d'Android Studio, service Gradle déjà démarré), l'opérateur lançait
     * `pnpm verifier:jdk --ecrire` — et n'obtenait que « ✓ JDK 21 ». Rien
     * n'était écrit, et RIEN NE DISAIT que rien n'avait été écrit. On
     * cherche alors l'erreur ailleurs : c'est ce qui a fini par mettre un
     * chemin Windows au milieu de `settings.gradle`.
     *
     * Une commande explicitement demandée fait ce qu'on lui demande, ou
     * explique pourquoi elle ne le fait pas. Elle ne se tait jamais.
     */
    if (!veutEcrire) process.exit(0)

    console.log('')
    const trouves = jdkUtilisables()
    const choisi = trouves[0]
    if (!choisi) {
      console.error(
        "  ✗ --ecrire n'a rien écrit : aucun JDK n'a pu être LOCALISÉ sur ce\n" +
          '    poste. Le `java` du PATH convient, mais on ne sait pas d’où il\n' +
          "    vient — et `org.gradle.java.home` demande un chemin.\n\n" +
          '    Donnez-le à Gradle vous-même :\n\n' +
          (platform() === 'win32'
            ? '      (Get-Command java).Source     # → …\\bin\\java.exe\n'
            : '      readlink -f "$(command -v java)"   # → …/bin/java\n') +
          '\n    puis écrivez la ligne suivante dans ~/.gradle/gradle.properties,\n' +
          '    sans les deux derniers segments du chemin (`/bin/java`) :\n\n' +
          '      org.gradle.java.home=<racine du JDK>\n',
      )
      process.exit(1)
    }
    const resultat = ecrireOverrideGradle(choisi.racine)
    console.log(
      resultat.ok
        ? `  ✓ ${resultat.message}\n\n` +
            `    Gradle utilisera désormais le JDK ${choisi.majeure} de :\n` +
            `      ${choisi.racine}\n\n` +
            '    C’est utile même quand `java -version` répond juste : Gradle\n' +
            '    peut prendre un AUTRE Java que celui de votre PATH.\n\n' +
            '    ⚠ Ce réglage vaut pour TOUS les projets Gradle de ce poste.\n'
        : `  ✗ ${resultat.message}\n`,
    )
    process.exit(resultat.ok ? 0 : 1)
  }

  console.error(`\n✗ ${bilan.message}\n`)

  /*
   * On ne s'arrête pas au refus : on CHERCHE. Un poste qui construit une
   * application Android a presque toujours un JDK utilisable — celui
   * qu'Android Studio embarque. Le dire est correct ; le trouver fait
   * gagner la demi-heure que coûte « où est-il installé chez moi ? ».
   */
  const trouves = jdkUtilisables()
  if (trouves.length === 0) {
    console.error(
      "  Aucun JDK de la plage éprouvée n'a été trouvé sur ce poste.\n\n" +
        '  Le plus simple : installer Android Studio — il embarque un JDK 21\n' +
        '  (le « JBR »), qui suffit, sans rien désinstaller. Puis :\n\n' +
        (platform() === 'win32'
          ? '    $env:JAVA_HOME = "C:\\Program Files\\Android\\Android Studio\\jbr"\n' +
            '    $env:Path = "$env:JAVA_HOME\\bin;$env:Path"\n'
          : '    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"  # macOS\n' +
            '    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk                                  # Linux\n' +
            '    export PATH="$JAVA_HOME/bin:$PATH"\n') +
        '\n  Puis relancez `pnpm verifier:jdk`.\n',
    )
    process.exit(1)
  }

  const choisi = trouves[0]
  console.error(`  ── Bonne nouvelle : un JDK ${choisi.majeure} est déjà installé ici ──\n`)
  console.error(`    ${choisi.racine}\n`)

  if (veutEcrire) {
    const resultat = ecrireOverrideGradle(choisi.racine)
    if (resultat.ok) {
      console.error(
        `  ✓ ${resultat.message}\n\n` +
          '    Gradle utilisera désormais ce JDK, sans rien changer à votre PATH.\n' +
          '    Relancez la construction : elle doit repartir.\n\n' +
          '    ⚠ Ce réglage vaut pour TOUS les projets Gradle de ce poste.\n' +
          '      Retirez la ligne du fichier pour revenir en arrière.\n',
      )
      process.exit(0)
    }
    console.error(`  ✗ ${resultat.message}\n`)
    process.exit(1)
  }

  console.error(
    '  Deux façons de vous en servir :\n\n' +
      '  ① Le plus simple — laissez ce script le dire à Gradle :\n\n' +
      '       pnpm verifier:jdk --ecrire\n\n' +
      `     Il écrit « org.gradle.java.home » dans votre ~/.gradle/gradle.properties.\n` +
      '     Rien à changer dans le PATH, rien à refaire à chaque terminal.\n\n' +
      '  ② Ou à la main, pour ce terminal seulement :\n\n' +
      (platform() === 'win32'
        ? `       $env:JAVA_HOME = "${choisi.racine}"\n` +
          '       $env:Path = "$env:JAVA_HOME\\bin;$env:Path"\n'
        : `       export JAVA_HOME="${choisi.racine}"\n` +
          '       export PATH="$JAVA_HOME/bin:$PATH"\n') +
      '\n     Puis `java -version` doit afficher ' +
      `${choisi.majeure}, et la construction repart.\n`,
  )
  process.exit(1)
}
