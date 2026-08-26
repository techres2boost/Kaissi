/**
 * Code PIN employé — validé HORS LIGNE.
 *
 * Troisième identité du système, à ne jamais confondre avec les deux autres :
 * l'appareil reste authentifié en continu, l'employé change cinq fois par
 * service. Le PIN ne parle jamais au serveur — sinon un serveur en salle ne
 * pourrait plus prendre de commande dès que la ligne tombe.
 *
 * ⚠ Ce qu'un PIN protège, et ce qu'il ne protège pas.
 *
 * Un PIN à quatre chiffres n'a que 10 000 combinaisons. Aucun paramétrage
 * d'Argon2 n'en fera un secret solide : contre quelqu'un qui a volé la
 * tablette et sait extraire `pin_hash` de SQLite, on achète des minutes,
 * pas des années. Le PIN répond à la question « QUI a fait cette action »
 * — c'est de la TRAÇABILITÉ, pas du contrôle d'accès.
 *
 * Ce qui protège réellement l'argent, ce sont trois autres choses : le jeton
 * d'appareil (long, révocable à distance), RLS côté serveur, et le journal
 * d'audit chaîné. Argon2id est là pour qu'un hachage volé ne se casse pas
 * instantanément, pas pour tenir lieu de rempart.
 *
 * Paramètres : m = 8 Mio, t = 3, p = 1. Environ 350 ms sur une machine de
 * bureau, ~1,5 s sur une tablette Android d'entrée de gamme. Monter plus
 * haut gêne surtout le caissier en plein coup de feu, pour un gain marginal
 * face à un attaquant qui n'a que 10 000 essais à faire. Un PIN à six
 * chiffres est recommandé aux gérants : c'est cent fois plus efficace que
 * n'importe quel réglage d'Argon2.
 */

import { argon2id } from '@noble/hashes/argon2'
import { randomBytes } from '@noble/hashes/utils'

/** Paramètres Argon2id. Toute modification invalide les hachages existants. */
export const PARAMS_ARGON2 = {
  /** 8 Mio — le facteur mémoire, celui qui gêne un GPU. */
  m: 8 * 1024,
  /** 3 passages. */
  t: 3,
  /** 1 voie : les WebViews n'ont pas de vrai parallélisme. */
  p: 1,
  /** Longueur du condensat, en octets. */
  dkLen: 32,
} as const

const LONGUEUR_SEL = 16
const PREFIXE = 'argon2id'

export class ErreurPin extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurPin'
  }
}

/** Un PIN doit faire 4 à 8 chiffres. Ni lettres, ni espaces. */
export function validerFormatPin(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new ErreurPin('Le code PIN doit comporter de 4 à 8 chiffres.')
  }
}

/** PIN manifestement devinables : refusés à la création, jamais silencieusement. */
const PIN_INTERDITS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '0123', '1230', '12345', '123456', '000000', '111111',
])

export function pinTropFaible(pin: string): boolean {
  return PIN_INTERDITS.has(pin)
}

function versBase64(octets: Uint8Array): string {
  let binaire = ''
  for (const o of octets) binaire += String.fromCharCode(o)
  // btoa existe dans la WebView comme dans Node ≥ 16.
  return btoa(binaire)
}

function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i)
  return octets
}

/**
 * Hache un PIN. Le format encode ses propres paramètres : changer `PARAMS_ARGON2`
 * plus tard n'empêche pas de vérifier les anciens hachages.
 *
 *   argon2id$m=16384,t=3,p=1$<sel base64>$<condensat base64>
 */
export function hacherPin(pin: string, sel?: Uint8Array): string {
  validerFormatPin(pin)
  const selUtilise = sel ?? randomBytes(LONGUEUR_SEL)
  const condensat = argon2id(pin, selUtilise, {
    m: PARAMS_ARGON2.m,
    t: PARAMS_ARGON2.t,
    p: PARAMS_ARGON2.p,
    dkLen: PARAMS_ARGON2.dkLen,
  })
  const params = `m=${PARAMS_ARGON2.m},t=${PARAMS_ARGON2.t},p=${PARAMS_ARGON2.p}`
  return `${PREFIXE}$${params}$${versBase64(selUtilise)}$${versBase64(condensat)}`
}

interface HachageDecode {
  m: number
  t: number
  p: number
  sel: Uint8Array
  condensat: Uint8Array
}

function decoder(hachage: string): HachageDecode {
  const parties = hachage.split('$')
  if (parties.length !== 4 || parties[0] !== PREFIXE) {
    throw new ErreurPin('Format de hachage de PIN non reconnu.')
  }
  const params: Record<string, number> = {}
  for (const morceau of parties[1]!.split(',')) {
    const [cle, valeur] = morceau.split('=')
    if (cle && valeur) params[cle] = Number.parseInt(valeur, 10)
  }
  if (!params['m'] || !params['t'] || !params['p']) {
    throw new ErreurPin('Paramètres Argon2id manquants dans le hachage.')
  }
  return {
    m: params['m'],
    t: params['t'],
    p: params['p'],
    sel: depuisBase64(parties[2]!),
    condensat: depuisBase64(parties[3]!),
  }
}

/**
 * Comparaison à TEMPS CONSTANT.
 * Une comparaison qui s'arrête au premier octet différent laisse fuir la
 * bonne réponse octet par octet, par mesure du temps de réponse.
 */
function egalConstant(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a[i]! ^ b[i]!
  return difference === 0
}

/** Vérifie un PIN contre un hachage synchronisé depuis le serveur. */
export function verifierPin(pin: string, hachage: string): boolean {
  if (!/^\d{4,8}$/.test(pin)) return false
  let decode: HachageDecode
  try {
    decode = decoder(hachage)
  } catch {
    return false
  }
  const candidat = argon2id(pin, decode.sel, {
    m: decode.m,
    t: decode.t,
    p: decode.p,
    dkLen: decode.condensat.length,
  })
  return egalConstant(candidat, decode.condensat)
}

/**
 * Limitation des tentatives, purement locale.
 *
 * Le verrouillage est TEMPORAIRE et jamais définitif : bloquer
 * irrémédiablement le seul caissier présent un vendredi soir serait pire
 * que le risque qu'on cherche à couvrir.
 */
export const TENTATIVES_AVANT_BLOCAGE = 5
export const DUREE_BLOCAGE_MS = 60_000

export interface EtatTentatives {
  readonly echecs: number
  readonly bloqueJusqua: number | null
}

export const TENTATIVES_VIERGES: EtatTentatives = { echecs: 0, bloqueJusqua: null }

export function estBloque(etat: EtatTentatives, maintenant = Date.now()): boolean {
  return etat.bloqueJusqua !== null && maintenant < etat.bloqueJusqua
}

export function secondesRestantes(etat: EtatTentatives, maintenant = Date.now()): number {
  if (!estBloque(etat, maintenant)) return 0
  return Math.ceil((etat.bloqueJusqua! - maintenant) / 1000)
}

export function apresEchec(etat: EtatTentatives, maintenant = Date.now()): EtatTentatives {
  const echecs = etat.echecs + 1
  return echecs >= TENTATIVES_AVANT_BLOCAGE
    ? { echecs: 0, bloqueJusqua: maintenant + DUREE_BLOCAGE_MS }
    : { echecs, bloqueJusqua: null }
}

export function apresSucces(): EtatTentatives {
  return TENTATIVES_VIERGES
}
