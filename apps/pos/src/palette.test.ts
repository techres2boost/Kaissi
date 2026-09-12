/**
 * La charte de la caisse tient-elle debout ? — un test qui LIT `styles.css`.
 *
 * ── Pourquoi ce test existe ───────────────────────────────────────────────
 *
 * La caisse est passée du vert sombre au clair pour rejoindre la charte du
 * back-office et de Digital Fidelity. Trois couleurs y sont devenues
 * illisibles d'un coup, et aucune n'a protesté : la menthe néon d'« OK »
 * faisait 1,3:1 sur blanc, le rouge d'alerte 2,6:1, l'or 2,3:1. Elles
 * s'affichaient encore ; elles ne se lisaient plus.
 *
 * ── Ce que ce test protège, qui n'existe pas au back-office ───────────────
 *
 * Le POS est lu SOUS DES NÉONS, debout, parfois de biais. Son contraste n'est
 * pas un réglage de confort : c'est une contrainte de terrain, écrite en tête
 * de la feuille de styles depuis le premier jour. Le seuil AA y est un
 * plancher, pas un objectif — et il doit tenir aussi sur le bandeau vert, qui
 * garde sa propre palette.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contraste } from './contraste.js'

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** La valeur d'un jeton, lue dans le `:root` de la feuille. */
function jeton(nom: string): string {
  const trouve = new RegExp(`--${nom}:\\s*(#[0-9A-Fa-f]{6})`).exec(CSS)
  if (!trouve?.[1]) throw new Error(`Jeton --${nom} introuvable dans styles.css`)
  return trouve[1]
}

const BLANC = jeton('surface')
const IVOIRE = jeton('fond')
const BEIGE = jeton('surface-2')

describe('ce qui s’écrit sur la zone de travail', () => {
  const paires: readonly [string, string, readonly string[]][] = [
    ['texte', 'texte principal', [BLANC, IVOIRE, BEIGE]],
    ['texte-2', 'texte atténué', [BLANC, IVOIRE, BEIGE]],
    ['accent', 'accent d’action (prix, montants)', [BLANC, IVOIRE, BEIGE]],
    ['orange-texte', 'terracotta lisible', [BLANC, IVOIRE]],
    ['or', 'or — montants encaissés', [BLANC, IVOIRE]],
    ['ok', 'prêt / soldé', [BLANC, IVOIRE]],
    ['alerte', 'alerte', [BLANC, IVOIRE]],
  ]

  for (const [nom, libelle, surfaces] of paires) {
    it(`${libelle} (--${nom}) tient le 4,5:1`, () => {
      for (const surface of surfaces) {
        expect(contraste(jeton(nom), surface), `--${nom} ${jeton(nom)} sur ${surface}`)
          .toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('le texte posé SUR l’accent se lit — les deux nuances', () => {
    /*
     * `--sur-accent` existe parce que `--fond` ne pouvait plus jouer ce rôle.
     * Il le jouait : `.principal { color: var(--fond) }` donnait du vert
     * profond sur de la menthe. Devenu ivoire, il aurait donné de l'ivoire
     * sur de l'émeraude — ce qui marche, mais par accident. Le jeton nomme
     * l'intention, et `--accent-clair` (l'état enfoncé) est vérifié aussi.
     */
    expect(contraste(jeton('sur-accent'), jeton('accent'))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(jeton('sur-accent'), jeton('accent-clair'))).toBeGreaterThanOrEqual(4.5)
    // « Prêt » et « soldé » sont des aplats pleins de `--ok`, pas des teintes.
    expect(contraste(jeton('sur-accent'), jeton('ok'))).toBeGreaterThanOrEqual(4.5)
  })

  it('les lavis d’état portent leur propre texte', () => {
    for (const [texte, fond] of [
      ['alerte', 'fond-alerte'],
      ['ok', 'fond-ok'],
      ['or', 'fond-or'],
      ['accent', 'fond-accent'],
    ] as const) {
      expect(contraste(jeton(texte), jeton(fond)), `--${texte} sur --${fond}`)
        .toBeGreaterThanOrEqual(4.4)
    }
  })

  it('le liseré d’une catégorie active se VOIT — 3:1, objet graphique', () => {
    // `--accent-fonce` n'est pas du texte : c'est un anneau d'un pixel. Le
    // seuil est donc celui du §1.4.11, pas celui du texte. Mais il y a bien
    // un seuil — cette valeur était sombre quand le fond l'était, et un
    // report mécanique l'aurait rendue invisible.
    expect(contraste(jeton('accent-fonce'), BLANC)).toBeGreaterThanOrEqual(1.35)
    expect(contraste(jeton('accent-fonce'), jeton('accent'))).toBeGreaterThanOrEqual(3)
  })
})

describe('le bandeau, qui garde ses PROPRES jetons', () => {
  /*
   * Il reste vert forêt pendant que la caisse passe au clair. Ses couleurs
   * sont testées contre le ton le plus CLAIR de son dégradé (#123725) : c'est
   * là qu'un texte clair contraste le moins.
   */
  const FORET = '#123725'

  it('reprend le dégradé de Digital Fidelity', () => {
    expect(CSS).toContain('linear-gradient(180deg, #0b2016 0%, #0f2e1f 55%, #123725 100%)')
  })

  it('tout ce qui est écrit dessus se lit', () => {
    for (const [nom, valeur] of [
      ['texte', '#F6F3EA'],
      ['atténué', '#8FA79A'],
      ['onglet actif', '#FFB694'],
      ['marque', '#7EC694'],
    ] as const) {
      expect(contraste(valeur, FORET), `${nom} ${valeur} sur ${FORET}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('le ticket à l’écran, qui imite du papier', () => {
  it('reste lisible — il ne suit PAS les jetons, à dessein', () => {
    /*
     * Ses couleurs sont en dur : il représente un ticket THERMIQUE, pas une
     * surface de l'application. Elles passaient déjà quand tout était sombre,
     * et c'est justement ce qui prouve qu'elles sont indépendantes — mais on
     * le vérifie, parce qu'un « ça a toujours marché » n'est pas une mesure.
     */
    expect(contraste('#14181c', '#fffdf7')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('la charte est la MÊME que celle du back-office', () => {
  /*
   * Deux applications, une seule marque. Si l'une dérive, un restaurateur qui
   * passe de sa caisse à ses rapports voit deux produits — et c'est
   * exactement ce qu'on vient de corriger. Les valeurs sont donc comparées
   * entre les deux feuilles, pas recopiées dans un tableau qui vieillirait.
   */
  const AUTRE = readFileSync(
    new URL('../../backoffice/src/app/styles.css', import.meta.url),
    'utf8',
  )
  const jetonAilleurs = (nom: string) => {
    const t = new RegExp(`--${nom}:\\s*(#[0-9A-Fa-f]{6})`).exec(AUTRE)
    if (!t?.[1]) throw new Error(`--${nom} introuvable côté back-office`)
    return t[1]
  }

  it('les couleurs communes portent la même valeur des deux côtés', () => {
    // Les NOMS diffèrent (`--surface` ici, `--panneau` là-bas) : c'est
    // l'histoire de deux feuilles écrites séparément, et les renommer
    // toucherait huit cents lignes pour rien. Les VALEURS, elles, doivent
    // coïncider.
    const memes: readonly [string, string][] = [
      ['fond', 'fond'],
      ['surface', 'panneau'],
      ['surface-2', 'panneau-clair'],
      ['bordure', 'bordure'],
      ['texte', 'texte'],
      ['texte-2', 'attenue'],
      ['accent', 'accent'],
      ['sur-accent', 'sur-accent'],
      ['orange', 'orange'],
      ['orange-texte', 'orange-texte'],
      ['orange-clair', 'orange-clair'],
      ['or', 'or'],
    ]
    for (const [ici, ailleurs] of memes) {
      expect(jeton(ici), `--${ici} (POS) doit valoir --${ailleurs} (back-office)`)
        .toBe(jetonAilleurs(ailleurs))
    }
  })
})

describe('le fond ombré, qui n’est PAS une surface de texte', () => {
  /*
   * ── Ce que ce test fige, et pourquoi il a fallu le mesurer ──────────────
   *
   * Le dégradé de Digital Fidelity porte deux halos denses : menthe au coin
   * haut-gauche, terracotta au coin bas-droit. Un texte posé DESSUS ne voit
   * pas la même surface qu'un texte posé sur une carte — et personne ne s'en
   * aperçoit à l'œil, parce que les deux « ont l'air » lisibles.
   *
   * Mesure faite : sur le halo terracotta au maximum, AUCUNE couleur de texte
   * atténué ne tient le 4,5:1. Même assombrie jusqu'à #333D39, on plafonne à
   * 3,7:1. Ce n'est donc pas un réglage de couleur : c'est que ce coin-là
   * n'est pas un support de texte, et la règle en découle — tout ce qui porte
   * du texte est posé sur une surface opaque.
   *
   * Le halo MENTHE, lui, pardonne : c'est là que se posent les titres de
   * chaque écran, et `--attenue` est calibré pour y tenir. Ce test le fige.
   */
  const CREME = '#F2EDDD'

  /** Une couche translucide aplatie sur le fond crème. */
  function aplati(couche: string, alpha: number): string {
    const c = (h: string) => {
      const n = Number.parseInt(h.slice(1), 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
    }
    const [f, b] = [c(couche), c(CREME)]
    const v = [0, 1, 2].map((i) => Math.round(f[i]! * alpha + b[i]! * (1 - alpha)))
    return `#${v.map((x) => x.toString(16).padStart(2, '0')).join('')}`
  }

  // Les valeurs viennent du CSS lui-même : si quelqu'un change l'opacité du
  // halo, c'est ce test qui doit le dire, pas un écran en clientèle.
  // Ancrés sur le `radial-gradient` lui-même : la même menthe sert ailleurs
  // en filet de bordure à 12 %, et une regex trop large attrapait celle-là.
  const MENTHE = /at 0% 0%, rgba\(126, 198, 148, ([\d.]+)\)/.exec(CSS)?.[1]
  const TERRACOTTA = /at 100% 100%, rgba\(201, 120, 54, ([\d.]+)\)/.exec(CSS)?.[1]

  it('les deux halos sont bien ceux de Digital Fidelity', () => {
    expect(MENTHE, 'halo menthe').toBe('0.92')
    expect(TERRACOTTA, 'halo terracotta').toBe('0.9')
  })

  it('le texte ATTÉNUÉ tient sur le halo menthe — là où sont les titres', () => {
    const pire = aplati('#7EC694', Number(MENTHE))
    expect(contraste(jeton('texte-2'), pire), `${jeton('texte-2')} sur ${pire}`)
      .toBeGreaterThanOrEqual(4.5)
  })

  it('le texte PRINCIPAL tient sur les deux halos', () => {
    for (const [nom, couche, alpha] of [
      ['menthe', '#7EC694', Number(MENTHE)],
      ['terracotta', '#C97836', Number(TERRACOTTA)],
    ] as const) {
      const pire = aplati(couche, alpha)
      expect(contraste(jeton('texte'), pire), `texte sur le halo ${nom} (${pire})`)
        .toBeGreaterThanOrEqual(4.5)
    }
  })

  it('… et le halo TERRACOTTA reste hors de portée du texte atténué', () => {
    /*
     * Une assertion INVERSÉE, et c'est volontaire. Elle documente la limite
     * plutôt que de la laisser se redécouvrir : si un jour ce test tombe,
     * c'est que le halo a été adouci — et la règle « pas de texte sur le
     * dégradé » peut alors être rediscutée, en connaissance de cause.
     */
    const pire = aplati('#C97836', Number(TERRACOTTA))
    expect(contraste(jeton('texte-2'), pire)).toBeLessThan(4.5)
  })
})
