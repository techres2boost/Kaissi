/**
 * Jetons d'appareil.
 *
 * Deuxième des trois identités du système : ni un utilisateur, ni un employé.
 * Un jeton d'appareil est long, opaque, révocable à distance, et lié à un
 * seul établissement.
 *
 * Le jeton EN CLAIR n'existe qu'une fois, au moment de l'appairage : la base
 * ne garde que son empreinte. Un vol de la table `devices` ne donne donc
 * accès à rien — contrairement à un jeton stocké tel quel.
 *
 * SHA-256 et non Argon2 ici : un jeton de 256 bits n'est pas devinable par
 * force brute, le coût mémoire d'Argon2 ne protégerait de rien et
 * ralentirait chaque requête de synchronisation.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const PREFIXE = 'kdev'
const OCTETS = 32

export interface JetonAppareil {
  /** À transmettre UNE fois à l'appareil. Jamais stocké en clair. */
  readonly clair: string
  /** À stocker dans `devices.token_hash`. */
  readonly empreinte: string
}

export function genererJeton(): JetonAppareil {
  const clair = `${PREFIXE}_${randomBytes(OCTETS).toString('base64url')}`
  return { clair, empreinte: empreinteDe(clair) }
}

export function empreinteDe(jetonClair: string): string {
  return createHash('sha256').update(jetonClair, 'utf8').digest('hex')
}

/** Comparaison à temps constant — évite de laisser fuir l'empreinte. */
export function empreintesEgales(a: string, b: string): boolean {
  const ta = Buffer.from(a, 'utf8')
  const tb = Buffer.from(b, 'utf8')
  if (ta.length !== tb.length) return false
  return timingSafeEqual(ta, tb)
}

/** Extrait le jeton d'un en-tête `Authorization: Bearer …`. */
export function jetonDepuisEntete(entete: string | null | undefined): string | null {
  if (!entete) return null
  const correspondance = /^Bearer\s+(.+)$/i.exec(entete.trim())
  return correspondance?.[1]?.trim() || null
}
