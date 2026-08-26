/**
 * Dépôt employés — la validation du PIN se fait ICI, hors ligne.
 */

import {
  verifierPin,
  type Employe,
  type Permission,
  type Role,
  type Surcharges,
} from '@kaissi/domain'
import type { AdaptateurSqlite } from '../adaptateur.js'

export interface EmployeLocal extends Employe {
  readonly code: string | null
  readonly aUnPin: boolean
}

export function depotEmployes(db: AdaptateurSqlite) {
  return {
    async actifs(): Promise<EmployeLocal[]> {
      const lignes = await db.lire<{
        id: string
        full_name: string
        role: string
        code: string | null
        pin_hash: string | null
        permissions: string
      }>(
        `SELECT id, full_name, role, code, pin_hash, permissions
         FROM employees WHERE archived_at IS NULL AND is_active = 1
         ORDER BY full_name`,
      )
      return lignes.map((l) => ({
        id: l.id,
        nom: l.full_name,
        role: l.role as Role,
        surcharges: analyserSurcharges(l.permissions),
        code: l.code,
        aUnPin: l.pin_hash !== null && l.pin_hash !== '',
      }))
    },

    async parId(id: string): Promise<EmployeLocal | null> {
      const lignes = await this.actifs()
      return lignes.find((e) => e.id === id) ?? null
    },

    /**
     * Vérifie le PIN d'un employé donné.
     * Retourne `null` en cas d'échec — jamais un message qui distinguerait
     * « employé inconnu » de « mauvais PIN » : ce serait dire à un curieux
     * quels identifiants existent.
     */
    async verifier(employeId: string, pin: string): Promise<EmployeLocal | null> {
      const ligne = await db.lireUne<{ pin_hash: string | null }>(
        `SELECT pin_hash FROM employees
         WHERE id = ? AND archived_at IS NULL AND is_active = 1`,
        [employeId],
      )
      if (!ligne?.pin_hash) return null
      if (!verifierPin(pin, ligne.pin_hash)) return null
      return this.parId(employeId)
    },

    /**
     * Cherche un employé par PIN seul, sans sélection préalable.
     * Pratique en coup de feu — mais tous les hachages sont testés, donc le
     * coût monte avec l'effectif. Au-delà d'une dizaine d'employés, préférer
     * la sélection explicite puis `verifier()`.
     */
    async parPin(pin: string): Promise<EmployeLocal | null> {
      const lignes = await db.lire<{ id: string; pin_hash: string | null }>(
        `SELECT id, pin_hash FROM employees
         WHERE archived_at IS NULL AND is_active = 1 AND pin_hash IS NOT NULL`,
      )
      for (const l of lignes) {
        if (l.pin_hash && verifierPin(pin, l.pin_hash)) return this.parId(l.id)
      }
      return null
    },

    /** Managers habilités à autoriser une opération escaladée. */
    async managers(): Promise<EmployeLocal[]> {
      const tous = await this.actifs()
      return tous.filter((e) => e.role === 'gerant' || e.role === 'admin')
    },
  }
}

/**
 * Analyse les surcharges de permissions stockées en JSON sur l'employé.
 * Un JSON illisible ne fait JAMAIS planter la caisse : on retombe sur les
 * permissions du rôle, qui sont toujours les plus restrictives.
 */
function analyserSurcharges(json: string): Surcharges | undefined {
  let brut: unknown
  try {
    brut = JSON.parse(json)
  } catch {
    return undefined
  }
  if (brut === null || typeof brut !== 'object') return undefined
  const objet = brut as Record<string, unknown>

  const listeDePermissions = (valeur: unknown): Permission[] | undefined =>
    Array.isArray(valeur)
      ? (valeur.filter((v): v is Permission => typeof v === 'string') as Permission[])
      : undefined

  const surcharges: Surcharges = {
    accordees: listeDePermissions(objet['accordees']),
    retirees: listeDePermissions(objet['retirees']),
    remiseMaxBp:
      typeof objet['remiseMaxBp'] === 'number' && Number.isSafeInteger(objet['remiseMaxBp'])
        ? objet['remiseMaxBp']
        : undefined,
  }

  const vide =
    surcharges.accordees === undefined &&
    surcharges.retirees === undefined &&
    surcharges.remiseMaxBp === undefined
  return vide ? undefined : surcharges
}

export type DepotEmployes = ReturnType<typeof depotEmployes>
