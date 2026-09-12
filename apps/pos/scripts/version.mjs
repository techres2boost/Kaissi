#!/usr/bin/env node
/**
 * Le numéro de version publié — le lire, et le monter.
 *
 * ── Le piège que ce script existe pour supprimer ──────────────────────────
 *
 * Play refuse un envoi dont le `versionCode` n'est pas STRICTEMENT supérieur
 * au précédent :
 *
 *     Version code 101 has already been used. Try another version code.
 *
 * Et le numéro est brûlé dès le TÉLÉVERSEMENT, pas à la publication.
 * « Discard draft release » annule la version, pas la consommation du
 * numéro : on croit repartir de zéro, et le même AAB est refusé. Vu sur le
 * premier envoi réel.
 *
 * Il n'y a aucun moyen de récupérer un numéro consommé. La seule réponse est
 * de monter — d'où cette commande, qui évite à la fois l'édition manuelle du
 * `package.json` et l'arithmétique de tête.
 *
 * ── Pourquoi le calcul vit ICI et dans build.gradle ───────────────────────
 *
 * Les deux en ont besoin à des moments où l'autre n'existe pas : Gradle à la
 * configuration du projet, Node avant même que Gradle ne démarre. Les deux
 * implémentations sont donc inévitables — mais `version.test.ts` les tient
 * sur les MÊMES exemples, en lisant le `build.gradle` réel. Si l'une des deux
 * dérive, le test tombe.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const POS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAQUET = join(POS, 'package.json')

/**
 * `1.4.2` → `10402`. Deux chiffres par segment : l'ordre naturel est
 * préservé, et il n'y a pas de collision jusqu'à 99 correctifs par mineure.
 *
 * Un suffixe de préversion est ignoré (`2.3.1-rc4` → `20301`) : une
 * préversion et sa version finale portent le même code, ce qui est voulu —
 * on ne publie pas les deux.
 */
export function codeDeVersion(version) {
  const segments = String(version).split('.')
  const nombre = (s, defaut = 0) => {
    if (s === undefined) return defaut
    const nu = s.replace(/\D.*/, '')
    return nu === '' ? defaut : Number(nu)
  }
  return nombre(segments[0]) * 10000 + nombre(segments[1]) * 100 + nombre(segments[2])
}

/** `0.1.1` → `0.1.2`. Le correctif, parce qu'un envoi n'est pas une mineure. */
export function versionSuivante(version) {
  const segments = String(version).split('.')
  const majeure = Number(segments[0]?.replace(/\D.*/, '') || 0)
  const mineure = Number(segments[1]?.replace(/\D.*/, '') || 0)
  const correctif = Number(segments[2]?.replace(/\D.*/, '') || 0)
  if (correctif >= 99) {
    // 99 correctifs : le segment suivant déborderait sur la mineure et
    // PRODUIRAIT UN CODE INFÉRIEUR au précédent. Play le refuserait, et on
    // chercherait pourquoi.
    return `${majeure}.${mineure + 1}.0`
  }
  return `${majeure}.${mineure}.${correctif + 1}`
}

export function lireVersion(fichier = PAQUET) {
  return JSON.parse(readFileSync(fichier, 'utf8')).version
}

/** Monte la version dans `package.json`, en préservant le formatage. */
export function monter(fichier = PAQUET) {
  const brut = readFileSync(fichier, 'utf8')
  const paquet = JSON.parse(brut)
  const avant = paquet.version
  const apres = versionSuivante(avant)
  // Remplacement CIBLÉ plutôt qu'une réécriture JSON : `JSON.stringify`
  // reformaterait tout le fichier, et le diff noierait le seul changement.
  const suivant = brut.replace(
    new RegExp(`("version"\\s*:\\s*")${avant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`),
    `$1${apres}$2`,
  )
  if (suivant === brut) throw new Error(`Version « ${avant} » introuvable dans ${fichier}.`)
  writeFileSync(fichier, suivant, 'utf8')
  return { avant, apres }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  if (process.argv.includes('--monter')) {
    const { avant, apres } = monter()
    console.log(
      `\n  ✓ ${avant} → ${apres}\n\n` +
        `    versionCode : ${codeDeVersion(avant)} → ${codeDeVersion(apres)}\n\n` +
        '    Reconstruisez : pnpm pos:aab\n',
    )
  } else {
    const version = lireVersion()
    console.log(
      `\n  Version : ${version}   ·   versionCode : ${codeDeVersion(version)}\n\n` +
        '  Play refuse un code déjà TÉLÉVERSÉ — « Discard draft release » ne le\n' +
        '  libère pas. Pour monter :  pnpm pos:version --monter\n',
    )
  }
}
