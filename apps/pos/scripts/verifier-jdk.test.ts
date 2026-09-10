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
// @ts-expect-error — script Node en JS pur, sans déclarations de types.
import { majeureJava, versionDeClasse, diagnostiquer } from './verifier-jdk.mjs'

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
    // Le lien avec ce que le gérant a SOUS LES YEUX est tout l'intérêt.
    expect(bilan.message).toContain('major version 69')
    expect(bilan.message).toContain('JDK 25')
    // Et il doit dire quoi faire, pas seulement ce qui ne va pas.
    expect(bilan.message).toContain('JAVA_HOME')
  })

  it('refuse aussi un JDK trop ancien', () => {
    const bilan = diagnostiquer(11)
    expect(bilan.ok).toBe(false)
    expect(bilan.message).toContain('au moins 17')
  })

  it('ne prétend rien quand il ne sait pas', () => {
    expect(diagnostiquer(null).ok).toBe(false)
  })
})
