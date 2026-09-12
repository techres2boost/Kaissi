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
 *
 * ── La SECONDE panne : ce script a menti ──────────────────────────────────
 *
 * Même poste, deux semaines plus tard. `pnpm verifier:jdk` répond
 * « ✓ JDK 21 — dans la plage éprouvée », et Gradle échoue à la ligne suivante
 * sur « Unsupported class file major version 69 » — donc sur un JDK 25.
 *
 * Les deux avaient raison. Le script interrogeait le `java` du **PATH** ;
 * Gradle, lui, ne le consulte qu'en DERNIER. Son ordre est :
 *
 *   1. `org.gradle.java.home` de ~/.gradle/gradle.properties   ← gagne toujours
 *   2. `org.gradle.java.home` du gradle.properties du projet
 *   3. gradle/gradle-daemon-jvm.properties (toolchainVersion)
 *   4. JAVA_HOME                                               ← le coupable ici
 *   5. le `java` du PATH                                       ← ce qu'on lisait
 *
 * Un `JAVA_HOME` posé une fois dans les variables d'environnement Windows
 * suffit donc à rendre le contrôle inopérant, sans que rien ne le signale.
 * Un garde-fou qui répond ✓ sur un poste qui va échouer est pire que pas de
 * garde-fou : il déplace la recherche du côté du dépôt.
 *
 * `jvmDeGradle()` réplique donc cet ordre, et le message NOMME la source
 * retenue. Quand elle diverge du PATH, il le dit — c'est cette phrase-là qui
 * manquait.
 */

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * La plage éprouvée. 17 est le minimum d'AGP 8.7 ; 23 est le dernier JDK que
 * Gradle 8.13 connaît. Au-delà, il ne sait pas lire le bytecode et échoue
 * avant d'avoir rien fait.
 *
 * (Le wrapper est passé de 8.11.1 à 8.13 en montant à l'API 36 : le plugin
 * Android 8.11 l'exige. Le PLAFOND, lui, n'a pas bougé — 8.13 ne lit pas le
 * JDK 24 non plus.)
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
        `JDK ${majeure} détecté — Gradle 8.13 ne sait pas le lire.\n\n` +
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
 * QUEL Java Gradle va-t-il prendre ?
 *
 * Pas celui du PATH, sauf en dernier recours. Tout ce fichier repose sur
 * cette distinction — voir l'en-tête, « la SECONDE panne ».
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Le dossier de Gradle pour CET utilisateur.
 *
 * `GRADLE_USER_HOME` le déplace, et ce n'est pas rare — postes d'entreprise,
 * CI, seconde partition. Un seul endroit décide, parce que deux réponses
 * différentes suffiraient à écrire le réglage dans un fichier que Gradle ne
 * lit pas, tout en annonçant que c'est fait. C'est la panne qu'on corrige,
 * sous une autre forme.
 */
export function dossierGradleUtilisateur(env = process.env, home = homedir()) {
  const pose = (env['GRADLE_USER_HOME'] ?? '').trim().replace(/^"|"$/g, '')
  return pose !== '' ? pose : join(home, '.gradle')
}

/**
 * Lit `org.gradle.java.home` dans le contenu d'un `.properties`.
 *
 * Gradle lit ces fichiers avec les règles Java : l'antislash y est un
 * ÉCHAPPEMENT. Un chemin Windows correctement écrit vaut donc
 * `C:\\Program Files\\...`, et il faut le dédoubler pour retrouver le chemin
 * réel. Ne pas le faire ferait chercher un dossier qui n'existe pas, et
 * conclure à tort que la ligne est fausse.
 *
 * Les lignes commentées (`#` ou `!`) sont ignorées : une ligne mise en
 * commentaire pour la désactiver ne doit pas continuer de compter.
 */
export function lireJavaHomeDesProprietes(contenu) {
  for (const ligne of contenu.split(/\r?\n/)) {
    const nu = ligne.trim()
    if (nu === '' || nu.startsWith('#') || nu.startsWith('!')) continue
    const trouve = /^org\.gradle\.java\.home\s*[=:]\s*(.+)$/.exec(nu)
    if (!trouve) continue
    const brut = trouve[1].trim()
    if (brut === '') continue
    return brut.replace(/\\\\/g, '\\')
  }
  return null
}

/**
 * Le JVM que GRADLE utilisera, et D'OÙ il le tient.
 *
 * Rend `{ source, chemin, versionExigee }` :
 *   • `chemin` — la racine du JDK, quand elle est connue ;
 *   • `versionExigee` — un NUMÉRO au lieu d'un chemin, quand le dépôt épingle
 *     le JVM du démon par `gradle-daemon-jvm.properties` ;
 *   • `source` — l'étiquette à afficher. C'est elle qui rend le diagnostic
 *     actionnable : « JAVA_HOME » et « le `java` du PATH » ne se corrigent
 *     pas au même endroit.
 *
 * Les accès au disque sont injectables pour que les tests n'aient pas à
 * fabriquer une arborescence entière.
 */
export function jvmDeGradle({
  home = homedir(),
  projetAndroid,
  env = process.env,
  existe = existsSync,
  lire = (f) => readFileSync(f, 'utf8'),
} = {}) {
  const dossierGradle = dossierGradleUtilisateur(env, home)

  // 1 et 2 — `org.gradle.java.home`. Le fichier de l'UTILISATEUR l'emporte sur
  // celui du projet : c'est l'ordre de précédence des propriétés Gradle, et
  // l'inverser désignerait la mauvaise ligne à corriger.
  const candidats = [
    { fichier: join(dossierGradle, 'gradle.properties'), source: `org.gradle.java.home (${join(dossierGradle, 'gradle.properties')})` },
    ...(projetAndroid
      ? [{ fichier: join(projetAndroid, 'gradle.properties'), source: 'org.gradle.java.home (gradle.properties du projet)' }]
      : []),
  ]
  for (const { fichier, source } of candidats) {
    if (!existe(fichier)) continue
    let contenu
    try {
      contenu = lire(fichier)
    } catch {
      continue
    }
    const chemin = lireJavaHomeDesProprietes(contenu)
    if (chemin) return { source, chemin, versionExigee: null, fichier }
  }

  // 3 — le JVM du démon épinglé DANS le dépôt (Gradle 8.8+, encore incubant).
  // Il n'y en a pas aujourd'hui ; le reconnaître évite qu'un contrôle devenu
  // faux ne survive au jour où on en posera un.
  if (projetAndroid) {
    const fichier = join(projetAndroid, 'gradle', 'gradle-daemon-jvm.properties')
    if (existe(fichier)) {
      try {
        const trouve = /^\s*toolchainVersion\s*[=:]\s*(\d+)/m.exec(lire(fichier))
        if (trouve) {
          return {
            source: 'gradle/gradle-daemon-jvm.properties (toolchainVersion)',
            chemin: null,
            versionExigee: Number(trouve[1]),
            fichier,
          }
        }
      } catch {
        /* illisible : on continue, JAVA_HOME décidera */
      }
    }
  }

  // 4 — `JAVA_HOME`. LE coupable du terrain : posé une fois dans les variables
  // d'environnement Windows, il l'emporte sur le PATH sans rien dire.
  const javaHome = (env['JAVA_HOME'] ?? '').trim().replace(/^"|"$/g, '')
  if (javaHome !== '') {
    return { source: 'JAVA_HOME', chemin: javaHome, versionExigee: null, fichier: null }
  }

  // 5 — le PATH, en dernier. C'est le seul cas où `java -version` répond juste.
  return { source: 'le « java » du PATH', chemin: null, versionExigee: null, fichier: null }
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
export function versionDuJdk(racine) {
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
 * Écrit `org.gradle.java.home` dans le `gradle.properties` de l'UTILISATEUR —
 * celui que Gradle lit réellement, `GRADLE_USER_HOME` compris.
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
export function ecrireOverrideGradle(
  racineJdk,
  home = homedir(),
  env = process.env,
  lireVersion = versionDuJdk,
) {
  /*
   * `GRADLE_USER_HOME`, et pas `~/.gradle` en dur.
   *
   * DÉFAUT TROUVÉ EN TESTANT le correctif ci-dessus : cette fonction écrivait
   * toujours dans `~/.gradle`, même quand Gradle lit ailleurs. Sur un poste
   * qui pose cette variable, `--ecrire` annonçait donc « ✓ ligne ajoutée » et
   * ne changeait rien — exactement le mensonge que ce fichier existe pour
   * supprimer, sous une autre forme.
   */
  const dossier = dossierGradleUtilisateur(env, home)
  const fichier = join(dossier, 'gradle.properties')
  // Gradle lit ce fichier comme des `.properties` Java : sous Windows, les
  // antislashs y sont des échappements. On les double.
  const chemin = racineJdk.replace(/\\/g, '\\\\')

  if (existsSync(fichier)) {
    const contenu = readFileSync(fichier, 'utf8')
    const actuel = lireJavaHomeDesProprietes(contenu)
    if (actuel) {
      const majeure = lireVersion(actuel)
      /*
       * ── Refuser, ou REMPLACER ? ──────────────────────────────────────────
       *
       * Refuser sans condition était la règle prudente, et elle bloquait
       * exactement la personne venue chercher de l'aide : ce fichier est le
       * RANG 1 de l'ordre de Gradle, donc quand `--ecrire` y trouve déjà une
       * ligne, c'est elle qui décide — et si la construction échoue sur
       * « major version 69 », c'est elle la cause. « Corrigez-la à la main »
       * renvoyait l'opérateur au problème qu'il demandait de régler.
       *
       * La frontière n'est donc pas « la ligne existe-t-elle » mais « le JDK
       * qu'elle désigne construit-il ce projet ». S'il le construit, on n'y
       * touche pas : c'est peut-être un réglage posé pour un autre projet, et
       * l'écraser serait un dégât silencieux. S'il ne le construit pas — trop
       * récent, trop ancien, ou dossier disparu — la remplacer est le service
       * rendu.
       */
      if (majeure !== null && majeure >= MINIMUM && majeure <= MAXIMUM) {
        return {
          ok: false,
          fichier,
          message:
            `${fichier} désigne déjà un JDK ${majeure}, qui convient.\n` +
            '  Rien n’a été modifié : cette ligne n’est pas la cause de l’échec,\n' +
            '  et l’écraser effacerait un réglage posé pour un autre projet.',
        }
      }
      writeFileSync(
        fichier,
        contenu.replace(
          /^[ \t]*org\.gradle\.java\.home[ \t]*[=:].*$/m,
          `org.gradle.java.home=${chemin}`,
        ),
        'utf8',
      )
      return {
        ok: true,
        fichier,
        remplace: true,
        message:
          `Ligne remplacée dans ${fichier}.\n` +
          `    Elle désignait ${majeure === null ? 'un dossier introuvable' : `un JDK ${majeure}`} :\n` +
          `      ${actuel}`,
      }
    }
  } else {
    mkdirSync(dossier, { recursive: true })
  }
  appendFileSync(
    fichier,
    `\n# Ajouté par « pnpm verifier:jdk --ecrire » (Kaissi).\n` +
      `# Gradle ne lit pas le bytecode des JDK trop récents ; cette ligne lui\n` +
      `# désigne un JDK de la plage éprouvée. Retirez-la pour revenir au JDK\n` +
      `# du PATH. Vaut pour TOUS les projets Gradle de ce poste.\n` +
      `org.gradle.java.home=${chemin}\n`,
    'utf8',
  )
  return { ok: true, fichier, message: `Ligne ajoutée à ${fichier}.` }
}

/** La version du `java` du PATH. Écrit sur **stderr**, pas sur stdout. */
function versionDuPath() {
  const lance = spawnSync('java', ['-version'], { encoding: 'utf8' })
  return majeureJava(`${lance.stderr ?? ''}${lance.stdout ?? ''}`)
}

/** Point d'entrée : uniquement quand le script est lancé, jamais à l'import. */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const veutEcrire = process.argv.includes('--ecrire')

  /*
   * On interroge le JVM DE GRADLE, pas celui du PATH.
   *
   * C'est toute la correction : la version précédente lisait `java -version`,
   * répondait ✓ sur un poste dont `JAVA_HOME` désignait un JDK 25, et Gradle
   * échouait à la ligne suivante. Voir l'en-tête.
   */
  const origine = jvmDeGradle({
    projetAndroid: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'android'),
  })
  const versionPath = versionDuPath()

  let majeure
  if (origine.versionExigee !== null) {
    // Le dépôt épingle la version : c'est ELLE qui compte, quel que soit le
    // Java du poste. Gradle ira la chercher, ou échouera en le disant.
    majeure = origine.versionExigee
  } else if (origine.chemin) {
    majeure = versionDuJdk(origine.chemin)
    if (majeure === null) {
      console.error(
        `\n✗ ${origine.source} désigne un dossier qui n'est pas un JDK utilisable :\n\n` +
          `    ${origine.chemin}\n\n` +
          '  Aucun `bin/java` lisible à cet endroit. Gradle échouera dessus —\n' +
          "  et il le fera même si `java -version` répond parfaitement, parce\n" +
          `  qu'il ne consulte le PATH qu'en dernier recours.\n\n` +
          (origine.fichier
            ? `  Corrigez ou retirez la ligne dans :\n    ${origine.fichier}\n`
            : platform() === 'win32'
              ? '  Corrigez ou supprimez la variable JAVA_HOME (Paramètres →\n' +
                "    Variables d'environnement).\n"
              : '  Corrigez ou retirez JAVA_HOME de votre shell.\n'),
      )
      /*
       * ── `--ecrire` vaut ICI AUSSI ────────────────────────────────────────
       *
       * Ce chemin sortait en 1 après avoir conseillé « pnpm verifier:jdk
       * --ecrire »… à quelqu'un qui venait précisément de le taper. Le même
       * défaut que la fois d'avant, déplacé d'une branche : une commande
       * explicitement demandée fait ce qu'on lui demande, ou dit pourquoi
       * elle ne le fait pas — elle ne renvoie jamais à elle-même.
       *
       * Et c'est le cas le plus fréquent en clientèle : la ligne fautive est
       * dans le fichier de l'utilisateur, donc au RANG 1. Rien d'autre ne
       * peut la corriger.
       */
      if (veutEcrire) {
        const choisi = jdkUtilisables()[0]
        if (choisi) {
          const resultat = ecrireOverrideGradle(choisi.racine)
          console.error(
            resultat.ok
              ? `  ✓ ${resultat.message}\n\n` +
                  `    Gradle utilisera désormais le JDK ${choisi.majeure} de :\n` +
                  `      ${choisi.racine}\n\n` +
                  '    Relancez la construction : elle doit repartir.\n\n' +
                  '    ⚠ Ce réglage vaut pour TOUS les projets Gradle de ce poste.\n'
              : `  ✗ ${resultat.message}\n`,
          )
          process.exit(resultat.ok ? 0 : 1)
        }
        console.error(
          "  ✗ --ecrire n'a rien écrit : aucun JDK de la plage éprouvée n'a été\n" +
            '    TROUVÉ sur ce poste. Installez-en un — Android Studio embarque un\n' +
            '    JDK 21 (le « JBR »), qui suffit — puis relancez la commande.\n',
        )
        process.exit(1)
      }
      console.error(
        '  Ou laissez ce script désigner un JDK valide :  pnpm verifier:jdk --ecrire\n',
      )
      process.exit(1)
    }
  } else {
    majeure = versionPath
  }

  /*
   * La DIVERGENCE, dite à voix haute.
   *
   * C'est la phrase qui manquait : « ✓ JDK 21 » était vrai du PATH et faux de
   * Gradle, et rien ne permettait de s'en apercevoir.
   */
  const divergence =
    origine.source !== 'le « java » du PATH' &&
    versionPath !== null &&
    majeure !== null &&
    majeure !== versionPath
      ? `\n    ⚠ Le « java » de votre PATH est un JDK ${versionPath} — Gradle ne s'en\n` +
        `      sert PAS : ${origine.source} l'emporte. C'est exactement ce qui\n` +
        '      faisait répondre ✓ à un poste qui allait échouer.\n'
      : ''

  const bilan = diagnostiquer(majeure)
  if (bilan.ok) {
    console.log(`  ✓ ${bilan.message}`)
    console.log(`    Source retenue par Gradle : ${origine.source}.`)
    if (divergence) console.log(divergence)
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
  console.error(`  Source retenue par Gradle : ${origine.source}.`)
  if (origine.chemin) console.error(`    ${origine.chemin}`)
  console.error(divergence || '')

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
