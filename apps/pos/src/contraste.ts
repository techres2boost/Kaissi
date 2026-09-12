/**
 * Contraste et séparation de couleurs — les mesures, sans le jugement.
 *
 * Ce module ne décide rien : il CALCULE. C'est `palette.test.ts` qui applique
 * les seuils, parce que le seuil est une décision (4,5:1 pour du texte, 3:1
 * pour un objet graphique) et que la décision se lit mieux à côté de ce
 * qu'elle protège.
 *
 * ⚑ Jumeau de `apps/backoffice/src/app/contraste.ts`, et volontairement.
 *   Le POS ne dépend d'AUCUN paquet du monorepo pour son habillage, et ce
 *   n'est pas un oubli : tout ce qu'il importe part dans l'APK, et une
 *   fonction de test n'a rien à y faire. Quarante lignes de mathématiques
 *   stables valent mieux qu'un paquet partagé qu'il faudrait ensuite tenir
 *   hors du bundle.
 */

/** sRGB → composante linéaire, comme le définit WCAG 2.1. */
function lineaire(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function composantes(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = composantes(hex).map(lineaire) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Le rapport de contraste WCAG entre deux couleurs opaques. */
export function contraste(a: string, b: string): number {
  const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (haut + 0.05) / (bas + 0.05)
}

/** sRGB → CIE L*a*b* (illuminant D65). */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = composantes(hex).map(lineaire) as [number, number, number]
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/**
 * L'écart perceptuel ΔE entre deux couleurs.
 *
 * ΔE76 — la distance euclidienne dans Lab — et non CIEDE2000. Le second est
 * plus fidèle, et beaucoup plus long à écrire ; ce qu'on lui demande ici est
 * de répondre « ces deux parts de camembert sont-elles distinguables ? »,
 * une question où l'écart est franc ou ne l'est pas. Un seuil pris avec de la
 * marge vaut mieux qu'une formule exacte appliquée au ras.
 */
export function ecartPerceptuel(a: string, b: string): number {
  const [la, aa, ba] = lab(a)
  const [lb, ab, bb] = lab(b)
  return Math.hypot(la - lb, aa - ab, ba - bb)
}

/**
 * La couleur telle que la voit un dichromate — Viénot, Brettel & Mollon 1999.
 *
 * On passe en espace LMS (les trois types de cônes), on écrase le cône
 * manquant en le reconstruisant depuis les deux autres, puis on revient en
 * sRGB. C'est la simulation que retiennent les outils d'accessibilité usuels.
 */
export function simulerDichromate(hex: string, type: 'deutan' | 'protan'): string {
  const [r, g, b] = composantes(hex).map(lineaire) as [number, number, number]
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b
  const M = 3.45565 * r + 27.1554 * g + 3.86714 * b
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b
  // Le cône absent est REMPLACÉ par une combinaison des deux autres : c'est
  // ce qui fait converger deux teintes que l'œil ne sépare plus.
  const l = type === 'protan' ? 2.02344 * M - 2.52581 * S : L
  const m = type === 'deutan' ? 0.494207 * L + 1.24827 * S : M
  const s = S
  const rl = 0.080944 * l - 0.130504 * m + 0.116721 * s
  const gl = -0.0102485 * l + 0.0540194 * m - 0.113615 * s
  const bl = -0.000365294 * l - 0.00412163 * m + 0.693513 * s
  const vers8 = (v: number) => {
    const borne = Math.max(0, Math.min(1, v))
    const gamma = borne <= 0.0031308 ? 12.92 * borne : 1.055 * borne ** (1 / 2.4) - 0.055
    return Math.round(gamma * 255)
  }
  return `#${[rl, gl, bl].map((v) => vers8(v).toString(16).padStart(2, '0')).join('')}`
}
