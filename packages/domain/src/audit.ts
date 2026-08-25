/**
 * Chaînage par hash du journal d'audit.
 *
 * Chaque ligne d'`audit_events` porte le hash de la précédente. Supprimer ou
 * modifier une ligne en base casse la chaîne et devient détectable — y compris
 * par quelqu'un qui aurait un accès direct au SQL.
 *
 * La sérialisation canonique ci-dessous doit produire EXACTEMENT la même
 * chaîne côté TypeScript et côté PL/pgSQL, sinon la vérification échoue à tort.
 * Voir `supabase/migrations/0010_audit.sql` pour l'implémentation miroir.
 */

/** Charge d'un événement d'audit, avant hachage. */
export interface EntreeAudit {
  readonly id: string
  readonly organizationId: string
  readonly restaurantId: string | null
  readonly acteurUserId: string | null
  readonly deviceId: string | null
  readonly action: string
  readonly entityType: string
  readonly entityId: string | null
  /**
   * Horodatage sous sa forme CANONIQUE, telle que produite par la base :
   * `audit_events.created_at_canon`, soit `YYYY-MM-DDTHH:MM:SS.uuuuuuZ` en UTC.
   * Ne jamais passer ici un `Date.toISOString()` : la précision diffère
   * (millisecondes contre microsecondes) et le hash ne correspondrait plus.
   */
  readonly createdAt: string
}

/**
 * Sérialisation canonique : champs dans un ordre FIXE, séparés par « | »,
 * valeurs nulles rendues par une chaîne vide. Aucun JSON (l'ordre des clés
 * n'y est pas garanti d'une implémentation à l'autre).
 */
export function serialiserAudit(entree: EntreeAudit, prevHash: string): string {
  return [
    prevHash,
    entree.id,
    entree.organizationId,
    entree.restaurantId ?? '',
    entree.acteurUserId ?? '',
    entree.deviceId ?? '',
    entree.action,
    entree.entityType,
    entree.entityId ?? '',
    entree.createdAt,
  ].join('|')
}

/** Hash de genèse : première ligne de la chaîne d'un établissement. */
export const HASH_GENESE = '0'.repeat(64)

/**
 * Calcule le hash SHA-256 d'une entrée d'audit.
 * Asynchrone car WebCrypto l'est ; disponible dans la WebView Android
 * comme dans Node ≥ 20.
 */
export async function calculerHashAudit(
  entree: EntreeAudit,
  prevHash: string,
): Promise<string> {
  const donnees = new TextEncoder().encode(serialiserAudit(entree, prevHash))
  // Typage minimal de WebCrypto : `packages/domain` ne dépend d'aucun `lib.dom`
  // ni de `@types/node`, il doit compiler pour la WebView comme pour Node.
  const crypto = (
    globalThis as unknown as {
      crypto?: { subtle?: { digest(algo: string, data: Uint8Array): Promise<ArrayBuffer> } }
    }
  ).crypto
  if (!crypto?.subtle) {
    throw new Error("WebCrypto indisponible : impossible de chaîner le journal d'audit.")
  }
  const empreinte = await crypto.subtle.digest('SHA-256', donnees)
  return [...new Uint8Array(empreinte)]
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('')
}

/** Une ligne d'audit telle que relue depuis la base, pour vérification. */
export interface LigneAudit extends EntreeAudit {
  readonly prevHash: string
  readonly hash: string
}

export interface ResultatVerification {
  readonly valide: boolean
  /** Index de la première ligne rompue, ou -1. */
  readonly indexRupture: number
  readonly message: string
}

/**
 * Vérifie l'intégrité d'une chaîne d'audit complète, dans l'ordre croissant
 * de `created_at`. C'est la fonction que le back-office appelle pour afficher
 * « journal intègre » au gérant — et l'argument commercial le plus convaincant
 * en démonstration.
 */
export async function verifierChaine(
  lignes: readonly LigneAudit[],
): Promise<ResultatVerification> {
  let attendu = HASH_GENESE
  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i]!
    if (ligne.prevHash !== attendu) {
      return {
        valide: false,
        indexRupture: i,
        message: `Chaîne rompue à la ligne ${i} (${ligne.id}) : hash précédent attendu ${attendu}, trouvé ${ligne.prevHash}.`,
      }
    }
    const recalcule = await calculerHashAudit(ligne, ligne.prevHash)
    if (recalcule !== ligne.hash) {
      return {
        valide: false,
        indexRupture: i,
        message: `Ligne ${i} (${ligne.id}) altérée : hash recalculé ${recalcule} ≠ hash stocké ${ligne.hash}.`,
      }
    }
    attendu = ligne.hash
  }
  return { valide: true, indexRupture: -1, message: `Journal intègre (${lignes.length} lignes).` }
}

/** Actions sensibles qui exigent une autorisation renforcée (PIN manager). */
export const ACTIONS_SENSIBLES = [
  'remise.au_dela_du_seuil',
  'vente.annulation_apres_encaissement',
  'prix.modification_manuelle',
  'tiroir.ouverture_hors_vente',
  'paiement.remboursement',
  'shift.cloture_avec_ecart',
] as const

export type ActionSensible = (typeof ACTIONS_SENSIBLES)[number]
