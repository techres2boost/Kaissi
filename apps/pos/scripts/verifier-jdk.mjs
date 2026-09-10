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
      message:
        `JDK ${majeure} détecté — Gradle 8.11.1 ne sait pas le lire.\n\n` +
        `  C'est LUI qui produit « Unsupported class file major version ` +
        `${versionDeClasse(majeure)} », un message qui ne nomme ni Java ni sa version.\n\n` +
        `  Ce projet se construit avec un JDK ${MINIMUM} à ${MAXIMUM} — ${RECOMMANDE} de préférence.\n\n` +
        '  Le plus simple, sans rien désinstaller : utiliser celui qu’Android Studio\n' +
        '  embarque déjà (le « JBR »), le temps de la construction.\n\n' +
        '    Windows (PowerShell) :\n' +
        '      $env:JAVA_HOME = "C:\\Program Files\\Android\\Android Studio\\jbr"\n' +
        '      $env:Path = "$env:JAVA_HOME\\bin;$env:Path"\n\n' +
        '    Windows (Git Bash) :\n' +
        '      export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"\n' +
        '      export PATH="$JAVA_HOME/bin:$PATH"\n\n' +
        '    macOS / Linux :\n' +
        '      export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # macOS\n' +
        '      export JAVA_HOME=/usr/lib/jvm/java-21-openjdk      # Linux\n\n' +
        '  Puis `java -version` doit afficher 21, et la construction repart.',
    }
  }
  if (majeure < MINIMUM) {
    return {
      ok: false,
      message:
        `JDK ${majeure} détecté — le plugin Android en exige au moins ${MINIMUM}.\n` +
        `  Installe un JDK ${RECOMMANDE}, ou utilise celui d’Android Studio (« jbr »).`,
    }
  }
  return {
    ok: true,
    message:
      `JDK ${majeure} — dans la plage éprouvée (${MINIMUM}–${MAXIMUM})` +
      (majeure === RECOMMANDE ? '.' : `, ${RECOMMANDE} étant celui de la CI.`),
  }
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

  const bilan = diagnostiquer(majeureJava(sortie))
  if (bilan.ok) {
    console.log(`  ✓ ${bilan.message}`)
  } else {
    console.error(`\n✗ ${bilan.message}\n`)
    process.exit(1)
  }
}
