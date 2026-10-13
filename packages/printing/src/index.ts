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
  /*
   * ESC @ PUIS ESC t 19 — la page de caractères CP858 (PC858 chez Epson et
   * chez la plupart des compatibles : Xprinter, Rongta, HPRT).
   *
   * ⚑ Sans `ESC t`, l'imprimante reste sur sa page d'usine, presque toujours
   *   CP437 : « Escalope panée » sortait « panΘe ». Rien ne le montrait —
   *   l'aperçu et l'imprimante virtuelle relisaient les octets avec la même
   *   erreur que celle qui les avait écrits.
   */
  initialiser: new Uint8Array([ESC, 0x40, ESC, 0x74, 19]),
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

/**
 * La moitié HAUTE de CP858 (octets 0x80 à 0xFF), dans l'ordre.
 *
 * Générée par le codec `cp858` de Python, jamais recopiée à la main : une
 * seule lettre décalée imprime un mot faux sur chaque ticket. La moitié
 * basse est l'ASCII.
 *
 * ⚑ PANNE CORRIGÉE. L'encodage prenait l'octet bas du point de code
 *   (`& 0xff`), c'est-à-dire du LATIN-1 : « é » partait en 0xE9, qui est
 *   « Ú » en CP858 et « Θ » en CP437. Les minuscules accentuées françaises
 *   (é è ê à ç ù…) ont la MÊME place en CP437 et en CP858 : une imprimante
 *   qui ignorerait `ESC t` les imprimera donc juste quand même.
 */
export const CP858_HAUT = "\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4\u00f0\u00d0\u00ca\u00cb\u00c8\u20ac\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0"

const VERS_CP858 = new Map([...CP858_HAUT].map((c, i) => [c, 0x80 + i]))

/** Un caractère vers son octet CP858 — « ? » s'il n'y figure pas. */
export function encoderCp858(caractere: string): number {
  const code = caractere.codePointAt(0)!
  if (code < 0x80) return code
  return VERS_CP858.get(caractere) ?? 0x3f
}

/** L'inverse, pour l'aperçu à l'écran : ce que l'imprimante affichera. */
export function decoderCp858(octet: number): string {
  return octet < 0x80 ? String.fromCharCode(octet) : CP858_HAUT[octet - 0x80]!
}

/** Assemble une suite de fragments en une charge unique. */
export function assembler(...fragments: readonly (Uint8Array | string)[]): Uint8Array {
  const octets: number[] = []
  for (const fragment of fragments) {
    if (typeof fragment === 'string') {
      for (const c of normaliserTexte(fragment)) octets.push(encoderCp858(c))
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
export * from './diagnostic.js'
