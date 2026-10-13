/**
 * Le curseur de lecture n'avance QUE par ce qu'on a LU.
 *
 * ── PANNE OBSERVÉE (octobre 2026) ─────────────────────────────────────────
 *
 * « Reçus » marquait « en attente » des ventes que le back-office affichait
 * bel et bien. Le badge se fonde sur `order_events.server_seq IS NULL` : il
 * ne s'éteint que lorsque la caisse RELIT ses propres événements, numérotés
 * par le serveur.
 *
 * Or, après chaque push, le moteur écrivait comme curseur de lecture la
 * TÊTE du journal du restaurant (`curseurEvenements` de la réponse). Le pull
 * suivant partait donc d'après ses propres événements — qui ne revenaient
 * jamais — et, bien pire, d'après ceux qu'une AUTRE caisse avait poussés
 * entre-temps. Ceux-là, cette caisse ne les voyait jamais : ni dans ses
 * reçus, ni sur ses tables. Le même trou que la migration 0043 a fermé côté
 * serveur, rouvert côté appareil.
 *
 * Ce test fait tourner le VRAI moteur et le VRAI transport HTTP contre le
 * serveur ; seule la base locale est simulée.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { millimes, uuidV7, type EvenementCommande } from '@kaissi/domain'
/*
 * Par chemin RELATIF, à dessein : déclarer `@kaissi/sync-client` en
 * dépendance de l'API ferait entrer le paquet dans l'image Docker (le
 * Dockerfile n'installe que `@kaissi/sync...`). Le code testé est bien celui
 * que la caisse embarque — c'est tout ce qui compte ici.
 */
import {
  MoteurSync,
  transportHttp,
  type DepotLocalSync,
} from '../../../packages/sync-client/src/index.js'
import { creerServeur } from '../src/serveur.js'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerAppareil, EMPLOYE_DEMO, ev, nettoyer, URL_TEST, type AppareilTest } from './aide.js'

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot, auth: null })

/** Une caisse : sa base locale en mémoire, et le moteur de production. */
class Caisse {
  readonly evenements = new Map<string, EvenementCommande>()
  readonly outbox: EvenementCommande[] = []
  readonly curseurs = { catalogue: 0, evenements: 0 }
  readonly moteur: MoteurSync

  constructor(readonly appareil: AppareilTest) {
    const local: DepotLocalSync = {
      lotAPousser: async (taille) =>
        this.outbox.slice(0, taille).map((e) => ({ eventId: e.eventId, payload: JSON.stringify(e) })),
      accuserReception: async (ids) => {
        for (const id of ids) {
          const i = this.outbox.findIndex((e) => e.eventId === id)
          if (i >= 0) this.outbox.splice(i, 1)
        }
      },
      marquerRejet: async () => undefined,
      integrerEvenements: async (recus) => {
        for (const e of recus) this.evenements.set(e.eventId, e)
      },
      integrerCatalogue: async () => undefined,
      lireCurseur: async (cle) => this.curseurs[cle],
      ecrireCurseur: async (cle, valeur) => {
        this.curseurs[cle] = valeur
      },
      compteurs: async () => ({ enAttente: this.outbox.length, rejetes: 0 }),
    }
    this.moteur = new MoteurSync({
      depot: local,
      genererId: uuidV7,
      transport: transportHttp({
        urlBase: 'http://test',
        jeton: appareil.jetonClair,
        fetch: ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch,
      }),
    })
  }

  /** Une vente à emporter, écrite localement — comme la caisse le fait. */
  vendre(): string {
    const orderId = uuidV7()
    for (const e of [
      ev(this.appareil, orderId, 'order.opened', { type: 'takeaway', ouvertePar: EMPLOYE_DEMO }),
      ev(this.appareil, orderId, 'order.closed', { totalMillimes: millimes(0), closePar: EMPLOYE_DEMO }),
    ]) {
      this.evenements.set(e.eventId, e)
      this.outbox.push(e)
    }
    return orderId
  }

  /** Les événements de cette commande que le serveur n'a pas encore numérotés. */
  nonNumerotes(orderId: string): number {
    return [...this.evenements.values()].filter((e) => e.orderId === orderId && e.serverSeq === null)
      .length
  }

  connait(orderId: string): boolean {
    return [...this.evenements.values()].some((e) => e.orderId === orderId)
  }
}

let a: Caisse
let b: Caisse

beforeEach(async () => {
  await nettoyer()
  a = new Caisse(await creerAppareil('CA'))
  b = new Caisse(await creerAppareil('CB'))
})

describe('le curseur de lecture après un push', () => {
  it('une caisse VOIT la vente qu’une autre a poussée juste avant son propre push', async () => {
    await a.moteur.cycle() // A est à jour : rien encore

    const venteDeB = b.vendre()
    await b.moteur.cycle() // B pousse — A ne l'a pas encore lu

    a.vendre()
    const resume = await a.moteur.cycle() // A pousse, PUIS lit

    expect(resume.etat).toBe('a_jour')
    /*
     * Avec l'ancien moteur, le push avait déjà placé le curseur de A en tête
     * du journal — APRÈS la vente de B. Le pull ne la rendait jamais.
     */
    expect(a.connait(venteDeB), 'la vente de B doit redescendre sur A').toBe(true)
  })

  it('ses PROPRES ventes reviennent numérotées — le badge « en attente » s’éteint', async () => {
    const vente = a.vendre()
    await a.moteur.cycle()

    expect(a.outbox, 'accusées : l’outbox est vide').toEqual([])
    expect(a.nonNumerotes(vente), 'le serveur les a numérotées, la caisse doit le savoir').toBe(0)
  })
})
