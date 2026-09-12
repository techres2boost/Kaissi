/**
 * Le garde-fou du JDK — celui qui traduit « major version 69 ».
 *
 * PANNE RÉELLE, sur le poste du gérant : `./gradlew bundleRelease` s'arrêtait
 * sur « BUG! exception in phase 'semantic analysis' … Unsupported class file
 * major version 69 ». Rien dans ce message ne nomme Java, rien ne dit 25, et
 * le mot « BUG! » désigne le projet plutôt que le poste.
 *
 * Ce test fige la traduction : la version détectée, le numéro de classe
 * correspondant, et le fait que le message dise QUOI FAIRE.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/*
 * Le script est du JavaScript pur : il doit tourner sous `node` sans étape de
 * compilation, avant même que le projet ne soit construit. TypeScript n'a donc
 * pas de déclarations pour lui, et `@ts-expect-error` doit porter sur la LIGNE
 * du spécificateur de module — pas sur le mot-clé `import`, qui est plus haut
 * quand la liste d'imports est multiligne.
 */
import {
  majeureJava,
  versionDeClasse,
  diagnostiquer,
  emplacementsProbables,
  ecrireOverrideGradle,
  dossierGradleUtilisateur,
  jvmDeGradle,
  lireJavaHomeDesProprietes,
  // @ts-expect-error — script Node en JS pur, sans déclarations de types.
} from './verifier-jdk.mjs'

describe('lire la version de Java', () => {
  it('lit les versions modernes', () => {
    expect(majeureJava('openjdk version "21.0.10" 2026-01-20')).toBe(21)
    expect(majeureJava('java version "25" 2025-09-16')).toBe(25)
    expect(majeureJava('openjdk version "17.0.9" 2023-10-17')).toBe(17)
  })

  it('lit encore l’écriture d’avant Java 9', () => {
    // « 1.8.0_402 » veut dire Java 8 : c'est le SECOND nombre qui compte.
    expect(majeureJava('java version "1.8.0_402"')).toBe(8)
  })

  it('rend `null` plutôt que de deviner', () => {
    expect(majeureJava('commande introuvable')).toBeNull()
  })

  it("ne se laisse pas troubler par la bannière JAVA_TOOL_OPTIONS", () => {
    // Certains environnements préfixent la sortie ; la version reste lisible.
    const sortie =
      'Picked up JAVA_TOOL_OPTIONS: -Dfoo=bar\nopenjdk version "21.0.10" 2026-01-20'
    expect(majeureJava(sortie)).toBe(21)
  })
})

describe('traduire le numéro de version de classe', () => {
  it('fait le lien que le message d’erreur ne fait pas', () => {
    // C'est CE calcul qui manquait au gérant : 69 − 44 = 25.
    expect(versionDeClasse(25)).toBe(69)
    expect(versionDeClasse(21)).toBe(65)
    expect(versionDeClasse(17)).toBe(61)
  })
})

describe('le diagnostic', () => {
  it('accepte la plage éprouvée', () => {
    for (const v of [17, 21, 23]) {
      expect(diagnostiquer(v).ok, `JDK ${v} doit passer`).toBe(true)
    }
  })

  it('refuse le JDK 25 — et nomme le message que Gradle affiche', () => {
    const bilan = diagnostiquer(25)
    expect(bilan.ok).toBe(false)
    expect(bilan.trop).toBe('recent')
    // Le lien avec ce que le gérant a SOUS LES YEUX est tout l'intérêt : il
    // ne cherche pas « JDK 25 » dans son terminal, il y lit « 69 ».
    expect(bilan.message).toContain('major version 69')
    expect(bilan.message).toContain('JDK 25')
  })

  it('refuse aussi un JDK trop ancien', () => {
    const bilan = diagnostiquer(11)
    expect(bilan.ok).toBe(false)
    expect(bilan.trop).toBe('ancien')
    expect(bilan.message).toContain('au moins 17')
  })

  it("ne mélange pas le DIAGNOSTIC et le REMÈDE", () => {
    /*
     * Le remède dépend de ce qu'on trouve sur le poste : le script cherche
     * un JDK utilisable et donne SON chemin. Laisser en plus des chemins
     * génériques dans le diagnostic affichait les deux à la suite — la
     * première version faisait exactement cela, et le message devenait
     * illisible à force d'être complet.
     */
    expect(diagnostiquer(25).message).not.toContain('JAVA_HOME')
  })

  it('ne prétend rien quand il ne sait pas', () => {
    expect(diagnostiquer(null).ok).toBe(false)
  })
})

describe('trouver un JDK sur le poste', () => {
  it("cherche d'abord là où Android Studio l'installe", () => {
    // C'est le cas le plus fréquent : quelqu'un qui construit une
    // application Android a Android Studio, donc un JDK 21, sans le savoir.
    const windows = emplacementsProbables('win32', 'C:\\Users\\salem')
    expect(windows[0]).toContain('Android Studio')
    expect(emplacementsProbables('darwin', '/Users/salem')[0]).toContain('Android Studio')
    // Linux n'a pas d'Android Studio à un emplacement canonique : on prend
    // le répertoire standard des JVM.
    expect(emplacementsProbables('linux', '/home/salem')[0]).toBe('/usr/lib/jvm')
  })
})

describe("écrire l'override Gradle", () => {
  it('écrit dans le gradle.properties de l’UTILISATEUR, jamais celui du projet', () => {
    const home = mkdtempSync(join(tmpdir(), 'kaissi-jdk-'))
    // `env` explicite : un poste qui pose GRADLE_USER_HOME ferait sinon
    // écrire ce test ailleurs, et échouer pour une raison sans rapport.
    const resultat = ecrireOverrideGradle('/usr/lib/jvm/java-21-openjdk', home, {})

    expect(resultat.ok).toBe(true)
    /*
     * `apps/pos/android/gradle.properties` est VERSIONNÉ : y écrire un
     * chemin de poste le pousserait à tout le monde et casserait la
     * construction partout ailleurs. Le fichier de l'utilisateur, lui,
     * n'entre jamais dans git.
     */
    expect(resultat.fichier).toBe(join(home, '.gradle', 'gradle.properties'))
    const contenu = readFileSync(resultat.fichier, 'utf8')
    expect(contenu).toContain('org.gradle.java.home=/usr/lib/jvm/java-21-openjdk')
    // La ligne doit dire d'où elle vient et comment la retirer.
    expect(contenu).toContain('verifier:jdk')
    expect(contenu).toContain('Retirez-la')
  })

  it("REFUSE d'écraser un réglage déjà posé", () => {
    const home = mkdtempSync(join(tmpdir(), 'kaissi-jdk-'))
    mkdirSync(join(home, '.gradle'), { recursive: true })
    writeFileSync(
      join(home, '.gradle', 'gradle.properties'),
      'org.gradle.java.home=/un/autre/jdk\n',
    )

    const resultat = ecrireOverrideGradle('/usr/lib/jvm/java-21-openjdk', home, {})

    // Ce fichier vaut pour TOUS les projets Gradle du poste : l'écraser
    // casserait peut-être un autre projet, en silence.
    expect(resultat.ok).toBe(false)
    expect(resultat.message).toContain('déjà')
    expect(readFileSync(resultat.fichier, 'utf8')).toContain('/un/autre/jdk')
  })
})

/*
 * ── Le silence qui a fini par casser un fichier versionné ────────────────
 *
 * PANNE RÉELLE. Sur un poste dont le JDK du PATH convenait, l'opérateur
 * lançait `pnpm verifier:jdk --ecrire` et n'obtenait que « ✓ JDK 21 ». Rien
 * n'était écrit, et RIEN NE DISAIT que rien n'avait été écrit : le script
 * sortait en 0 avant même de regarder l'option.
 *
 * On cherche alors ailleurs — et l'endroit où l'on cherche, c'est
 * `settings.gradle`, le seul fichier que Gradle nomme dans son erreur. Le
 * chemin du JDK y a atterri, et Gradle a répondu « Unexpected character:
 * '"' @ line 8 », dans un fichier VERSIONNÉ.
 *
 * On lance donc le VRAI script, avec un `HOME` jetable : c'est un
 * comportement de ligne de commande, il ne se prouve pas en important une
 * fonction.
 */
describe('`--ecrire` quand le JDK courant est DÉJÀ le bon', () => {
  const script = fileURLToPath(new URL('./verifier-jdk.mjs', import.meta.url))

  function lancer(args: string[], home: string, extra: Record<string, string> = {}) {
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ...extra,
    }
    /*
     * `GRADLE_USER_HOME` est RETIRÉ, sauf si le test le pose lui-même.
     *
     * Le script l'honore désormais — c'est le correctif — donc un poste qui
     * la pose enverrait l'écriture ailleurs que dans le `home` jetable, et ce
     * test lirait un fichier qui n'a pas bougé.
     */
    if (!('GRADLE_USER_HOME' in extra)) delete env['GRADLE_USER_HOME']
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env })
  }

  it('écrit vraiment le réglage, au lieu de se taire', () => {
    const home = mkdtempSync(join(tmpdir(), 'kaissi-jdk-cli-'))
    const lance = lancer(['--ecrire'], home)
    const sortie = `${lance.stdout}${lance.stderr}`

    // Ce poste peut n'avoir aucun JDK LOCALISABLE (le `java` du PATH suffit
    // à `java -version`, mais `org.gradle.java.home` demande un chemin). Le
    // contrat porte sur les deux issues : écrire, ou dire pourquoi non.
    const fichier = join(home, '.gradle', 'gradle.properties')
    if (existsSync(fichier)) {
      expect(readFileSync(fichier, 'utf8')).toContain('org.gradle.java.home=')
      expect(lance.status).toBe(0)
    } else {
      expect(sortie).toContain("--ecrire n'a rien écrit")
      expect(lance.status).toBe(1)
    }
    // Dans les deux cas : le script a PARLÉ de l'option.
    expect(sortie).toMatch(/gradle\.properties|--ecrire/)
  })

  it("sans l'option, il n'écrit rien — un réglage ne se pose pas tout seul", () => {
    // Il vaut pour TOUS les projets Gradle du poste : il ne se pose que
    // lorsqu'on le demande.
    const home = mkdtempSync(join(tmpdir(), 'kaissi-jdk-cli-'))
    lancer([], home)
    expect(existsSync(join(home, '.gradle', 'gradle.properties'))).toBe(false)
  })
})

/*
 * ── Le ✓ qui mentait ─────────────────────────────────────────────────────
 *
 * PANNE RÉELLE, sur le poste du gérant, deux semaines après la première.
 * `pnpm verifier:jdk` répondait « ✓ JDK 21 — dans la plage éprouvée », et
 * Gradle échouait à la ligne suivante sur « Unsupported class file major
 * version 69 » — un JDK 25.
 *
 * Les deux disaient vrai. Le script lisait le `java` du PATH ; Gradle ne le
 * consulte qu'en DERNIER, après `org.gradle.java.home` et après `JAVA_HOME`.
 * Un `JAVA_HOME` posé une fois dans les variables d'environnement Windows
 * rendait donc le garde-fou inopérant, sans que rien ne le signale.
 *
 * Ces tests figent l'ORDRE de Gradle. S'ils tombent, le script est revenu à
 * regarder au mauvais endroit — et il répondra ✓ à un poste qui va échouer.
 */
describe('quel Java Gradle va-t-il prendre', () => {
  const ANDROID = '/depot/apps/pos/android'
  const HOME = '/home/salem'

  /** Un faux disque : seuls les fichiers listés existent. */
  const disque = (fichiers: Record<string, string>) => ({
    existe: (f: string) => Object.prototype.hasOwnProperty.call(fichiers, f),
    lire: (f: string) => fichiers[f] ?? '',
  })

  it('préfère org.gradle.java.home de l’UTILISATEUR à tout le reste', () => {
    const resolu = jvmDeGradle({
      home: HOME,
      projetAndroid: ANDROID,
      env: { JAVA_HOME: '/jdk25' },
      ...disque({
        '/home/salem/.gradle/gradle.properties': 'org.gradle.java.home=/jdk21\n',
        '/depot/apps/pos/android/gradle.properties': 'org.gradle.java.home=/jdk17\n',
      }),
    })
    expect(resolu.chemin).toBe('/jdk21')
    expect(resolu.source).toContain('org.gradle.java.home')
  })

  it('puis celui du PROJET — l’utilisateur l’emporte, pas l’inverse', () => {
    const resolu = jvmDeGradle({
      home: HOME,
      projetAndroid: ANDROID,
      env: { JAVA_HOME: '/jdk25' },
      ...disque({ '/depot/apps/pos/android/gradle.properties': 'org.gradle.java.home=/jdk17\n' }),
    })
    expect(resolu.chemin).toBe('/jdk17')
    expect(resolu.source).toContain('projet')
  })

  it('puis le JVM du démon épinglé DANS le dépôt, en version et non en chemin', () => {
    const resolu = jvmDeGradle({
      home: HOME,
      projetAndroid: ANDROID,
      env: { JAVA_HOME: '/jdk25' },
      ...disque({
        '/depot/apps/pos/android/gradle/gradle-daemon-jvm.properties': 'toolchainVersion=21\n',
      }),
    })
    expect(resolu.versionExigee).toBe(21)
    expect(resolu.chemin).toBeNull()
  })

  it('puis JAVA_HOME — LE coupable du terrain', () => {
    const resolu = jvmDeGradle({
      home: HOME,
      projetAndroid: ANDROID,
      env: { JAVA_HOME: '/jdk25' },
      ...disque({}),
    })
    expect(resolu.chemin).toBe('/jdk25')
    expect(resolu.source).toBe('JAVA_HOME')
  })

  it('le PATH en DERNIER, et seulement alors', () => {
    const resolu = jvmDeGradle({ home: HOME, projetAndroid: ANDROID, env: {}, ...disque({}) })
    expect(resolu.chemin).toBeNull()
    expect(resolu.source).toContain('PATH')
  })

  it('ignore un JAVA_HOME vide ou réduit à des espaces', () => {
    for (const vide of ['', '   ']) {
      expect(jvmDeGradle({ home: HOME, env: { JAVA_HOME: vide }, ...disque({}) }).source).toContain(
        'PATH',
      )
    }
  })

  it('retire les guillemets qu’un JAVA_HOME Windows traîne parfois', () => {
    const resolu = jvmDeGradle({
      home: HOME,
      env: { JAVA_HOME: '"C:\\Program Files\\Java\\jdk-21"' },
      ...disque({}),
    })
    expect(resolu.chemin).toBe('C:\\Program Files\\Java\\jdk-21')
  })

  it('lit le gradle.properties que GRADLE_USER_HOME désigne, pas ~/.gradle', () => {
    const resolu = jvmDeGradle({
      home: HOME,
      env: { GRADLE_USER_HOME: '/ailleurs/gradle', JAVA_HOME: '/jdk25' },
      ...disque({ '/ailleurs/gradle/gradle.properties': 'org.gradle.java.home=/jdk21\n' }),
    })
    expect(resolu.chemin).toBe('/jdk21')
  })
})

describe('lire org.gradle.java.home d’un .properties', () => {
  it('dédouble les antislashs, comme Java le fait', () => {
    // Un chemin Windows correctement écrit dans un .properties est échappé.
    // Ne pas le dédoubler ferait chercher un dossier inexistant, et conclure
    // à tort que la ligne est fausse.
    expect(
      lireJavaHomeDesProprietes(
        'org.gradle.java.home=C:\\\\Program Files\\\\Eclipse Adoptium\\\\jdk-21\n',
      ),
    ).toBe('C:\\Program Files\\Eclipse Adoptium\\jdk-21')
  })

  it('IGNORE une ligne commentée — la désactiver doit la désactiver', () => {
    expect(lireJavaHomeDesProprietes('# org.gradle.java.home=/jdk25\n')).toBeNull()
    expect(lireJavaHomeDesProprietes('! org.gradle.java.home=/jdk25\n')).toBeNull()
  })

  it('accepte la forme « : » et les espaces autour', () => {
    expect(lireJavaHomeDesProprietes('  org.gradle.java.home : /jdk21  \n')).toBe('/jdk21')
  })

  it('rend null quand la propriété est absente ou vide', () => {
    expect(lireJavaHomeDesProprietes('org.gradle.jvmargs=-Xmx1536m\n')).toBeNull()
    expect(lireJavaHomeDesProprietes('org.gradle.java.home=\n')).toBeNull()
    expect(lireJavaHomeDesProprietes('')).toBeNull()
  })

  it('ne se laisse pas prendre par une propriété au nom proche', () => {
    expect(lireJavaHomeDesProprietes('org.gradle.java.home.autre=/jdk25\n')).toBeNull()
  })
})

describe('où vit le dossier Gradle de l’utilisateur', () => {
  it('~/.gradle par défaut', () => {
    expect(dossierGradleUtilisateur({}, '/home/salem')).toBe(join('/home/salem', '.gradle'))
  })

  it('GRADLE_USER_HOME quand il est posé — sinon « --ecrire » écrit dans le vide', () => {
    // DÉFAUT TROUVÉ EN TESTANT : `ecrireOverrideGradle` codait `~/.gradle` en
    // dur. Sur un poste qui pose cette variable, il annonçait « ✓ ligne
    // ajoutée » dans un fichier que Gradle ne lit pas.
    expect(dossierGradleUtilisateur({ GRADLE_USER_HOME: '/ailleurs' }, '/home/salem')).toBe(
      '/ailleurs',
    )
  })

  it('ignore une variable vide', () => {
    expect(dossierGradleUtilisateur({ GRADLE_USER_HOME: '  ' }, '/home/salem')).toBe(
      join('/home/salem', '.gradle'),
    )
  })
})

/*
 * Le contrat de bout en bout, sur la panne exacte du terrain.
 *
 * On fabrique un faux JDK 25 — un `bin/java` qui imite la bannière — et on le
 * désigne par `JAVA_HOME`, le PATH gardant son JDK 21. C'est la configuration
 * du poste du gérant, au caractère près.
 */
describe('le CLI, sur la configuration exacte qui a échoué', () => {
  const script = fileURLToPath(new URL('./verifier-jdk.mjs', import.meta.url))

  /** Un JDK de théâtre : il ne sait que dire sa version. */
  function fauxJdk(majeure: number): string {
    const racine = mkdtempSync(join(tmpdir(), `kaissi-faux-jdk${majeure}-`))
    mkdirSync(join(racine, 'bin'), { recursive: true })
    const java = join(racine, 'bin', 'java')
    writeFileSync(
      java,
      `#!/bin/sh\necho 'openjdk version "${majeure}.0.1" 2026-10-21' 1>&2\n`,
      { mode: 0o755 },
    )
    return racine
  }

  it.skipIf(process.platform === 'win32')(
    'REFUSE un JAVA_HOME en JDK 25, même quand le `java` du PATH est bon',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'kaissi-jdk-cli-'))
      const lance = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          JAVA_HOME: fauxJdk(25),
          GRADLE_USER_HOME: join(home, '.gradle'),
        },
      })
      const sortie = `${lance.stdout}${lance.stderr}`

      // AVANT le correctif, ce script sortait en 0 avec « ✓ JDK 21 ».
      expect(lance.status).toBe(1)
      expect(sortie).toContain('JDK 25')
      expect(sortie).toContain('major version 69')
      // Et il NOMME la source : « JAVA_HOME » et « le java du PATH » ne se
      // corrigent pas au même endroit.
      expect(sortie).toContain('JAVA_HOME')
    },
  )

  it.skipIf(process.platform === 'win32')(
    'l’override écrit par --ecrire l’emporte ENSUITE sur ce JAVA_HOME',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'kaissi-jdk-cli-'))
      const gradleHome = join(home, '.gradle')
      const env = {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        JAVA_HOME: fauxJdk(25),
        GRADLE_USER_HOME: gradleHome,
      }

      const ecriture = spawnSync(process.execPath, [script, '--ecrire'], { encoding: 'utf8', env })
      const fichier = join(gradleHome, 'gradle.properties')
      // Ce poste peut n'avoir aucun JDK localisable : le contrat porte alors
      // sur le refus explicite, jamais sur un silence.
      if (!existsSync(fichier)) {
        expect(`${ecriture.stdout}${ecriture.stderr}`).toContain("--ecrire n'a rien écrit")
        return
      }

      // Le réglage doit maintenant DÉCIDER, JAVA_HOME restant mauvais.
      const apres = spawnSync(process.execPath, [script], { encoding: 'utf8', env })
      expect(apres.status).toBe(0)
      expect(`${apres.stdout}${apres.stderr}`).toContain('org.gradle.java.home')
    },
  )

  it.skipIf(process.platform === 'win32')(
    'dit qu’un JAVA_HOME qui ne désigne pas un JDK n’en est pas un',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'kaissi-jdk-cli-'))
      // Le cas banal : la variable pointe un dossier déplacé ou désinstallé.
      const lance = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          JAVA_HOME: join(home, 'jdk-qui-nexiste-pas'),
          GRADLE_USER_HOME: join(home, '.gradle'),
        },
      })
      expect(lance.status).toBe(1)
      expect(`${lance.stdout}${lance.stderr}`).toContain("n'est pas un JDK")
    },
  )
})
