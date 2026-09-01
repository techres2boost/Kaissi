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
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ConfigCalcul, Employe, EnteteEtablissement } from '@kaissi/domain'
import type { EmployeLocal, MethodePaiementLocale, TableLocale } from '@kaissi/db-local'
import type { ContexteApplication } from '../donnees/demarrage.js'
import { MoteurSync, transportHttp, type ResumeSync } from '@kaissi/sync-client'
import { uuidV7 } from '@kaissi/domain'
import { IMPRESSION_ACTIVE } from '../config.js'
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
  // Stable : une fonction recréée à chaque rendu entre dans les dépendances
  // des effets qui l'utilisent et les relance pour rien.
  const rafraichir = useCallback(() => setVersion((v) => v + 1), [])
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
    // Impression éteinte : ni abonnement, ni boucle de drainage. Une boucle
    // qui tourne toutes les cinq secondes pour ne rien trouver, c'est de la
    // batterie dépensée à ne rien faire sur une tablette d'entrée de gamme.
    if (!IMPRESSION_ACTIVE) return
    const desabonner = impression.abonner(setEtatImpression)
    impression.demarrer()
    return () => {
      desabonner()
      impression.arreter()
    }
  }, [impression])

  /*
   * L'appareil ADOPTE l'identité que son jeton désigne.
   *
   * Le terminal démarre avec le `device_id` de la graine de démonstration.
   * L'appairage, lui, crée un appareil au tout autre identifiant côté
   * serveur. Tant que les deux divergent, CHAQUE vente part et revient
   * refusée en « appareil_etranger » : le jeton est bon, mais l'événement
   * prétend venir d'ailleurs. La caisse encaisse, et rien ne remonte.
   *
   * Le serveur fait autorité sur « quel appareil suis-je » : on le lui
   * demande, une fois, au démarrage. C'est une réparation AUTOMATIQUE —
   * l'ancienne version exigeait de ré-appairer à la main, or le formulaire
   * d'appairage ne s'affiche que si l'on ne l'est PAS. Le terminal était donc
   * dans un état dont il ne pouvait pas sortir seul.
   *
   * Hors du chemin de vente, non bloquant, et silencieux en cas d'échec :
   * hors ligne, on réessaiera au prochain démarrage.
   */
  useEffect(() => {
    if (!appairage || !donnees) return
    let vivant = true
    void (async () => {
      try {
        const reponse = await fetch(`${appairage.url}/sync/appareil`, {
          headers: { authorization: `Bearer ${appairage.jeton}` },
        })
        if (!reponse.ok || !vivant) return
        const identite = (await reponse.json()) as {
          deviceId?: string
          restaurantId?: string
          organizationId?: string
        }
        if (!identite.deviceId || identite.deviceId === donnees.identite.deviceId) return

        await app.etat.ecrire('device_id', identite.deviceId)
        if (identite.restaurantId) await app.etat.ecrire('restaurant_id', identite.restaurantId)
        if (identite.organizationId) {
          await app.etat.ecrire('organization_id', identite.organizationId)
        }
        if (!vivant) return
        // On corrige l'identité EN MÉMOIRE plutôt que de recharger la page :
        // `SessionCaisse` est reconstruite, et un caissier en pleine saisie ne
        // perd rien.
        setDonnees((precedent) =>
          precedent
            ? {
                ...precedent,
                identite: {
                  deviceId: identite.deviceId!,
                  restaurantId: identite.restaurantId ?? precedent.identite.restaurantId,
                  organizationId: identite.organizationId ?? precedent.identite.organizationId,
                },
              }
            : precedent,
        )
      } catch {
        // Serveur injoignable : la caisse fonctionne, on retentera plus tard.
      }
    })()
    return () => {
      vivant = false
    }
    // `donnees.identite.deviceId` et non `donnees` : ce dernier change à
    // chaque rechargement du catalogue, et relancerait l'appel pour rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, appairage, donnees?.identite.deviceId])

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

  // MÉMORISÉE, et calculée AVANT le retour anticipé — les crochets ne se
  // sautent pas.
  //
  // Sans cette mémorisation, l'objet était recréé à chaque rendu du
  // fournisseur. Or la file d'impression pousse son état à intervalle
  // régulier : chaque tic changeait donc l'identité du contexte, et tout
  // effet qui en dépend se relançait. Concrètement, le caissier qui
  // consultait « Boissons » était renvoyé sur « Plats » au bout de quelques
  // secondes, sans avoir rien touché.
  const valeur = useMemo<ValeurContexte | null>(
    () =>
      donnees && session
        ? {
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
            rafraichir,
            version,
          }
        : null,
    [
      app,
      donnees,
      session,
      impression,
      employe,
      etatImpression,
      sync,
      resumeSync,
      rafraichir,
      version,
    ],
  )

  if (!valeur) {
    return (
      <div className="ecran-bloquant">
        <div className="pastille-chargement" aria-hidden="true" />
        <p>Chargement du catalogue…</p>
      </div>
    )
  }

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}
