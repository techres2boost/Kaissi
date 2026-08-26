/**
 * Séquence de démarrage du terminal.
 *
 * C'est LE chemin critique de la Phase 0 : il doit se dérouler entièrement
 * sans réseau. Chaque étape est mesurée et rapportée dans l'écran
 * « Diagnostic » — un support à distance sans diagnostic sur l'appareil
 * n'est pas un support.
 *
 *   1. ouvrir SQLite            (natif sur Android, mémoire en dev)
 *   2. appliquer les migrations (versionnées, transactionnelles)
 *   3. installer la graine      (si la base est vide)
 *   4. lire le catalogue        EN LOCAL, aucun appel réseau
 */

import {
  depotCaisse,
  depotCatalogue,
  depotEmployes,
  depotEtat,
  depotImpression,
  depotJournal,
  installerGraine,
  journalMigrations,
  migrer,
  VERSION_SCHEMA_LOCAL,
  type MigrationAppliquee,
} from '@kaissi/db-local'
import { ouvrirBaseLocale, type BaseLocale } from './sqlite.js'

export interface EtapeDemarrage {
  readonly nom: string
  readonly statut: 'ok' | 'echec'
  readonly dureeMs: number
  readonly detail: string
}

export interface ContexteApplication {
  readonly base: BaseLocale
  readonly catalogue: ReturnType<typeof depotCatalogue>
  readonly journal: ReturnType<typeof depotJournal>
  readonly etat: ReturnType<typeof depotEtat>
  readonly caisse: ReturnType<typeof depotCaisse>
  readonly employes: ReturnType<typeof depotEmployes>
  readonly fileImpression: ReturnType<typeof depotImpression>
  readonly etapes: readonly EtapeDemarrage[]
  readonly versionSchema: number
  readonly migrations: readonly MigrationAppliquee[]
  readonly grainePosee: boolean
  readonly dureeTotaleMs: number
}

export async function demarrer(): Promise<ContexteApplication> {
  const etapes: EtapeDemarrage[] = []
  const debutTotal = performance.now()

  const mesurer = async <T>(nom: string, travail: () => Promise<T>): Promise<T> => {
    const debut = performance.now()
    try {
      const resultat = await travail()
      etapes.push({
        nom,
        statut: 'ok',
        dureeMs: Math.round(performance.now() - debut),
        detail: typeof resultat === 'string' ? resultat : 'OK',
      })
      return resultat
    } catch (erreur) {
      etapes.push({
        nom,
        statut: 'echec',
        dureeMs: Math.round(performance.now() - debut),
        detail: erreur instanceof Error ? erreur.message : String(erreur),
      })
      throw erreur
    }
  }

  const base = await mesurer('Ouverture de la base locale', async () => {
    const b = await ouvrirBaseLocale()
    return b
  })
  etapes[etapes.length - 1] = { ...etapes[etapes.length - 1]!, detail: base.detail }

  const resultatMigration = await mesurer('Migrations locales', () => migrer(base.adaptateur))
  etapes[etapes.length - 1] = {
    ...etapes[etapes.length - 1]!,
    detail:
      resultatMigration.appliquees.length === 0
        ? `Déjà en version ${resultatMigration.versionApres}`
        : `${resultatMigration.appliquees.length} migration(s) appliquée(s) → version ${resultatMigration.versionApres}`,
  }

  const grainePosee = await mesurer('Graine du catalogue', () =>
    installerGraine(base.adaptateur),
  )
  etapes[etapes.length - 1] = {
    ...etapes[etapes.length - 1]!,
    detail: grainePosee ? 'Catalogue de démonstration installé' : 'Catalogue déjà présent',
  }

  const catalogue = depotCatalogue(base.adaptateur)
  const nombreProduits = await mesurer('Lecture du menu (local)', () =>
    catalogue.nombreProduits(),
  )
  etapes[etapes.length - 1] = {
    ...etapes[etapes.length - 1]!,
    detail: `${nombreProduits} produit(s) lus depuis SQLite — aucun accès réseau`,
  }

  return {
    base,
    catalogue,
    journal: depotJournal(base.adaptateur),
    etat: depotEtat(base.adaptateur),
    caisse: depotCaisse(base.adaptateur),
    employes: depotEmployes(base.adaptateur),
    fileImpression: depotImpression(base.adaptateur),
    etapes,
    versionSchema: VERSION_SCHEMA_LOCAL,
    migrations: await journalMigrations(base.adaptateur),
    grainePosee,
    dureeTotaleMs: Math.round(performance.now() - debutTotal),
  }
}
