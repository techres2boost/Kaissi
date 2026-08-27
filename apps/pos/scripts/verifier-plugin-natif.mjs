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
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const racinePos = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dossierStubs = join(racinePos, 'scripts', 'stubs-android')
const dossierPlugin = join(racinePos, 'android', 'app', 'src', 'main', 'java', 'tn', 'res2boost', 'kaissi')

const echecs = []
const constats = []

function echouer(message, detail) {
  echecs.push(detail ? `${message}\n     ${detail}` : message)
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
  try {
    execFileSync(
      'javac',
      ['-nowarn', '-Werror', '-Xlint:all,-options', '-d', sortie, ...sources],
      { stdio: 'pipe', encoding: 'utf8' },
    )
    compile = true
    constats.push(`compilation propre de ${fichiersJava(dossierPlugin).length} fichiers natifs`)
  } catch (erreur) {
    echouer('Le plugin natif ne compile pas.', String(erreur.stderr || erreur.stdout || erreur).trim())
  }

  // ── 3. Les annotations survivent dans le bytecode ─────────────────────────
  if (compile) {
    const bytecode = execFileSync(
      'javap',
      ['-v', '-cp', sortie, 'tn.res2boost.kaissi.ImprimanteReseau'],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
    )
    if (!/com\.getcapacitor\.annotation\.CapacitorPlugin\(\s*name="ImprimanteReseau"/.test(bytecode)) {
      echouer(
        'L\'annotation @CapacitorPlugin(name = "ImprimanteReseau") est absente du bytecode.',
        'Le nom doit correspondre EXACTEMENT à registerPlugin() dans src/plugins/imprimante.ts.',
      )
    } else {
      constats.push('@CapacitorPlugin(name = "ImprimanteReseau") présente à l\'exécution')
    }

    for (const methode of ['imprimer', 'tester']) {
      const motif = new RegExp(`public void ${methode}\\(com\\.getcapacitor\\.PluginCall\\)`)
      if (!motif.test(execFileSync('javap', ['-cp', sortie, 'tn.res2boost.kaissi.ImprimanteReseau'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }))) {
        echouer(`La méthode « ${methode} » n'est pas exposée au pont Capacitor.`)
      }
    }
    const nbPluginMethod = (bytecode.match(/com\.getcapacitor\.PluginMethod/g) || []).length
    if (nbPluginMethod < 2) {
      echouer(
        `Seules ${nbPluginMethod} méthode(s) portent @PluginMethod dans le bytecode, 2 attendues.`,
        'Sans cette annotation, Capacitor charge le plugin mais aucune méthode n\'est appelable.',
      )
    } else {
      constats.push('@PluginMethod retenue sur imprimer() et tester()')
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
