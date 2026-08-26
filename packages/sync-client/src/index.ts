/**
 * @kaissi/sync-client — outbox, curseurs, retentatives. PHASE 2.
 *
 * Ce paquet ne contient encore que sa politique de retentative, parce que
 * c'est la partie qu'il faut figer AVANT d'écrire le moteur : une
 * retentative trop agressive vide la batterie d'une tablette et sature un
 * réseau ADSL de snack ; une retentative trop lâche fait attendre les
 * ventes des heures après le retour du réseau.
 */

/** Curseurs de l'appareil. Des ENTIERS serveur, jamais des horodatages. */
export interface Curseurs {
  readonly catalogue: number
  readonly evenements: number
}

export interface PolitiqueRetentative {
  readonly delaiInitialMs: number
  readonly delaiMaxMs: number
  readonly facteur: number
  /** Bruit aléatoire : évite que 40 tablettes se reconnectent en même temps. */
  readonly gigueMax: number
}

export const RETENTATIVE_PAR_DEFAUT: PolitiqueRetentative = {
  delaiInitialMs: 2_000,
  delaiMaxMs: 5 * 60_000,
  facteur: 2,
  gigueMax: 0.3,
}

/**
 * Délai avant la n-ième tentative (n commence à 0).
 * Croissance exponentielle plafonnée, avec gigue proportionnelle.
 */
export function delaiRetentative(
  tentative: number,
  politique: PolitiqueRetentative = RETENTATIVE_PAR_DEFAUT,
  alea: () => number = Math.random,
): number {
  const brut = politique.delaiInitialMs * politique.facteur ** Math.max(tentative, 0)
  const plafonne = Math.min(brut, politique.delaiMaxMs)
  const gigue = plafonne * politique.gigueMax * (alea() * 2 - 1)
  return Math.max(0, Math.round(plafonne + gigue))
}

/**
 * Un rejet du serveur n'est JAMAIS réessayé automatiquement : il traduit une
 * règle métier (commande déjà close, produit supprimé, permission révoquée).
 * Le réessayer en boucle masquerait le problème au gérant.
 */
export function estReessayable(codeRejet: string | null): boolean {
  return codeRejet === null
}

export * from './transport.js'
export * from './moteur.js'
