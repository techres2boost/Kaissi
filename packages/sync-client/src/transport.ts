/**
 * Transport HTTP vers l'API de synchronisation.
 *
 * Isolé pour deux raisons : le banc de test à trois appareils le remplace
 * par un transport en mémoire, et le jour où l'on bascule sur PowerSync
 * c'est ce fichier qui disparaît, pas le reste.
 */

import type { EvenementCommande, MutationCatalogue } from '@kaissi/domain'

export const VERSION_PROTOCOLE = 1

export interface RejetEvenement {
  readonly eventId: string
  readonly code: string
  readonly message: string
}

export interface ReponsePush {
  readonly acceptes: readonly string[]
  readonly doublons: readonly string[]
  readonly rejetes: readonly RejetEvenement[]
  readonly curseurEvenements: number
}

export interface ChangementCatalogue {
  readonly seq: number
  readonly entite: string
  readonly entiteId: string
  readonly operation: 'insert' | 'update' | 'delete'
  readonly donnees: Record<string, unknown> | null
}

export interface ReponsePull {
  readonly catalogue: readonly ChangementCatalogue[]
  readonly evenements: readonly EvenementCommande[]
  readonly curseurCatalogue: number
  readonly curseurEvenements: number
  readonly encore: boolean
}

/** Un service de caisse tel que la tablette le remonte. */
export interface ShiftSynchronise {
  readonly id: string
  readonly employeId: string | null
  readonly ouvertA: string
  readonly fondDeCaisseMillimes: number
  readonly fermeA: string | null
  /** L'employé qui a COMPTÉ la caisse — pas forcément celui qui a ouvert. */
  readonly fermePar?: string | null
  readonly compteMillimes: number | null
  readonly attenduMillimes: number | null
  readonly ecartMillimes: number | null
}

export interface ReponseShifts {
  readonly enregistres: readonly string[]
}

/**
 * La réponse du serveur à un lot de mutations de catalogue.
 *
 * Elle a la MÊME forme que celle des ventes, et ce n'est pas une coquetterie :
 * l'outbox purge sur `acceptes` et remonte `rejetes` au gérant, pour les deux
 * sortes de lignes. Une seconde forme aurait demandé un second chemin de
 * purge — celui-là même qu'il ne faut jamais avoir écrit deux fois.
 */
export interface ReponseCatalogue {
  readonly acceptes: readonly string[]
  readonly rejetes: readonly { eventId: string; code: string; message: string }[]
}

export interface Transport {
  push(batchId: string, evenements: readonly EvenementCommande[]): Promise<ReponsePush>
  pull(depuisCatalogue: number, depuisEvenements: number, taillePage?: number): Promise<ReponsePull>
  /**
   * FACULTATIF : remontée des services de caisse.
   *
   * Absent des transports de test, et absent des serveurs antérieurs — d'où
   * l'optionalité. Les ventes ne dépendent jamais de cette route.
   */
  shifts?(shifts: readonly ShiftSynchronise[]): Promise<ReponseShifts>
  /**
   * FACULTATIF : les mutations de catalogue émises par la caisse.
   *
   * Facultatif pour la même raison que `shifts` — un serveur antérieur ne
   * connaît pas cette route, et un article qui attend ne doit JAMAIS empêcher
   * une vente de partir.
   */
  catalogue?(mutations: readonly MutationCatalogue[]): Promise<ReponseCatalogue>
}

/**
 * Erreur de transport.
 * `definitive` distingue « le réseau a hoqueté, réessaie » de « le serveur
 * a refusé, n'insiste pas ». Réessayer en boucle un appareil révoqué
 * viderait la batterie sans rien résoudre.
 */
export class ErreurTransport extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
    readonly statut?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ErreurTransport'
  }
}

export interface OptionsTransport {
  readonly urlBase: string
  readonly jeton: string
  /** Coupe une requête qui traîne : la caisse ne doit jamais attendre. */
  readonly delaiMs?: number
  readonly fetch?: typeof globalThis.fetch
}

export function transportHttp(options: OptionsTransport): Transport {
  const executer = options.fetch ?? globalThis.fetch.bind(globalThis)
  const delai = options.delaiMs ?? 15_000
  const base = options.urlBase.replace(/\/+$/, '')

  const appeler = async (chemin: string, init: RequestInit): Promise<unknown> => {
    const abandon = new AbortController()
    const minuteur = setTimeout(() => abandon.abort(), delai)
    let reponse: Response
    try {
      reponse = await executer(`${base}${chemin}`, {
        ...init,
        signal: abandon.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.jeton}`,
          ...(init.headers ?? {}),
        },
      })
    } catch (erreur) {
      // Réseau coupé, DNS injoignable, délai dépassé : temporaire par nature.
      throw new ErreurTransport(
        erreur instanceof Error ? erreur.message : 'Réseau injoignable',
        false,
      )
    } finally {
      clearTimeout(minuteur)
    }

    if (!reponse.ok) {
      const corps = (await reponse.json().catch(() => null)) as
        | { erreur?: string; message?: string }
        | null
      // 401/403/426 : la situation ne s'arrangera pas toute seule.
      const definitive = [401, 403, 413, 426].includes(reponse.status)
      throw new ErreurTransport(
        corps?.message ?? `Le serveur a répondu ${reponse.status}.`,
        definitive,
        reponse.status,
        corps?.erreur,
      )
    }
    return reponse.json()
  }

  return {
    async push(batchId, evenements) {
      return (await appeler('/sync/push', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: VERSION_PROTOCOLE,
          batchId,
          evenements,
        }),
      })) as ReponsePush
    },

    async shifts(shifts) {
      return (await appeler('/sync/shifts', {
        method: 'POST',
        body: JSON.stringify({ protocolVersion: VERSION_PROTOCOLE, shifts }),
      })) as ReponseShifts
    },

    async catalogue(mutations) {
      return (await appeler('/sync/catalogue', {
        method: 'POST',
        body: JSON.stringify({ protocolVersion: VERSION_PROTOCOLE, mutations }),
      })) as ReponseCatalogue
    },

    async pull(depuisCatalogue, depuisEvenements, taillePage = 500) {
      const parametres = new URLSearchParams({
        protocolVersion: String(VERSION_PROTOCOLE),
        depuisCatalogue: String(depuisCatalogue),
        depuisEvenements: String(depuisEvenements),
        taillePage: String(taillePage),
      })
      return (await appeler(`/sync/pull?${parametres}`, { method: 'GET' })) as ReponsePull
    },
  }
}
