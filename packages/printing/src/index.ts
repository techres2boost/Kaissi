/**
 * @kaissi/printing — rendu ESC/POS.
 *
 * Phase 0 : uniquement les primitives d'encodage, testables sans imprimante.
 * Le transport (socket TCP 9100) est un plugin natif Android de la Phase 1 ;
 * la file d'impression persistante vit déjà dans `print_queue` côté SQLite.
 *
 * Choix d'architecture : on normalise sur les imprimantes RÉSEAU (TCP 9100).
 * Elles sont sur le LAN, donc l'impression cuisine fonctionne sans Internet —
 * c'est le point qui sauve le service quand la ligne tombe.
 */

const ESC = 0x1b
const GS = 0x1d

/** Commandes ESC/POS utilisées par Kaissi. */
export const COMMANDES = {
  initialiser: new Uint8Array([ESC, 0x40]),
  gras: (actif: boolean) => new Uint8Array([ESC, 0x45, actif ? 1 : 0]),
  aligner: (mode: 'gauche' | 'centre' | 'droite') =>
    new Uint8Array([ESC, 0x61, mode === 'gauche' ? 0 : mode === 'centre' ? 1 : 2]),
  doubleHauteur: (actif: boolean) => new Uint8Array([GS, 0x21, actif ? 0x01 : 0x00]),
  couper: new Uint8Array([GS, 0x56, 0x42, 0x00]),
  /** Impulsion d'ouverture du tiroir-caisse — piloté PAR l'imprimante. */
  ouvrirTiroir: new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xfa]),
  sauterLignes: (n: number) => new Uint8Array([ESC, 0x64, Math.max(0, Math.min(n, 255))]),
} as const

/**
 * Encode du texte en CP858 (jeu latin avec le symbole €), le codage le plus
 * répandu sur les imprimantes thermiques bon marché. Les caractères
 * accentués français y sont présents ; ceux qui manquent sont translittérés
 * plutôt que remplacés par un carré illisible sur un ticket cuisine.
 */
const TRANSLITTERATION: Record<string, string> = {
  œ: 'oe', Œ: 'OE', æ: 'ae', Æ: 'AE', '’': "'", '‘': "'",
  '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ',
}

export function normaliserTexte(texte: string): string {
  return [...texte].map((c) => TRANSLITTERATION[c] ?? c).join('')
}

/** Assemble une suite de fragments en une charge unique. */
export function assembler(...fragments: readonly (Uint8Array | string)[]): Uint8Array {
  const octets: number[] = []
  for (const fragment of fragments) {
    if (typeof fragment === 'string') {
      for (const c of normaliserTexte(fragment)) octets.push(c.codePointAt(0)! & 0xff)
    } else {
      octets.push(...fragment)
    }
  }
  return new Uint8Array(octets)
}

/**
 * Met en forme une ligne « libellé …… montant » sur une largeur donnée.
 * 42 colonnes est la largeur standard d'une imprimante 80 mm ;
 * 32 colonnes celle d'une 58 mm.
 */
export function ligneAlignee(gauche: string, droite: string, colonnes = 42): string {
  const g = normaliserTexte(gauche)
  const d = normaliserTexte(droite)
  const espace = Math.max(1, colonnes - g.length - d.length)
  if (g.length + d.length + 1 > colonnes) {
    const tronque = g.slice(0, Math.max(0, colonnes - d.length - 1))
    return `${tronque} ${d}`
  }
  return `${g}${' '.repeat(espace)}${d}`
}

export function separateur(colonnes = 42, caractere = '-'): string {
  return caractere.repeat(colonnes)
}

export * from './rendu.js'
