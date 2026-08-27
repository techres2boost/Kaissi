#!/usr/bin/env node
/**
 * Vérifie le plugin natif d'impression SANS SDK Android.
 *
 * Pourquoi : `ImprimanteReseau.java` est le seul code natif du projet. Il
 * échappe à toute la batterie de tests TypeScript, et il ne se compile
 * normalement qu'au moment du `./gradlew assembleDebug` — donc tard, sur un
 * poste équipé, et par une seule personne. Une signature Java erronée
 * resterait invisible pendant des semaines.
 *
 * Trois contrôles, dans cet ordre :
 *
 *   1. Les doublures de `scripts/stubs-android/` correspondent-elles encore
 *      aux sources RÉELLES de Capacitor ? Sans ce contrôle, la vérification
 *      serait du théâtre : une doublure périmée compile toujours.
 *   2. Le plugin compile-t-il, sans avertissement ?
 *   3. Les annotations `@CapacitorPlugin` et `@PluginMethod` survivent-elles
 *      dans le bytecode ? Capacitor découvre les méthodes par réflexion : une
 *      annotation absente donne un plugin qui se charge mais dont aucune
 *      méthode n'est appelable — panne silencieuse, à l'exécution seulement.
 *
 * Ce que ce script NE prouve PAS : ni le build Gradle complet (ressources,
 * fusion du manifeste, désucrage, R8), ni qu'une imprimante imprime.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lireClasse } from './lire-bytecode.mjs'

/** Doit correspondre à registerPlugin() dans src/plugins/imprimante.ts. */
const NOM_PLUGIN = 'ImprimanteReseau'
const METHODES_ATTENDUES = ['imprimer', 'tester']

const racinePos = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dossierStubs = join(racinePos, 'scripts', 'stubs-android')
const dossierPlugin = join(racinePos, 'android', 'app', 'src', 'main', 'java', 'tn', 'res2boost', 'kaissi')

const echecs = []
const constats = []

function echouer(message, detail) {
  echecs.push(detail ? `${message}\n     ${detail}` : message)
}

/**
 * Localise un outil du JDK.
 *
 * Sous Windows, `javac` s'appelle `javac.exe` et n'est pas toujours dans le
 * PATH. Chercher d'abord dans JAVA_HOME/bin évite un « spawnSync ENOENT »
 * incompréhensible, là où le correctif tient en une variable d'environnement.
 */
function outilJdk(nom) {
  const suffixes = platform() === 'win32' ? ['.exe', '.cmd', ''] : ['']
  const dossiers = []
  if (process.env['JAVA_HOME']) dossiers.push(join(process.env['JAVA_HOME'], 'bin'))
  dossiers.push(...(process.env['PATH'] ?? '').split(delimiter).filter(Boolean))

  for (const dossier of dossiers) {
    for (const suffixe of suffixes) {
      const chemin = join(dossier, nom + suffixe)
      if (existsSync(chemin)) return chemin
    }
  }
  return null
}

/** Liste récursive des fichiers `.java` d'un dossier. */
function fichiersJava(dossier) {
  const trouves = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) trouves.push(...fichiersJava(chemin))
    else if (entree.endsWith('.java')) trouves.push(chemin)
  }
  return trouves
}

// ── 1. Les doublures n'ont pas dérivé ───────────────────────────────────────
//
// Chaque entrée : le fichier source réel de Capacitor, et les signatures que
// nos doublures déclarent et que le plugin appelle réellement. Si Capacitor
// change l'une d'elles, la compilation ci-dessous continuerait de passer sur
// une API qui n'existe plus — c'est exactement ce que ce contrôle empêche.
const SIGNATURES_ATTENDUES = {
  'PluginCall.java': [
    'public void resolve(JSObject data)',
    'public void reject(String msg)',
    'public String getString(String name)',
    'public Integer getInt(String name, @Nullable Integer defaultValue)',
  ],
  'JSObject.java': [
    'public JSObject put(String key, boolean value)',
    'public JSObject put(String key, int value)',
    'public JSObject put(String key, long value)',
    'public JSObject put(String key, String value)',
  ],
  'Plugin.java': ['protected void handleOnDestroy()'],
  'BridgeActivity.java': [
    'protected void onCreate(Bundle savedInstanceState)',
    'public void registerPlugin(Class<? extends Plugin> plugin)',
  ],
}

const racineCapacitor = join(
  racinePos,
  'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor',
)

if (!existsSync(racineCapacitor)) {
  echouer(
    'Sources Capacitor introuvables — les doublures ne peuvent pas être vérifiées.',
    `Attendu : ${racineCapacitor} (lancer « pnpm install »)`,
  )
} else {
  for (const [fichier, signatures] of Object.entries(SIGNATURES_ATTENDUES)) {
    const chemin = join(racineCapacitor, fichier)
    if (!existsSync(chemin)) {
      echouer(`Capacitor ne fournit plus ${fichier}.`)
      continue
    }
    const source = readFileSync(chemin, 'utf8')
    for (const signature of signatures) {
      if (!source.includes(signature)) {
        echouer(
          `L'API Capacitor a changé : ${fichier} ne déclare plus « ${signature} ».`,
          'Mettre à jour scripts/stubs-android/ ET le plugin, puis relancer.',
        )
      }
    }
  }

  // `bridgeBuilder` doit être initialisé à la DÉCLARATION du champ : c'est ce
  // qui rend légitime l'appel à registerPlugin() AVANT super.onCreate() dans
  // MainActivity. Si Capacitor déplaçait cette création dans onCreate(), notre
  // plugin serait enregistré sur un objet inexistant — et jamais chargé.
  const bridgeActivity = readFileSync(join(racineCapacitor, 'BridgeActivity.java'), 'utf8')
  if (!/final Bridge\.Builder bridgeBuilder = new Bridge\.Builder\(this\)/.test(bridgeActivity)) {
    echouer(
      'BridgeActivity n\'initialise plus « bridgeBuilder » à la déclaration du champ.',
      "MainActivity.onCreate() enregistre le plugin AVANT super.onCreate() : cet ordre n'est plus sûr.",
    )
  } else {
    constats.push('bridgeBuilder initialisé au champ — enregistrement avant super.onCreate() valide')
  }
}

// ── 2. Le plugin compile ────────────────────────────────────────────────────
const sortie = mkdtempSync(join(tmpdir(), 'kaissi-javac-'))
let compile = false
try {
  const sources = [...fichiersJava(dossierStubs), ...fichiersJava(dossierPlugin)]
  const javac = outilJdk('javac')
  if (!javac) {
    echouer(
      'javac introuvable — un JDK 21 est nécessaire.',
      "Installer un JDK (Temurin, Zulu…) et renseigner JAVA_HOME, ou l'ajouter au PATH.",
    )
  }

  try {
    if (!javac) throw new Error('javac introuvable')
    execFileSync(
      javac,
      ['-nowarn', '-Werror', '-Xlint:all,-options', '-d', sortie, ...sources],
      { stdio: 'pipe', encoding: 'utf8' },
    )
    compile = true
    constats.push(`compilation propre de ${fichiersJava(dossierPlugin).length} fichiers natifs`)
  } catch (erreur) {
    echouer('Le plugin natif ne compile pas.', String(erreur.stderr || erreur.stdout || erreur).trim())
  }

  // ── 3. Les annotations survivent dans le bytecode ─────────────────────────
  //
  // Capacitor découvre les méthodes par RÉFLEXION : une annotation qui ne
  // survit pas à la compilation donne un plugin qui se charge mais dont
  // aucune méthode n'est appelable. La panne n'apparaît qu'à l'exécution, sur
  // l'appareil, quand le ticket ne sort pas.
  //
  // On lit le fichier .class nous-mêmes plutôt que d'appeler `javap` : cet
  // outil n'est pas toujours exposé (certaines installations Windows n'ont
  // que `javac`), et le script plantait alors sur un « spawnSync javap
  // ENOENT » qui ne disait rien de ce qu'il fallait faire.
  if (compile) {
    const classe = lireClasse(
      readFileSync(join(sortie, 'tn', 'res2boost', 'kaissi', 'ImprimanteReseau.class')),
    )

    const surLaClasse = classe.annotations.find(
      (a) => a.type === 'Lcom/getcapacitor/annotation/CapacitorPlugin;',
    )
    if (!surLaClasse) {
      echouer(
        "L'annotation @CapacitorPlugin est absente du bytecode.",
        'Sans elle, le pont Capacitor ne trouve pas le plugin.',
      )
    } else if (surLaClasse.elements['name'] !== NOM_PLUGIN) {
      // Comparaison sur la VALEUR de l'annotation, pas sur la présence du mot
      // quelque part dans le fichier : « ImprimanteReseau » figure de toute
      // façon dans le nom de la classe, et un contrôle par recherche de
      // chaîne laissait donc passer un nom renommé.
      echouer(
        `@CapacitorPlugin(name = "${surLaClasse.elements['name']}") au lieu de "${NOM_PLUGIN}".`,
        'Le nom doit correspondre EXACTEMENT à registerPlugin() dans src/plugins/imprimante.ts.',
      )
    } else {
      constats.push(`@CapacitorPlugin(name = "${NOM_PLUGIN}") présente à l'exécution`)
    }

    const annotees = classe.methodes.filter((m) =>
      m.annotations.some((a) => a.type === 'Lcom/getcapacitor/PluginMethod;'),
    )
    for (const methode of METHODES_ATTENDUES) {
      const trouvee = annotees.find((m) => m.nom === methode)
      if (!trouvee) {
        echouer(
          `La méthode « ${methode} » ne porte pas @PluginMethod dans le bytecode.`,
          "Sans cette annotation, Capacitor charge le plugin mais la méthode n'est pas appelable.",
        )
      } else if (trouvee.descripteur !== '(Lcom/getcapacitor/PluginCall;)V') {
        echouer(
          `« ${methode} » a la signature ${trouvee.descripteur}.`,
          'Le pont n\'appelle que les méthodes « void methode(PluginCall) ».',
        )
      }
    }
    if (annotees.length === METHODES_ATTENDUES.length) {
      constats.push(`@PluginMethod retenue sur ${METHODES_ATTENDUES.join('() et ')}()`)
    }
  }
} finally {
  rmSync(sortie, { recursive: true, force: true })
}

// ── 4. Le contrat JavaScript correspond ─────────────────────────────────────
const interfaceTs = readFileSync(join(racinePos, 'src', 'plugins', 'imprimante.ts'), 'utf8')
if (!interfaceTs.includes("registerPlugin<PluginImprimanteReseau>('ImprimanteReseau'")) {
  echouer("Le nom du plugin côté TypeScript ne correspond plus à « ImprimanteReseau ».")
} else {
  constats.push('nom du plugin identique côté TypeScript et côté Java')
}

const manifeste = readFileSync(
  join(racinePos, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
)
if (!manifeste.includes('android.permission.INTERNET')) {
  echouer(
    'La permission INTERNET manque au manifeste.',
    "Sans elle, le socket TCP vers l'imprimante échoue avec « Permission denied ».",
  )
} else {
  constats.push('permission INTERNET déclarée')
}

// ── Verdict ─────────────────────────────────────────────────────────────────
if (echecs.length > 0) {
  console.error('\n✗ Vérification du plugin natif — ÉCHEC\n')
  for (const echec of echecs) console.error(`  ✗ ${echec}`)
  console.error('')
  process.exit(1)
}

console.log('\n✓ Plugin natif d\'impression vérifié (sans SDK Android)\n')
for (const constat of constats) console.log(`  ✓ ${constat}`)
console.log(
  '\n  ⚠ Ne remplace ni un build Gradle complet ni un essai sur imprimante réelle.\n' +
    '    Voir docs/tester-mode-avion.md § 9 et § 10.\n',
)
