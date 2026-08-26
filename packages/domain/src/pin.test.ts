import { describe, expect, it } from 'vitest'
import {
  apresEchec,
  apresSucces,
  ErreurPin,
  estBloque,
  hacherPin,
  pinTropFaible,
  secondesRestantes,
  TENTATIVES_AVANT_BLOCAGE,
  TENTATIVES_VIERGES,
  validerFormatPin,
  verifierPin,
} from './pin.js'

describe('format du PIN', () => {
  it('accepte 4 à 8 chiffres', () => {
    for (const pin of ['1357', '13579', '13579246']) {
      expect(() => validerFormatPin(pin)).not.toThrow()
    }
  })

  it('refuse ce qui n est pas un PIN', () => {
    for (const pin of ['123', '123456789', 'abcd', '12 34', '', '12a4']) {
      expect(() => validerFormatPin(pin)).toThrow(ErreurPin)
    }
  })

  it('signale les PIN manifestement devinables', () => {
    expect(pinTropFaible('0000')).toBe(true)
    expect(pinTropFaible('1234')).toBe(true)
    expect(pinTropFaible('1357')).toBe(false)
  })
})

describe('hachage et vérification hors ligne', () => {
  it('vérifie le bon PIN et rejette les autres', () => {
    const h = hacherPin('1357')
    expect(verifierPin('1357', h)).toBe(true)
    expect(verifierPin('1358', h)).toBe(false)
    expect(verifierPin('7531', h)).toBe(false)
  })

  it('produit un hachage DIFFÉRENT à chaque fois — le sel est aléatoire', () => {
    const a = hacherPin('1357')
    const b = hacherPin('1357')
    expect(a).not.toBe(b)
    // Mais les deux vérifient le même PIN.
    expect(verifierPin('1357', a)).toBe(true)
    expect(verifierPin('1357', b)).toBe(true)
  })

  it('encode ses paramètres, pour rester vérifiable après un changement', () => {
    expect(hacherPin('1357')).toMatch(/^argon2id\$m=\d+,t=\d+,p=\d+\$[^$]+\$[^$]+$/)
  })

  it('rejette proprement un hachage corrompu, sans planter', () => {
    expect(verifierPin('1357', 'nimporte-quoi')).toBe(false)
    expect(verifierPin('1357', 'argon2id$m=8192$sel')).toBe(false)
    expect(verifierPin('1357', '')).toBe(false)
  })

  it('rejette un PIN au mauvais format sans même calculer le hachage', () => {
    expect(verifierPin('abc', hacherPin('1357'))).toBe(false)
  })

  it('ne stocke JAMAIS le PIN en clair', () => {
    expect(hacherPin('1357')).not.toContain('1357')
  })
})

describe('limitation des tentatives', () => {
  it('bloque après N échecs consécutifs', () => {
    let etat = TENTATIVES_VIERGES
    for (let i = 1; i < TENTATIVES_AVANT_BLOCAGE; i += 1) {
      etat = apresEchec(etat, 1000)
      expect(estBloque(etat, 1000)).toBe(false)
    }
    etat = apresEchec(etat, 1000)
    expect(estBloque(etat, 1000)).toBe(true)
  })

  it('le blocage est TEMPORAIRE — jamais définitif', () => {
    let etat = TENTATIVES_VIERGES
    for (let i = 0; i < TENTATIVES_AVANT_BLOCAGE; i += 1) etat = apresEchec(etat, 1000)
    expect(estBloque(etat, 1000)).toBe(true)
    expect(secondesRestantes(etat, 1000)).toBe(60)
    // Une minute plus tard, le caissier peut retravailler.
    expect(estBloque(etat, 1000 + 60_001)).toBe(false)
  })

  it('remet le compteur à zéro après un succès', () => {
    let etat = apresEchec(TENTATIVES_VIERGES, 1000)
    etat = apresEchec(etat, 1000)
    expect(etat.echecs).toBe(2)
    expect(apresSucces().echecs).toBe(0)
  })
})
