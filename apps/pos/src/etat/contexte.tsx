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
import { SessionCaisse, type IdentiteTerminal } from '../donnees/session.js'
import { ServiceImpression, type EtatImpression } from '../donnees/impression.js'

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

      if (!vivant) return
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
    rafraichir: () => setVersion((v) => v + 1),
    version,
  }

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}
