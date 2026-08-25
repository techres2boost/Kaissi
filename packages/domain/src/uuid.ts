/**
 * UUIDv7 généré CÔTÉ CLIENT.
 *
 * Indispensable à l'offline : une tablette doit pouvoir ouvrir une commande
 * sans demander d'identifiant au serveur. UUIDv7 est triable par le temps,
 * ce qui évite la fragmentation d'index que provoquerait UUIDv4 sur des
 * tables de plusieurs centaines de millions de lignes.
 *
 * JAMAIS de `serial` pour une entité créable hors ligne.
 *
 * Format (RFC 9562) :
 *   48 bits  horodatage Unix en millisecondes
 *    4 bits  version = 7
 *   12 bits  sous-milliseconde (compteur monotone)
 *    2 bits  variante = 0b10
 *   62 bits  aléatoire
 */

/** Source d'aléa injectable — permet des tests déterministes. */
export interface SourceAlea {
  octets(taille: number): Uint8Array
  maintenant(): number
}

function aleaParDefaut(): Uint8Array {
  throw new Error('Aucune source cryptographique disponible')
}

const source: SourceAlea = {
  octets(taille: number): Uint8Array {
    const tampon = new Uint8Array(taille)
    const g = globalThis as { crypto?: { getRandomValues?: (t: Uint8Array) => Uint8Array } }
    if (g.crypto?.getRandomValues) {
      g.crypto.getRandomValues(tampon)
      return tampon
    }
    return aleaParDefaut()
  },
  maintenant: () => Date.now(),
}

// Garantit la monotonie même si plusieurs UUID sont générés dans la même
// milliseconde : deux commandes ouvertes coup sur coup restent ordonnées.
let derniereMs = -1
let compteurSousMs = 0

/** Génère un UUIDv7 sous forme canonique en minuscules. */
export function uuidV7(alea: SourceAlea = source): string {
  const ms = alea.maintenant()
  if (ms === derniereMs) {
    compteurSousMs = (compteurSousMs + 1) & 0x0fff
  } else {
    derniereMs = ms
    // Départ aléatoire dans la plage basse : évite les collisions entre
    // deux appareils qui démarreraient exactement à la même milliseconde.
    const graine = alea.octets(2)
    compteurSousMs = (((graine[0]! << 8) | graine[1]!) & 0x0fff) >>> 2
  }

  const octets = new Uint8Array(16)
  // 48 bits d'horodatage, gros-boutiste.
  octets[0] = (ms / 2 ** 40) & 0xff
  octets[1] = (ms / 2 ** 32) & 0xff
  octets[2] = (ms / 2 ** 24) & 0xff
  octets[3] = (ms / 2 ** 16) & 0xff
  octets[4] = (ms / 2 ** 8) & 0xff
  octets[5] = ms & 0xff
  // Version 7 + 12 bits de compteur sous-milliseconde.
  octets[6] = 0x70 | ((compteurSousMs >>> 8) & 0x0f)
  octets[7] = compteurSousMs & 0xff
  // 62 bits d'aléa + variante RFC 4122.
  const reste = alea.octets(8)
  for (let i = 0; i < 8; i += 1) octets[8 + i] = reste[i]!
  octets[8] = (octets[8]! & 0x3f) | 0x80

  return formaterUuid(octets)
}

function formaterUuid(octets: Uint8Array): string {
  const hex: string[] = []
  for (let i = 0; i < 16; i += 1) hex.push(octets[i]!.toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Vérifie qu'une chaîne est un UUID canonique. */
export function estUuid(valeur: string): boolean {
  return MOTIF_UUID.test(valeur)
}

/** Vérifie qu'une chaîne est un UUID de version 7. */
export function estUuidV7(valeur: string): boolean {
  return estUuid(valeur) && valeur[14] === '7'
}

/** Extrait l'horodatage (ms Unix) contenu dans un UUIDv7. */
export function horodatageDeUuidV7(valeur: string): number {
  if (!estUuidV7(valeur)) {
    throw new Error(`« ${valeur} » n'est pas un UUIDv7`)
  }
  const hex = valeur.replace(/-/g, '').slice(0, 12)
  return Number.parseInt(hex, 16)
}
