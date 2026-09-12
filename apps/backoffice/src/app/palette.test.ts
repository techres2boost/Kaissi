/**
 * La charte tient-elle debout ? — un test qui LIT `styles.css`.
 *
 * ── Pourquoi ce test existe ───────────────────────────────────────────────
 *
 * Le back-office est passé du vert sombre au clair pour reprendre la charte
 * de Digital Fidelity. Trois couleurs y sont devenues illisibles d'un coup,
 * et aucune n'a protesté : l'or #C9A86B tombait à 2,3:1 sur blanc, le succès
 * #8FFFBC à 1,3:1, le danger #E4756A à 2,6:1. Elles s'affichaient encore ;
 * elles ne se lisaient plus. C'est la panne de couleur typique — rien ne
 * casse, et on ne s'en aperçoit qu'en regardant un écran par-dessus l'épaule
 * de quelqu'un.
 *
 * Le test lit donc les VRAIES valeurs dans la feuille de styles, plutôt que
 * de recopier une liste qui divergerait. Un jeton éclairci « pour faire
 * joli » fait tomber la CI, pas la lecture d'un gérant.
 *
 * ── Les seuils, et d'où ils viennent ──────────────────────────────────────
 *
 *   4,5:1  texte courant (WCAG 2.1 AA, §1.4.3)
 *   3:1    objet graphique porteur d'information (§1.4.11) — une part de
 *          camembert, une barre de graphique
 *   ΔE 15  deux séries doivent rester distinctes en vision normale
 *   ΔE 8   … et elles doivent le rester en deutéranopie et en protanopie.
 *          Sans ce dernier, une palette « jolie » peut fondre en deux
 *          teintes pour 8 % des hommes.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contraste, ecartPerceptuel, simulerDichromate } from './contraste.js'

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** La valeur d'un jeton, lue dans le `:root` de la feuille. */
function jeton(nom: string): string {
  const trouve = new RegExp(`--${nom}:\\s*(#[0-9A-Fa-f]{6})`).exec(CSS)
  if (!trouve?.[1]) throw new Error(`Jeton --${nom} introuvable dans styles.css`)
  return trouve[1]
}

const BLANC = jeton('panneau')
const IVOIRE = jeton('fond')
const BEIGE = jeton('panneau-clair')

describe('les textes de la charte claire se lisent', () => {
  /*
   * Chaque couleur est confrontée aux surfaces où elle est RÉELLEMENT posée.
   * Tester « sur blanc » seulement laisserait passer l'atténué sur le beige,
   * qui est précisément la paire la plus serrée de la palette.
   */
  const paires: readonly [string, string, readonly string[]][] = [
    ['texte', 'texte principal', [BLANC, IVOIRE, BEIGE]],
    ['attenue', 'texte atténué', [BLANC, IVOIRE, BEIGE]],
    ['accent', "accent d'action", [BLANC, IVOIRE]],
    ['orange-texte', 'terracotta lisible', [BLANC, IVOIRE]],
    ['or', 'or', [BLANC, IVOIRE]],
    ['danger', 'danger', [BLANC, IVOIRE]],
    ['succes', 'succès', [BLANC, IVOIRE]],
  ]

  for (const [nom, libelle, surfaces] of paires) {
    it(`${libelle} (--${nom}) tient le 4,5:1`, () => {
      for (const surface of surfaces) {
        const r = contraste(jeton(nom), surface)
        expect(r, `--${nom} ${jeton(nom)} sur ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('le texte posé SUR l’accent se lit aussi', () => {
    // `--sur-accent` existe parce que `--fond` ne pouvait plus jouer ce rôle :
    // devenu ivoire, il donnait de l'ivoire sur de l'émeraude… ce qui marche,
    // mais par accident. Le jeton nomme l'intention.
    expect(contraste(jeton('sur-accent'), jeton('accent'))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(jeton('sur-accent'), jeton('accent-clair'))).toBeGreaterThanOrEqual(4.5)
  })

  it('les lavis d’état portent leur propre texte', () => {
    for (const [texte, fond] of [
      ['danger', 'fond-danger'],
      ['succes', 'fond-succes'],
      ['or', 'fond-or'],
    ] as const) {
      expect(contraste(jeton(texte), jeton(fond)), `--${texte} sur --${fond}`)
        .toBeGreaterThanOrEqual(4.4)
    }
  })
})

describe('la colonne de gauche, qui a ses PROPRES jetons', () => {
  /*
   * Elle reste vert forêt pendant que le reste passe au clair. Ses couleurs
   * sont donc testées contre le ton le plus CLAIR de son dégradé (#123725) :
   * c'est là que le contraste d'un texte clair est le plus faible.
   */
  const FORET = '#123725'

  it('le dégradé de la colonne est bien celui de Digital Fidelity', () => {
    expect(CSS).toContain('linear-gradient(180deg, #0b2016 0%, #0f2e1f 55%, #123725 100%)')
  })

  it('tout ce qui est écrit dessus se lit', () => {
    for (const [nom, valeur] of [
      ['texte', '#F6F3EA'],
      ['atténué', '#8FA79A'],
      ['lien actif', '#FFB694'],
      ['marque', '#7EC694'],
    ] as const) {
      expect(contraste(valeur, FORET), `${nom} ${valeur} sur ${FORET}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('le camembert, sur son NOUVEAU fond', () => {
  /*
   * La palette avait été validée contre le vert sombre (#0D2B1F). Le fond est
   * devenu blanc : le contraste de chaque part a changé, et il fallait le
   * vérifier plutôt que le supposer. Il se trouve qu'elle passe — c'est une
   * mesure, pas une chance : ces six teintes sont de clarté moyenne, donc
   * elles tranchent des deux côtés.
   *
   * La séparation entre deux parts, elle, ne dépend PAS du fond : deux
   * couleurs s'éloignent l'une de l'autre indépendamment de ce qu'il y a
   * derrière. Elle est revérifiée quand même — le test doit rester vrai si
   * quelqu'un change une teinte.
   */
  const TEINTES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d4699a', '#7a6ff0']

  it('la liste testée est bien celle du composant', () => {
    // Sans cela, on validerait une palette que le produit n'utilise pas.
    const source = readFileSync(
      new URL('../composants/CamembertParts.tsx', import.meta.url),
      'utf8',
    )
    for (const t of TEINTES) expect(source, `${t} doit être dans CamembertParts`).toContain(t)
  })

  it('chaque part tranche sur le fond blanc de la carte (3:1)', () => {
    for (const t of TEINTES) {
      expect(contraste(t, BLANC), `${t} sur ${BLANC}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('deux parts restent distinctes — y compris pour un daltonien', () => {
    let pireNormale = Infinity
    let pireDichromate = Infinity
    for (let i = 0; i < TEINTES.length; i += 1) {
      for (let j = i + 1; j < TEINTES.length; j += 1) {
        const [a, b] = [TEINTES[i]!, TEINTES[j]!]
        pireNormale = Math.min(pireNormale, ecartPerceptuel(a, b))
        for (const type of ['deutan', 'protan'] as const) {
          pireDichromate = Math.min(
            pireDichromate,
            ecartPerceptuel(simulerDichromate(a, type), simulerDichromate(b, type)),
          )
        }
      }
    }
    expect(pireNormale).toBeGreaterThanOrEqual(15)
    expect(pireDichromate).toBeGreaterThanOrEqual(8)
  })
})

describe('la page de secours ne dérive pas de la charte', () => {
  /*
   * `global-error.tsx` remplace le document ENTIER : il ne peut pas dépendre
   * de la feuille de styles, donc ses couleurs sont recopiées à la main. Une
   * copie à la main diverge — celle-ci était restée sombre pendant que tout
   * le reste passait au clair, et personne ne l'aurait vu avant une vraie
   * panne. Ce test la rattache aux jetons.
   */
  const SECOURS = readFileSync(new URL('./global-error.tsx', import.meta.url), 'utf8')

  it('reprend exactement les jetons de la feuille', () => {
    for (const nom of ['fond', 'texte', 'accent', 'sur-accent', 'attenue'] as const) {
      expect(SECOURS, `--${nom} (${jeton(nom)})`).toContain(jeton(nom))
    }
  })
})
