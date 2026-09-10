/**
 * Un fichier `'use server'` n'exporte QUE des fonctions asynchrones.
 *
 * ── La panne qui a rendu ce test nécessaire ──────────────────────────────
 *
 * L'écran « Administration → Établissements » ne s'affichait plus du tout
 * en production : à la place, la frontière d'erreur, sans un mot de plus.
 *
 * La cause tenait à une ligne. `FUSEAUX` — un simple tableau de chaînes —
 * était exporté depuis `administration/actions.ts`, qui porte `'use server'`.
 * Next.js remplace, côté navigateur, CHAQUE export d'un tel fichier par un
 * mandataire d'action serveur. Le composant client recevait donc un
 * mandataire là où il attendait un tableau, et `FUSEAUX.map(…)` levait
 * « u.map is not a function » au moment du rendu.
 *
 * ── Pourquoi rien ne l'avait attrapé ─────────────────────────────────────
 *
 *   • `tsc` voit un `readonly string[]` parfaitement typé : le remplacement
 *     a lieu à l'EMPAQUETAGE, bien après lui ;
 *   • `next build` ne dit rien — vérifié, la construction passe ;
 *   • la CI était verte, sur les dix jobs.
 *
 * Un défaut que ni les types, ni le build, ni la CI ne voient, et qui tue un
 * écran entier : c'est exactement le genre qu'il faut figer par un test.
 *
 * ── Ce que ce test accepte, et pourquoi ──────────────────────────────────
 *
 * Les `interface` et les `type` sont sans risque : ils s'effacent à la
 * compilation, il n'en reste rien à empaqueter. Tout le reste — `const`,
 * `class`, `function` non-`async`, ré-export — voyage, et casse.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = new URL('../', import.meta.url).pathname

function fichiersSources(repertoire: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(repertoire)) {
    const chemin = join(repertoire, entree)
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersSources(chemin))
    } else if (/\.tsx?$/.test(entree) && !entree.endsWith('.test.ts')) {
      trouves.push(chemin)
    }
  }
  return trouves
}

/** Les fichiers qui portent la directive, quelle que soit la citation. */
function modulesServeur(): { chemin: string; source: string }[] {
  return fichiersSources(RACINE)
    .map((chemin) => ({ chemin, source: readFileSync(chemin, 'utf8') }))
    .filter(({ source }) => /^\s*['"]use server['"]/m.test(source))
}

describe("les fichiers « use server »", () => {
  it('en compte au moins un — sinon ce test ne protège rien', () => {
    expect(modulesServeur().length).toBeGreaterThan(0)
  })

  it("n'exportent QUE des fonctions async (les types ne comptent pas)", () => {
    const fautes: string[] = []

    for (const { chemin, source } of modulesServeur()) {
      const lignes = source.split('\n')
      lignes.forEach((ligne, index) => {
        if (!/^export\b/.test(ligne)) return
        // Les types s'effacent à la compilation : rien à empaqueter.
        if (/^export\s+(interface|type)\b/.test(ligne)) return
        if (/^export\s+async\s+function\b/.test(ligne)) return

        fautes.push(
          `${chemin.replace(RACINE, 'src/')}:${index + 1} — ${ligne.trim()}`,
        )
      })
    }

    expect(
      fautes,
      "Un fichier « use server » ne peut exporter que des fonctions async : Next.js\n" +
        "remplace tous ses autres exports par des mandataires côté navigateur, et le\n" +
        "composant client reçoit alors un mandataire là où il attend une valeur.\n" +
        "Ni tsc ni next build ne le signalent — l'écran meurt à l'exécution.\n" +
        'Déplacer la valeur dans un module ordinaire (voir administration/fuseaux.ts).\n\n' +
        fautes.join('\n'),
    ).toEqual([])
  })
})
