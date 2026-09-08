/**
 * Journalisation structurée — pour qu'une panne se cherche, pas se devine.
 *
 * ── Ce qu'il y avait avant ────────────────────────────────────────────────
 *
 * Des `console.log` et `console.warn` en texte libre. Sur le tableau de bord
 * d'un hébergeur, ils sont indistinguables du reste : impossible de filtrer
 * « montre-moi les erreurs », impossible de suivre UNE requête à travers
 * plusieurs lignes, impossible de compter. On lit donc tout, à l'œil, en
 * remontant — c'est-à-dire qu'on ne lit pas.
 *
 * ── Pourquoi du JSON par ligne, et pas une bibliothèque ───────────────────
 *
 * Le format « une ligne = un objet JSON » (JSONL) est ce que savent lire
 * Railway, Vercel, Datadog, Loki et `jq`. Il ne demande aucune dépendance :
 * quarante lignes ici remplacent un paquet de plus à suivre, à mettre à jour
 * et à auditer. Pino ferait mieux le jour où il faudra des transports, des
 * échantillonnages et de la redaction ; ce jour n'est pas arrivé.
 *
 * ── La règle qui compte : ce qui NE DOIT PAS entrer ───────────────────────
 *
 * Un journal finit chez un hébergeur, dans un agrégateur, parfois dans un
 * ticket de support. Il ne doit donc jamais contenir de jeton d'appareil, de
 * mot de passe, de hachage de PIN ni de clé de service. `nettoyer()` les
 * retire par NOM de champ — une liste explicite, parce qu'une expression
 * régulière sur la valeur laisserait toujours passer le format qu'on n'a pas
 * prévu.
 */

export type Niveau = 'debug' | 'info' | 'avertissement' | 'erreur'

/** Ce qu'on accepte de journaliser : des données, jamais des objets vivants. */
export type Contexte = Record<string, unknown>

/**
 * Les champs dont la VALEUR ne sort jamais, quel que soit le contexte.
 *
 * Comparés en minuscules et par inclusion : `jeton`, `deviceToken` et
 * `authorization` tombent tous les trois. Mieux vaut masquer un champ anodin
 * de trop que laisser fuir un jeton une seule fois.
 */
const CHAMPS_SENSIBLES = [
  'jeton',
  'token',
  'authorization',
  'motdepasse',
  'password',
  'pin',
  'hash',
  'secret',
  'cle',
  'key',
  'apikey',
]

const MASQUE = '«masqué»'

/**
 * Remplace la valeur des champs sensibles, en profondeur.
 *
 * La profondeur est BORNÉE : un objet cyclique — une erreur `pg` qui porte
 * sa connexion, par exemple — ferait sinon tourner la journalisation en
 * boucle infinie. Une panne dont la trace fait tomber le service est pire
 * que la panne.
 */
export function nettoyer(valeur: unknown, profondeur = 0): unknown {
  if (profondeur > 4) return '«trop profond»'
  if (valeur === null || typeof valeur !== 'object') return valeur
  if (valeur instanceof Error) {
    return { nom: valeur.name, message: valeur.message, pile: valeur.stack }
  }
  if (Array.isArray(valeur)) {
    // Un tableau très long noierait la ligne : on garde de quoi comprendre.
    const debut = valeur.slice(0, 20).map((v) => nettoyer(v, profondeur + 1))
    return valeur.length > 20 ? [...debut, `…et ${valeur.length - 20} de plus`] : debut
  }
  const sortie: Record<string, unknown> = {}
  for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
    const nom = cle.toLowerCase()
    sortie[cle] = CHAMPS_SENSIBLES.some((s) => nom.includes(s))
      ? MASQUE
      : nettoyer(v, profondeur + 1)
  }
  return sortie
}

/** Le niveau minimum retenu, réglable sans redéploiement de code. */
function niveauMinimum(): Niveau {
  const brut = (process.env['SYNC_JOURNAL_NIVEAU'] ?? '').trim().toLowerCase()
  return brut === 'debug' || brut === 'info' || brut === 'avertissement' || brut === 'erreur'
    ? brut
    : 'info'
}

const ORDRE: Record<Niveau, number> = {
  debug: 10,
  info: 20,
  avertissement: 30,
  erreur: 40,
}

/**
 * Écrit une ligne.
 *
 * Sur `stdout` pour tout, y compris les erreurs — et non `stderr`. Les
 * hébergeurs mélangent les deux flux dans un même journal, et les séparer
 * fait perdre l'ORDRE relatif des lignes : une erreur apparaît alors avant
 * la requête qui l'a causée, ce qui rend le diagnostic impossible. Le niveau
 * est dans le champ `niveau`, où un filtre le trouve.
 */
function ecrire(niveau: Niveau, message: string, contexte?: Contexte): void {
  if (ORDRE[niveau] < ORDRE[niveauMinimum()]) return
  const ligne = {
    horodatage: new Date().toISOString(),
    niveau,
    service: 'sync',
    message,
    ...(contexte ? { ...(nettoyer(contexte) as Contexte) } : {}),
  }
  // `process.stdout.write` et non `console.log` : pas de formatage
  // supplémentaire, pas d'inspection d'objet, une ligne exactement.
  process.stdout.write(`${JSON.stringify(ligne)}\n`)
}

export const journal = {
  debug: (message: string, contexte?: Contexte) => ecrire('debug', message, contexte),
  info: (message: string, contexte?: Contexte) => ecrire('info', message, contexte),
  avertissement: (message: string, contexte?: Contexte) =>
    ecrire('avertissement', message, contexte),
  erreur: (message: string, contexte?: Contexte) => ecrire('erreur', message, contexte),
}
