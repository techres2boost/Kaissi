/**
 * Contexte applicatif — ce que tous les écrans partagent.
 *
 * Volontairement un simple contexte React plutôt qu'une bibliothèque d'état :
 * la vérité vit dans SQLite, pas en mémoire. Ce contexte ne fait que porter
 * les dépôts, la session de caisse et l'employé en poste.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ConfigCalcul, Employe, EnteteEtablissement } from '@kaissi/domain'
import type { EmployeLocal, MethodePaiementLocale, TableLocale } from '@kaissi/db-local'
import type { ContexteApplication } from '../donnees/demarrage.js'
import { MoteurSync, transportHttp, type ResumeSync } from '@kaissi/sync-client'
import { uuidV7 } from '@kaissi/domain'
import { SessionCaisse, type IdentiteTerminal } from '../donnees/session.js'
import { ServiceImpression, type EtatImpression } from '../donnees/impression.js'
import { depotLocalSync } from '../donnees/synchronisation.js'

export interface StationImprimante {
  id: string
  nom: string
  hote: string | null
  port: number
}

export interface ValeurContexte {
  readonly app: ContexteApplication
  readonly session: SessionCaisse
  readonly impression: ServiceImpression
  readonly identite: IdentiteTerminal
  readonly config: ConfigCalcul
  readonly etablissement: EnteteEtablissement
  readonly stations: ReadonlyMap<string, StationImprimante>
  readonly tables: readonly TableLocale[]
  readonly methodesPaiement: readonly MethodePaiementLocale[]
  readonly employes: readonly EmployeLocal[]
  /** Employé en poste. `null` = terminal verrouillé. */
  readonly employe: Employe | null
  readonly definirEmploye: (e: Employe | null) => void
  readonly etatImpression: EtatImpression
  /** `null` tant que l'appareil n'est pas appairé : pas de jeton, pas de sync. */
  readonly sync: MoteurSync | null
  readonly resumeSync: ResumeSync
  /** Force le rechargement des écrans qui lisent des projections. */
  readonly rafraichir: () => void
  readonly version: number
}

const Contexte = createContext<ValeurContexte | null>(null)

export function useApp(): ValeurContexte {
  const valeur = useContext(Contexte)
  if (!valeur) throw new Error('useApp() appelé hors du fournisseur de contexte.')
  return valeur
}

interface Props {
  app: ContexteApplication
  children: ReactNode
}

interface DonneesChargees {
  identite: IdentiteTerminal
  config: ConfigCalcul
  etablissement: EnteteEtablissement
  stations: Map<string, StationImprimante>
  tables: TableLocale[]
  methodesPaiement: MethodePaiementLocale[]
  employes: EmployeLocal[]
}

export function FournisseurApp({ app, children }: Props) {
  const [employe, setEmploye] = useState<Employe | null>(null)
  const [version, setVersion] = useState(0)
  const [donnees, setDonnees] = useState<DonneesChargees | null>(null)
  const [etatImpression, setEtatImpression] = useState<EtatImpression>({
    enAttente: 0,
    echecs: 0,
    enCours: false,
  })
  const [resumeSync, setResumeSync] = useState<ResumeSync>({
    etat: 'inactif',
    enAttente: 0,
    rejetes: 0,
    curseurEvenements: 0,
    curseurCatalogue: 0,
    derniereSyncA: null,
    derniereErreur: null,
    tentatives: 0,
  })
  const [appairage, setAppairage] = useState<{ url: string; jeton: string } | null>(null)

  const impression = useMemo(() => new ServiceImpression(app.fileImpression), [app])

  useEffect(() => {
    let vivant = true
    void (async () => {
      const [taxes, tables, methodes, employes, org, resto, device] = await Promise.all([
        app.catalogue.tauxTaxes(),
        app.catalogue.tables(),
        app.catalogue.methodesPaiement(),
        app.employes.actifs(),
        app.etat.lire('organization_id'),
        app.etat.lire('restaurant_id'),
        app.etat.lire('device_id'),
      ])

      const lignesStations = await app.base.adaptateur.lire<{
        id: string
        name: string
        printer_host: string | null
        printer_port: number
      }>('SELECT id, name, printer_host, printer_port FROM stations WHERE archived_at IS NULL')

      const etab = await app.base.adaptateur.lireUne<{ name: string }>(
        'SELECT name FROM restaurants LIMIT 1',
      )

      // Appairage : sans jeton d'appareil, la synchronisation reste éteinte
      // et la caisse fonctionne en local — c'est le mode Phase 0/1.
      const [urlSync, jetonSync] = await Promise.all([
        app.etat.lire('url_sync'),
        app.etat.lire('jeton_appareil'),
      ])

      if (!vivant) return
      setAppairage(urlSync && jetonSync ? { url: urlSync, jeton: jetonSync } : null)
      setDonnees({
        identite: {
          organizationId: org ?? '',
          restaurantId: resto ?? '',
          deviceId: device ?? '',
        },
        config: SessionCaisse.tauxDepuisCatalogue(taxes),
        etablissement: {
          nom: etab?.name ?? 'Kaissi',
          adresse: null,
          telephone: null,
          identifiantFiscal: null,
        },
        stations: new Map(
          lignesStations.map((s) => [
            s.id,
            { id: s.id, nom: s.name, hote: s.printer_host, port: s.printer_port },
          ]),
        ),
        tables,
        methodesPaiement: methodes,
        employes,
      })
    })()
    return () => {
      vivant = false
    }
  }, [app])

  useEffect(() => {
    const desabonner = impression.abonner(setEtatImpression)
    impression.demarrer()
    return () => {
      desabonner()
      impression.arreter()
    }
  }, [impression])

  const sync = useMemo(() => {
    if (!donnees || !appairage) return null
    return new MoteurSync({
      transport: transportHttp({ urlBase: appairage.url, jeton: appairage.jeton }),
      depot: depotLocalSync(app, () => donnees.config),
      genererId: uuidV7,
    })
  }, [app, donnees, appairage])

  useEffect(() => {
    if (!sync) return
    const desabonner = sync.abonner(setResumeSync)
    sync.demarrer()
    return () => {
      desabonner()
      sync.arreter()
    }
  }, [sync])

  const session = useMemo(
    () =>
      donnees
        ? new SessionCaisse(
            app,
            donnees.identite,
            donnees.config,
            donnees.etablissement,
            impression,
          )
        : null,
    [app, donnees, impression],
  )

  if (!donnees || !session) {
    return (
      <div className="ecran-bloquant">
        <div className="pastille-chargement" aria-hidden="true" />
        <p>Chargement du catalogue…</p>
      </div>
    )
  }

  const valeur: ValeurContexte = {
    app,
    session,
    impression,
    identite: donnees.identite,
    config: donnees.config,
    etablissement: donnees.etablissement,
    stations: donnees.stations,
    tables: donnees.tables,
    methodesPaiement: donnees.methodesPaiement,
    employes: donnees.employes,
    employe,
    definirEmploye: setEmploye,
    etatImpression,
    sync,
    resumeSync,
    rafraichir: () => setVersion((v) => v + 1),
    version,
  }

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}
