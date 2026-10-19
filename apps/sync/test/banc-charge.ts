/**
 * Le banc des tests de charge et de stress : une caisse SIMULÉE qui parle le
 * protocole du POS (push par lots de 100, pull après push, renvois), et les
 * trois vérifications qui ne se négocient pas — aucune vente perdue, aucune
 * dupliquée, totaux exacts au millime.
 *
 * Partagé par `charge.test.ts` (on exige zéro erreur) et `stress.test.ts`
 * (on cherche la limite). Un seul simulateur : deux copies divergeraient, et
 * un test de stress qui ne parle plus le protocole de la caisse ne prouve
 * plus rien sur elle.
 */

import { appendFileSync } from 'node:fs'
import { Client } from 'pg'
import { expect } from 'vitest'
import {
  calculerTotaux,
  millimes,
  reduireEvenements,
  uuidV7,
  type ConfigCalcul,
  type EvenementCommande,
  type PointsDeBase,
} from '@kaissi/domain'
import { centile } from '../src/surveillance.js'
import { EMPLOYE_DEMO, ESPECES, TVA_07, TVA_19, URL_TEST, ev, type AppareilTest } from './aide.js'

/** La carte d'un snack : prix TTC en millimes, deux taux de TVA. */
export const CARTE = [
  { id: '01930000-0000-7000-8000-000000000200', nom: 'Pizza Margherita', prix: 14_500, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000201', nom: 'Couscous poulet', prix: 19_000, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000202', nom: 'Ojja merguez', prix: 13_500, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000203', nom: 'Escalope panée', prix: 16_000, taux: TVA_19 },
  { id: '01930000-0000-7000-8000-000000000204', nom: 'Coca-Cola 33cl', prix: 2_500, taux: TVA_07 },
  { id: '01930000-0000-7000-8000-000000000205', nom: 'Eau 1,5 L', prix: 1_200, taux: TVA_07 },
]

/** Générateur pseudo-aléatoire DÉTERMINISTE : un échec se rejoue à l'identique. */
export function hasard(graine: number) {
  let x = graine >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4_294_967_296
  }
}

export interface Mesure {
  readonly route: 'push' | 'pull'
  readonly ms: number
  /** Code HTTP ; 0 quand la requête n'a pas abouti (délai dépassé, connexion refusée). */
  readonly statut: number
}

/**
 * Comment la caisse simulée se comporte quand le serveur peine.
 *
 * Par défaut (`tolerante: false`) : la moindre erreur fait échouer le test —
 * c'est le régime des scénarios de charge, où l'on exige ZÉRO erreur.
 *
 * En stress (`tolerante: true`), on se comporte comme la VRAIE caisse :
 * délai de 15 s par requête, et sur une erreur ou un délai dépassé l'outbox
 * reste intacte et l'on réessaie plus tard. On cherche alors la limite — et
 * on exige que, même au-delà, aucune vente ne soit perdue ni doublée.
 */
export interface Comportement {
  readonly tolerante: boolean
  readonly delaiMs: number
  readonly tentativesMax: number
}

const STRICTE: Comportement = { tolerante: false, delaiMs: 60_000, tentativesMax: 1 }

/** Une caisse : son journal, son outbox, ses mesures. Le protocole du POS. */
export class Caisse {
  seq = 0
  ventes = 0
  readonly journal: EvenementCommande[] = []
  outbox: EvenementCommande[] = []
  curseurEvenements = 0
  curseurCatalogue = 0
  readonly mesures: Mesure[] = []
  readonly attendus = new Map<string, number>()

  constructor(
    readonly appareil: AppareilTest,
    readonly aleatoire: () => number,
    readonly base: string,
    readonly comportement: Comportement = STRICTE,
  ) {}

  private emettre(orderId: string, type: string, charge: unknown): EvenementCommande {
    this.seq += 1
    /*
     * Une horloge RÉELLE et croissante, comme la caisse. Celle de `ev()`
     * reboucle toutes les soixante secondes simulées : sur une commande à
     * cheval, « quantité changée » paraissait précéder « article ajouté »,
     * la réduction locale l'ignorait, et le test signalait un écart de total
     * qui n'existait que dans le banc.
     */
    const e = {
      ...ev(this.appareil, orderId, type as never, charge as never, this.seq),
      clientTs: new Date(Date.UTC(2026, 9, 17, 12) + this.seq).toISOString(),
    }
    this.journal.push(e)
    this.outbox.push(e)
    return e
  }

  /**
   * Une commande complète, geste par geste. `pousserApresChaqueGeste` :
   * le comportement de la caisse en ligne. Hors ligne, tout reste en outbox.
   */
  async commande(config: ConfigCalcul, pousserApresChaqueGeste: boolean): Promise<string> {
    const orderId = uuidV7()
    const r = this.aleatoire
    this.ventes += 1
    this.emettre(orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${this.appareil.prefixe}-${String(this.ventes).padStart(6, '0')}`,
    })
    if (pousserApresChaqueGeste) await this.synchroniser()

    const nbLignes = 2 + Math.floor(r() * 3)
    const lignes: string[] = []
    for (let i = 0; i < nbLignes; i += 1) {
      const plat = CARTE[Math.floor(r() * CARTE.length)]!
      const ligneId = uuidV7()
      lignes.push(ligneId)
      this.emettre(orderId, 'line.added', {
        ligneId,
        produitId: plat.id,
        designation: plat.nom,
        quantite: 1 + Math.floor(r() * 2),
        prixBaseMillimes: millimes(plat.prix),
        modificateursMillimes: millimes(0),
        tauxTaxeId: plat.taux,
      })
    }
    if (r() < 0.3) {
      this.emettre(orderId, 'line.quantity_changed', { ligneId: lignes[0]!, quantite: 3 })
    }
    if (pousserApresChaqueGeste) await this.synchroniser()

    this.emettre(orderId, 'order.sent', { lignes })
    if (pousserApresChaqueGeste) await this.synchroniser()

    // Le total vient de packages/domain — la MÊME fonction que la caisse.
    const etat = reduireEvenements(this.journal.filter((e) => e.orderId === orderId))
    const total = calculerTotaux({ lignes: etat.lignes, config }).totalMillimes
    this.attendus.set(orderId, total)
    this.emettre(orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: total,
      recuMillimes: total,
      renduMillimes: millimes(0),
    })
    this.emettre(orderId, 'order.closed', { totalMillimes: total, closePar: EMPLOYE_DEMO })
    if (pousserApresChaqueGeste) await this.synchroniser()
    return orderId
  }

  private async appeler(route: 'push' | 'pull', chemin: string, init: RequestInit = {}) {
    const { tolerante, delaiMs, tentativesMax } = this.comportement
    for (let tentative = 1; ; tentative += 1) {
      const debut = performance.now()
      let statut = 0
      let corps: any = null
      try {
        const reponse = await fetch(`${this.base}${chemin}`, {
          ...init,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.appareil.jetonClair}`,
          },
          signal: AbortSignal.timeout(delaiMs),
        })
        statut = reponse.status
        corps = await reponse.json().catch(() => null)
      } catch (erreur) {
        if (!tolerante) throw erreur
      }
      this.mesures.push({ route, ms: performance.now() - debut, statut })
      if (statut >= 200 && statut < 300) return corps
      if (!tolerante || tentative >= tentativesMax) {
        throw new Error(`${route} ${statut} : ${corps?.message ?? 'pas de réponse'}`)
      }
      // La vraie caisse attend le cycle suivant ; ici, un recul court et
      // croissant, pour ne pas aggraver la file qu'on vient de trouver.
      await new Promise((fin) => setTimeout(fin, Math.min(5_000, 200 * 2 ** tentative)))
    }
  }

  /** Push (par lots de 100, comme la caisse) puis pull. */
  async synchroniser(renvoi = 0): Promise<void> {
    while (this.outbox.length > 0) {
      const lot = this.outbox.slice(0, 100)
      const corps = await this.appeler('push', '/sync/push', {
        method: 'POST',
        body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: lot }),
      })
      // Le réseau hoquette : l'accusé n'est jamais arrivé, le même lot repart.
      if (this.aleatoire() < renvoi) {
        await this.appeler('push', '/sync/push', {
          method: 'POST',
          body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements: lot }),
        })
      }
      const acquittes = new Set<string>([...corps.acceptes, ...corps.doublons])
      expect(corps.rejetes, 'aucune vente ne doit être rejetée').toEqual([])
      this.outbox = this.outbox.filter((e) => !acquittes.has(e.eventId))
    }
    const p = new URLSearchParams({
      protocolVersion: '1',
      depuisCatalogue: String(this.curseurCatalogue),
      depuisEvenements: String(this.curseurEvenements),
      taillePage: '500',
    })
    const pull = await this.appeler('pull', `/sync/pull?${p}`)
    this.curseurEvenements = pull.curseurEvenements
    this.curseurCatalogue = pull.curseurCatalogue
  }
}

export async function configCalcul(): Promise<ConfigCalcul> {
  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  const { rows } = await client.query(
    'select id, name, rate_bp, is_included from kaissi.tax_rates where restaurant_id is not null',
  )
  await client.end()
  return {
    tauxTaxes: Object.fromEntries(
      rows.map((r) => [r.id, { id: r.id, nom: r.name, tauxBp: r.rate_bp as PointsDeBase, incluse: r.is_included }]),
    ),
  }
}

/** Les trois propriétés dures, vérifiées en base. */
export async function verifierInvariants(caisses: readonly Caisse[]) {
  const attendus = new Map<string, number>()
  for (const c of caisses) for (const [id, total] of c.attendus) attendus.set(id, total)
  const evenementsEmis = caisses.reduce((s, c) => s + c.journal.length, 0)

  const client = new Client({ connectionString: URL_TEST })
  await client.connect()
  try {
    const { rows: commandes } = await client.query<{ id: string; status: string; total_millimes: string }>(
      'select id, status, total_millimes from kaissi.orders where id = any($1::uuid[])',
      [[...attendus.keys()]],
    )
    const { rows: [compte] } = await client.query<{ n: number; distincts: number }>(
      `select count(*)::int as n, count(distinct event_id)::int as distincts
         from kaissi.order_events where event_id = any($1::uuid[])`,
      [caisses.flatMap((c) => c.journal.map((e) => e.eventId))],
    )
    const { rows: [paiements] } = await client.query<{ n: number }>(
      'select count(*)::int as n from kaissi.payments where order_id = any($1::uuid[])',
      [[...attendus.keys()]],
    )

    // 1. Aucune vente perdue.
    expect(commandes.length, 'commandes projetées').toBe(attendus.size)
    expect(commandes.every((c) => c.status === 'close'), 'toutes closes').toBe(true)
    // 2. Aucun doublon : chaque événement une fois, chaque vente payée une fois.
    expect(compte!.n).toBe(evenementsEmis)
    expect(compte!.distincts).toBe(evenementsEmis)
    expect(paiements!.n).toBe(attendus.size)
    // 3. Totaux exacts, au millime, commande par commande.
    const ecarts = commandes.filter((c) => Number(c.total_millimes) !== attendus.get(c.id))
    expect(ecarts.map((c) => `${c.id} serveur=${c.total_millimes} caisse=${attendus.get(c.id)}`), 'écarts de total caisse ↔ serveur').toEqual([])
    const ca = commandes.reduce((s, c) => s + Number(c.total_millimes), 0)
    const caAttendu = [...attendus.values()].reduce((s, v) => s + v, 0)
    expect(ca).toBe(caAttendu)
    return { commandes: commandes.length, evenements: evenementsEmis, ca }
  } finally {
    await client.end()
  }
}

export function resume(
  rapport: Record<string, unknown>[],
  nom: string,
  caisses: readonly Caisse[],
  dureeMs: number,
  commandes: number,
) {
  const mesures = caisses.flatMap((c) => c.mesures)
  const push = mesures.filter((m) => m.route === 'push').map((m) => m.ms).sort((a, b) => a - b)
  const pull = mesures.filter((m) => m.route === 'pull').map((m) => m.ms).sort((a, b) => a - b)
  const erreurs = mesures.filter((m) => m.statut >= 500).length
  const sansReponse = mesures.filter((m) => m.statut === 0).length
  const ligne = {
    scenario: nom,
    caisses: caisses.length,
    commandes,
    requetes: mesures.length,
    'durée (s)': Math.round(dureeMs / 100) / 10,
    'commandes/s': Math.round((commandes / (dureeMs / 1000)) * 10) / 10,
    'push p50': Math.round(centile(push, 50)),
    'push p95': Math.round(centile(push, 95)),
    'push p99': Math.round(centile(push, 99)),
    'pull p95': Math.round(centile(pull, 95)),
    'erreurs 5xx': erreurs,
    'sans réponse': sansReponse,
  }
  rapport.push(ligne)
  return ligne
}

/**
 * Le rapport, écrit directement sur la sortie standard : `console.table`
 * dans un `afterAll` est capturé par vitest et n'apparaissait plus.
 * `KAISSI_RAPPORT_CHARGE=<fichier>` l'écrit AUSSI en JSON, pour la doc.
 */
export function imprimerRapport(titre: string, rapport: readonly Record<string, unknown>[]): void {
  if (rapport.length === 0) return
  const texte = (v: unknown) =>
    typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
  const colonnes = Object.keys(rapport[0]!)
  const largeurs = colonnes.map((c) =>
    Math.max(c.length, ...rapport.map((l) => texte(l[c]).length)),
  )
  const ligne = (valeurs: string[]) =>
    '  ' + valeurs.map((v, i) => v.padEnd(largeurs[i]!)).join(' │ ')
  process.stdout.write(
    [
      '',
      `  ── ${titre} ──`,
      ligne(colonnes),
      '  ' + largeurs.map((l) => '─'.repeat(l)).join('─┼─'),
      ...rapport.map((l) => ligne(colonnes.map((c) => texte(l[c])))),
      '',
    ].join('\n') + '\n',
  )
  const fichier = process.env['KAISSI_RAPPORT_CHARGE']
  if (fichier) {
    appendFileSync(fichier, JSON.stringify({ titre, rapport }) + '\n')
  }
}

