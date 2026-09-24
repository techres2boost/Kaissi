#!/usr/bin/env node
/**
 * Les renvois internes de la documentation mènent-ils quelque part ?
 *
 * ── Pourquoi une garde pour ça ────────────────────────────────────────────
 *
 * `docs/system-design.md` fait mille cinq cents lignes et porte une table des
 * matières de quarante liens. Un titre qu'on reformule casse son ancre en
 * silence : le lien reste cliquable, il ne descend simplement nulle part. Rien
 * n'échoue, personne ne s'en aperçoit, et le document perd sa table des
 * matières un titre à la fois.
 *
 * C'est le même raisonnement que partout ailleurs dans ce dépôt : une règle
 * écrite est respectée six mois, une règle vérifiée l'est toujours.
 *
 * ── Ce qu'elle vérifie, et ce qu'elle ne vérifie pas ──────────────────────
 *
 * Les ancres internes (`](#…)`) et les chemins de fichiers cités entre
 * accents graves dans les renvois `⟶`. Elle ne juge pas le CONTENU : un
 * paragraphe périmé passe, et c'est une relecture humaine qui l'attrape.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)))
const DOCS = join(RACINE, 'docs')

/**
 * Le découpage de GitHub, reproduit.
 *
 * ⚑ La ponctuation est SUPPRIMÉE, pas remplacée : les espaces qui entouraient
 *   un tiret cadratin subsistent, d'où les doubles tirets des ancres réelles.
 *   Une première version le remplaçait par un tiret et déclarait fautives les
 *   quarante ancres du document — un garde-fou qui accuse tout n'accuse rien.
 */
function ancre(titre) {
  return titre
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}

let fautes = 0
const dire = (message) => {
  console.error(`  ✗ ${message}`)
  fautes += 1
}

for (const nom of readdirSync(DOCS).filter((f) => f.endsWith('.md'))) {
  const chemin = join(DOCS, nom)
  const texte = readFileSync(chemin, 'utf8')

  const titres = new Set(
    [...texte.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => ancre(m[1])),
  )

  for (const lien of texte.matchAll(/\]\(#([^)]+)\)/g)) {
    if (!titres.has(lien[1])) {
      dire(`${nom} — ancre introuvable : #${lien[1]}`)
    }
  }

  /*
   * Les renvois vers le code, tels que system-design.md les écrit :
   *     > ⟶ `packages/domain/src/totaux.ts:80` — `calculerTotaux()`
   * Le numéro de ligne n'est pas vérifié — il bouge à chaque commit, et le
   * document dit lui-même que c'est le NOM du symbole qui est l'ancre
   * durable. Le fichier, lui, doit exister : un renvoi vers un fichier
   * supprimé est un patron qui n'est plus dans ce dépôt.
   */
  for (const renvoi of texte.matchAll(/^>\s*⟶\s*`([^`:]+)(?::\d+)?`(.*)$/gm)) {
    const fichier = renvoi[1].trim()
    const cible = join(RACINE, fichier)
    if (!existsSync(cible)) {
      dire(`${nom} — renvoi vers un fichier absent : ${fichier}`)
      continue
    }
    if (statSync(cible).isDirectory()) continue

    /*
     * Le SYMBOLE nommé après le chemin existe-t-il dans ce fichier ?
     *
     * C'est lui, l'ancre durable — le document le dit. Un renvoi
     * « 0002_tenance.sql — `protege_transactionnel()` » pointait vers un
     * fichier bien réel, qui ne contenait pas la fonction : elle vit dans la
     * 0003. Vérifier le fichier seul laissait passer l'erreur.
     *
     * Seuls les noms d'un seul tenant sont vérifiés : une expression comme
     * « bigint generated always as identity » dépend de l'alignement du SQL.
     */
    const contenu = readFileSync(cible, 'utf8')
    for (const symbole of renvoi[2].matchAll(/`([^`]+)`/g)) {
      const nomSymbole = symbole[1].replace(/\(.*\)$/, '').trim()
      if (!nomSymbole || /\s/.test(nomSymbole)) continue
      if (!contenu.includes(nomSymbole)) {
        dire(`${nom} — « ${nomSymbole} » introuvable dans ${fichier}`)
      }
    }
  }
}

/*
 * ── Les renvois « § X » du cahier de recette ──────────────────────────────
 *
 * `docs/demo.md` renvoie d'une table de recette vers ses sections détaillées
 * — « § U.3 », « § Q.1 bis ». Ce ne sont pas des liens Markdown : ils ne
 * cliquent pas, donc rien ne les vérifie, et une section renommée les laisse
 * pointer dans le vide. C'est précisément la table qu'on suit pour tester le
 * produit de bout en bout : un renvoi faux y coûte dix minutes de recherche.
 *
 * Les étiquettes reconnues sont celles des titres ET des sous-titres en gras
 * (« **1.2 — …** »), que le document utilise pour ses étapes numérotées.
 */
{
  const chemin = join(DOCS, 'demo.md')
  if (existsSync(chemin)) {
    const texte = readFileSync(chemin, 'utf8')
    const etiquette = /^([0-9]+(?:\.[0-9]+)?(?:\s+(?:bis|ter|quater))?|[A-Z](?:\.[0-9]+)?(?:\s+(?:bis|ter|quater))?)[.\s—]/

    const connues = new Set()
    for (const m of texte.matchAll(/^(?:#{2,6}\s+|\*\*)(.+?)(?:\*\*)?$/gm)) {
      const e = etiquette.exec(m[1].trim())
      if (e) connues.add(e[1].trim())
    }

    // « — § U.3 |» en fin de cellule : la forme qu'emploie la table.
    for (const renvoi of texte.matchAll(/— § ([A-Z0-9][^|\n]*?)\s*\|/g)) {
      for (const cible of renvoi[1].split(/\s+et\s+§\s+/)) {
        if (!connues.has(cible.trim())) {
          dire(`demo.md — renvoi vers une section inexistante : § ${cible.trim()}`)
        }
      }
    }
  }
}

if (fautes > 0) {
  console.error(`\n  ${fautes} renvoi(s) cassé(s) dans docs/.\n`)
  process.exit(1)
}
console.log('  ✓ Tous les renvois de docs/ mènent quelque part.')
