/**
 * Les accents doivent sortir JUSTES sur le papier — pas seulement à l'écran.
 *
 * PANNE CORRIGÉE. L'encodage écrivait du Latin-1 (`& 0xff`) sans choisir de
 * page sur l'imprimante : « Escalope panée » sortait « panΘe » sur une
 * thermique réglée d'usine en CP437. L'aperçu à l'écran et l'imprimante
 * virtuelle relisaient en Latin-1 eux aussi — l'erreur s'annulait à l'écran,
 * et n'aurait été vue que le jour de la première vraie imprimante.
 *
 * Les octets attendus ci-dessous viennent des tables publiées de CP858 et
 * CP437, pas de notre code.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { apercuTexte, assembler, COMMANDES, CP858_HAUT, encoderCp858 } from './index.js'

describe('le jeu de caractères', () => {
  it('chaque charge commence par ESC @ puis ESC t 19 (CP858)', () => {
    expect([...COMMANDES.initialiser]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19])
  })

  it('écrit les accents français à leur place CP858', () => {
    const octets = [...assembler('é è ê à ç ù ô É À €')]
      .filter((o) => o !== 0x20)
    expect(octets).toEqual([0x82, 0x8a, 0x88, 0x85, 0x87, 0x97, 0x93, 0x90, 0xb7, 0xd5])
  })

  it('les minuscules accentuées ont la MÊME place qu’en CP437 — l’imprimante qui ignore ESC t les imprime juste', () => {
    // CP437 : é=0x82 è=0x8A ê=0x88 à=0x85 ç=0x87 ù=0x97 ô=0x93 É=0x90
    for (const [c, cp437] of [
      ['é', 0x82], ['è', 0x8a], ['ê', 0x88], ['à', 0x85], ['ç', 0x87], ['ù', 0x97], ['ô', 0x93], ['É', 0x90],
    ] as const) {
      expect(encoderCp858(c), c).toBe(cp437)
    }
  })

  it('un caractère absent de CP858 devient « ? », jamais un octet arbitraire', () => {
    expect(encoderCp858('ش')).toBe(0x3f)
  })

  it('l’aperçu relit ce que le papier imprimera', () => {
    const charge = assembler(COMMANDES.initialiser, 'Escalope panée — 16,000 €\n')
    expect(apercuTexte(charge)).toContain('Escalope panée - 16,000 €')
  })

  it('l’imprimante virtuelle utilise la MÊME table', () => {
    const script = readFileSync(
      new URL('../../../apps/pos/scripts/imprimante-virtuelle.mjs', import.meta.url),
      'utf8',
    )
    const copie = /const CP858_HAUT = ("(?:[^"\\]|\\.)*")/.exec(script)?.[1]
    expect(copie, 'table CP858 introuvable dans le script').toBeDefined()
    expect(JSON.parse(copie!)).toBe(CP858_HAUT)
  })
})
