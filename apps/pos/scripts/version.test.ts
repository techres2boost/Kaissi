/**
 * Le numéro de version publié.
 *
 * PANNE RÉELLE, au premier envoi sur Play : « Version code 101 has already
 * been used. Try another version code. » Le `versionCode` avait été consommé
 * par un TÉLÉVERSEMENT précédent — et « Discard draft release », qui semble
 * tout annuler, ne le libère pas.
 *
 * Ce fichier tient deux choses :
 *
 *  1. le calcul lui-même, y compris le débordement à 99 correctifs, qui
 *     produirait un code INFÉRIEUR au précédent ;
 *  2. l'accord entre les DEUX implémentations — celle de Node et celle de
 *     `build.gradle`. Elles sont inévitablement séparées : Gradle en a besoin
 *     à la configuration, Node avant que Gradle ne démarre. Rien d'autre que
 *     ce test ne les empêche de diverger.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
/*
 * Script Node en JS pur — il tourne avant toute compilation. `@ts-expect-error`
 * porte sur la LIGNE du spécificateur de module.
 */
import {
  codeDeVersion,
  versionSuivante,
  monter,
  // @ts-expect-error — script Node en JS pur, sans déclarations de types.
} from './version.mjs'

describe('le versionCode', () => {
  it('range deux chiffres par segment, en préservant l’ordre', () => {
    expect(codeDeVersion('0.1.0')).toBe(100)
    expect(codeDeVersion('0.1.1')).toBe(101)
    expect(codeDeVersion('1.0.0')).toBe(10000)
    expect(codeDeVersion('1.4.2')).toBe(10402)
    expect(codeDeVersion('2.10.99')).toBe(21099)
  })

  it('CROÎT toujours quand la version croît — c’est tout ce que Play exige', () => {
    const versions = ['0.1.0', '0.1.1', '0.1.2', '0.2.0', '0.2.1', '1.0.0', '1.0.1', '1.1.0']
    const codes: number[] = versions.map((v) => codeDeVersion(v) as number)
    for (let i = 1; i < codes.length; i += 1) {
      expect(codes[i], `${versions[i]} doit dépasser ${versions[i - 1]}`).toBeGreaterThan(
        codes[i - 1]!,
      )
    }
  })

  it('ignore un suffixe de préversion', () => {
    expect(codeDeVersion('1.4.2-rc1')).toBe(10402)
  })
})

describe('monter la version', () => {
  it('incrémente le correctif — un envoi n’est pas une mineure', () => {
    expect(versionSuivante('0.1.1')).toBe('0.1.2')
    expect(versionSuivante('1.0.0')).toBe('1.0.1')
  })

  it('passe à la mineure à 99, au lieu de produire un code PLUS PETIT', () => {
    /*
     * `0.1.100` donnerait 0*10000 + 1*100 + 100 = 200, soit exactement
     * `0.2.0` — et surtout, le correctif suivant repasserait sous le code
     * déjà publié. Play refuserait, et on chercherait la raison ailleurs.
     */
    expect(versionSuivante('0.1.99')).toBe('0.2.0')
    expect(codeDeVersion('0.2.0')).toBeGreaterThan(codeDeVersion('0.1.99'))
  })

  it('écrit dans package.json sans reformater le reste du fichier', () => {
    const fichier = fileURLToPath(new URL('./version.test.tmp.json', import.meta.url))
    const original = '{\n  "name": "@kaissi/pos",\n  "version": "0.1.1",\n  "private": true\n}\n'
    writeFileSync(fichier, original)
    try {
      const { avant, apres } = monter(fichier)
      expect(avant).toBe('0.1.1')
      expect(apres).toBe('0.1.2')
      const suivant = readFileSync(fichier, 'utf8')
      expect(suivant).toBe(original.replace('0.1.1', '0.1.2'))
    } finally {
      rmSync(fichier, { force: true })
    }
  })
})

describe('Node et Gradle calculent le MÊME code', () => {
  /*
   * On lit le `build.gradle` RÉEL et on y rejoue son propre calcul. Comparer
   * deux constantes recopiées ne prouverait rien : c'est le fichier qui part
   * dans l'APK.
   */
  const gradle = readFileSync(
    fileURLToPath(new URL('../android/app/build.gradle', import.meta.url)),
    'utf8',
  )

  it('build.gradle applique bien « majeure×10000 + mineure×100 + correctif »', () => {
    const formule = gradle
      .replace(/\s+/g, ' ')
      .includes('majeure * 10000 + mineure * 100 + correctif')
    expect(formule, 'la formule de build.gradle a changé — mettez version.mjs à jour').toBe(true)
  })

  it('et lit sa version dans apps/pos/package.json, pas ailleurs', () => {
    // Si Gradle lisait un autre fichier, `pnpm pos:version --monter` ne
    // changerait rien à l'AAB produit — et Play refuserait encore.
    expect(gradle).toContain("rootProject.file('../package.json')")
    expect(gradle).toContain('versionCode codeVersion')
    expect(gradle).toContain('versionName versionNpm')
  })
})
