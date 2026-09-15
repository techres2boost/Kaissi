/**
 * Options de restauration — service et timbre, du back-office jusqu'au ticket.
 *
 * ── Ce que ce test protège, et pourquoi il ressemble à celui-là ───────────
 *
 * `service_rate_bp`, `service_taxable` et `stamp_duty_millimes` existent
 * depuis la migration 0002 ; `packages/domain` sait les appliquer depuis
 * toujours (étapes 7 et 8 de l'ordre figé). Personne ne les LISAIT. Les
 * brancher touche la seule chose que ce dépôt ne peut pas se permettre de
 * casser : le TOTAL.
 *
 * Le danger n'est pas qu'un calcul soit faux — `totaux.test.ts` couvre déjà
 * l'arithmétique. Le danger est que les DEUX chemins ne lisent pas la même
 * chose :
 *
 *   • la CAISSE construit sa configuration depuis la table miroir
 *     `restaurants`, remplie par `change_log` ;
 *   • le SERVEUR reprojette chaque commande à l'arrivée, avec sa propre
 *     lecture de `kaissi.restaurants`.
 *
 * S'ils divergent, la tablette imprime un total et le back-office en affiche
 * un autre POUR LA MÊME VENTE. Aucune erreur n'est levée nulle part. C'est
 * exactement la forme de panne que la RÈGLE 7 existe pour empêcher, et la
 * seule façon de la prouver absente est de faire tourner les deux chemins sur
 * les mêmes ventes et d'exiger l'égalité au millime — comme le fait déjà
 * `rapports-agreges.test.ts` pour les rapports.
 *
 * ⚠ Les valeurs employées ici (10 % de service, 600 millimes de timbre) sont
 *   des valeurs de TEST. Ce fichier ne dit rien de ce qui s'applique en
 *   Tunisie — voir la migration 0036 et CLAUDE.md, « Points à valider avec un
 *   expert-comptable tunisien ».
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  configEtablissement,
  millimes,
  reconstruireCommande,
  uuidV7,
  type EvenementCommande,
} from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  ESPECES,
  TVA_07,
  TVA_19,
  URL_TEST,
  type AppareilTest,
} from './aide.js'

const client = new Client({ connectionString: URL_TEST })
await client.connect()

const depot = new DepotPostgres({ connectionString: URL_TEST, ssl: false })
const app = creerServeur({ depot })

const PLAT = '01930000-0000-7000-8000-000000000204'
const BOISSON = '01930000-0000-7000-8000-000000000221'

let appareil: AppareilTest

beforeAll(async () => {
  await nettoyer()
  appareil = await creerAppareil('OR')
})

/*
 * La base de test est PARTAGÉE entre les fichiers.
 *
 * Laisser 10 % de service sur l'établissement de démonstration ferait échouer
 * `rapports-agreges.test.ts` — sur un écart de total que RIEN dans son message
 * ne relierait à ce fichier-ci. La leçon a déjà été apprise avec les
 * organisations de `inscription.test.ts`.
 */
afterEach(async () => {
  await reglerOptions({ tauxServiceBp: 0, taxable: false, tauxTaxeId: null, timbre: 0 })
})

afterAll(async () => {
  await nettoyer()
  await client.end()
  await depot.fermer()
})

async function reglerOptions(o: {
  tauxServiceBp: number
  taxable: boolean
  tauxTaxeId: string | null
  timbre: number
}): Promise<void> {
  await client.query(
    `update kaissi.restaurants
        set service_rate_bp = $2, service_taxable = $3,
            service_tax_rate_id = $4, stamp_duty_millimes = $5
      where id = $1`,
    [DEMO_RESTO, o.tauxServiceBp, o.taxable, o.tauxTaxeId, o.timbre],
  )
}

interface Article {
  produitId: string
  designation: string
  prixMillimes: number
  quantite: number
  tauxTaxeId: string
}

/** Pousse une vente par le VRAI chemin — `/sync/push` — et rend son journal. */
async function vendre(
  articles: Article[],
  options: { service?: { tauxBp: number; taxable: boolean; tauxTaxeId?: string } } = {},
): Promise<{ orderId: string; evenements: EvenementCommande[] }> {
  const orderId = uuidV7()
  const evenements: EvenementCommande[] = [
    ev(appareil, orderId, 'order.opened', {
      type: 'dine_in',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${appareil.prefixe}-${orderId.slice(-6)}`,
    }),
  ]

  if (options.service) {
    evenements.push(
      ev(appareil, orderId, 'service.set', {
        tauxBp: options.service.tauxBp,
        taxable: options.service.taxable,
        tauxTaxeId: options.service.tauxTaxeId ?? null,
      }),
    )
  }

  for (const a of articles) {
    evenements.push(
      ev(appareil, orderId, 'line.added', {
        ligneId: uuidV7(),
        produitId: a.produitId,
        designation: a.designation,
        quantite: a.quantite,
        prixBaseMillimes: millimes(a.prixMillimes),
        modificateursMillimes: millimes(0),
        tauxTaxeId: a.tauxTaxeId,
      }),
    )
  }

  evenements.push(
    ev(appareil, orderId, 'payment.recorded', {
      paiementId: uuidV7(),
      methodeId: ESPECES,
      mode: 'cash',
      montantMillimes: millimes(1_000),
      recuMillimes: millimes(1_000),
      renduMillimes: millimes(0),
    }),
    ev(appareil, orderId, 'order.closed', {
      totalMillimes: millimes(0),
      closePar: EMPLOYE_DEMO,
    }),
  )

  const reponse = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${appareil.jetonClair}`,
    },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  expect(reponse.status).toBe(200)
  return { orderId, evenements }
}

/** Ce que le SERVEUR a écrit — la vérité du back-office. */
async function projection(orderId: string) {
  const { rows } = await client.query(
    `select subtotal_millimes, discount_millimes, tax_millimes, service_millimes,
            stamp_duty_millimes, total_millimes
       from kaissi.orders where id = $1`,
    [orderId],
  )
  expect(rows, 'la vente doit être projetée').toHaveLength(1)
  const l = rows[0]
  return {
    sousTotal: Number(l.subtotal_millimes),
    remises: Number(l.discount_millimes),
    taxe: Number(l.tax_millimes),
    service: Number(l.service_millimes),
    timbre: Number(l.stamp_duty_millimes),
    total: Number(l.total_millimes),
  }
}

/**
 * Ce que la CAISSE calcule — reconstruit depuis ce que `change_log` lui a
 * VRAIMENT envoyé.
 *
 * C'est le point du test. On ne relit pas `kaissi.restaurants` : on lit la
 * charge utile journalisée, celle que le miroir applique sur la tablette,
 * puis on la traduit avec `configEtablissement` — la fonction que le POS
 * appelle. Lire la table directement aurait testé deux fois le même chemin.
 */
async function calculCaisse(evenements: EvenementCommande[]) {
  const { rows: journal } = await client.query(
    `select payload from kaissi.change_log
      where entity_type = 'restaurants' and entity_id = $1
      order by seq desc limit 1`,
    [DEMO_RESTO],
  )
  expect(
    journal,
    'l’établissement doit être descendu par change_log — sinon la caisse ' +
      'ne connaîtrait jamais ses options',
  ).toHaveLength(1)
  const descendu = journal[0].payload as Record<string, unknown>

  const { rows: taux } = await client.query(
    `select id, name, rate_bp, is_included from kaissi.tax_rates
      where restaurant_id = $1 and archived_at is null`,
    [DEMO_RESTO],
  )

  const config = configEtablissement(
    taux.map((t: { id: string; name: string; rate_bp: number; is_included: boolean }) => ({
      id: t.id,
      nom: t.name,
      tauxBp: t.rate_bp,
      incluse: t.is_included,
    })),
    {
      tauxServiceBp: Number(descendu['service_rate_bp'] ?? 0),
      serviceTaxable: Boolean(descendu['service_taxable']),
      serviceTauxTaxeId: (descendu['service_tax_rate_id'] as string | null) ?? null,
      timbreMillimes: Number(descendu['stamp_duty_millimes'] ?? 0),
    },
  )

  const { totaux } = reconstruireCommande(evenements, config)
  return {
    sousTotal: totaux.sousTotalMillimes,
    remises: totaux.totalRemisesMillimes,
    taxe: totaux.taxeMillimes,
    service: totaux.serviceMillimes,
    timbre: totaux.timbreFiscalMillimes,
    total: totaux.totalMillimes,
  }
}

const OJJA = { produitId: PLAT, designation: 'Ojja merguez', prixMillimes: 12_500, quantite: 1, tauxTaxeId: TVA_19 }
const COCA = { produitId: BOISSON, designation: 'Coca', prixMillimes: 3_500, quantite: 2, tauxTaxeId: TVA_07 }

describe('les options de restauration s’appliquent, et des DEUX côtés', () => {
  it('sans option, rien ne change — service et timbre restent à zéro', async () => {
    const { orderId, evenements } = await vendre([OJJA, COCA])
    const serveur = await projection(orderId)

    expect(serveur.service).toBe(0)
    expect(serveur.timbre).toBe(0)
    expect(serveur).toEqual(await calculCaisse(evenements))
  })

  it('un service NON taxable et un timbre s’ajoutent au total, à l’identique', async () => {
    // La MÊME vente sans aucune option, pour mesurer ce que les options
    // ajoutent VRAIMENT. Un `toBeGreaterThan(0)` passerait aussi avec un
    // service de un millime.
    const temoin = await projection((await vendre([OJJA, COCA])).orderId)

    await reglerOptions({ tauxServiceBp: 1000, taxable: false, tauxTaxeId: null, timbre: 600 })
    const { orderId, evenements } = await vendre([OJJA, COCA])
    const serveur = await projection(orderId)

    /*
     * Le service porte sur la base APRÈS remises (étape 7), et les taux de
     * démonstration sont INCLUS : la taxe est déjà dans le sous-total, elle ne
     * s'ajoute donc pas une seconde fois. On ne rejoue pas l'ordre des étapes
     * ici — `totaux.test.ts` s'en charge, et le recopier ferait passer ce test
     * à côté de son sujet. Ce qu'on exige, c'est le DÉCALAGE exact.
     */
    expect(serveur.sousTotal).toBe(temoin.sousTotal)
    expect(serveur.timbre).toBe(600)
    expect(serveur.service).toBe(Math.round(temoin.sousTotal * 0.1))
    expect(serveur.total - temoin.total).toBe(serveur.service + 600)

    expect(serveur, 'caisse et serveur doivent tomber au MILLIME').toEqual(
      await calculCaisse(evenements),
    )
  })

  it('un service TAXABLE ajoute sa propre taxe, du même montant des deux côtés', async () => {
    await reglerOptions({ tauxServiceBp: 1000, taxable: true, tauxTaxeId: TVA_19, timbre: 0 })

    const { orderId, evenements } = await vendre([OJJA, COCA])
    const serveur = await projection(orderId)
    const caisse = await calculCaisse(evenements)

    expect(serveur).toEqual(caisse)

    /*
     * Et la taxe du service est bien EN PLUS.
     *
     * Le comparatif est la même vente sans service taxable : sans lui, la
     * taxe serait celle des seules lignes. Un test qui se contenterait de
     * `> 0` passerait aussi si le service n'était pas taxé du tout.
     */
    await reglerOptions({ tauxServiceBp: 1000, taxable: false, tauxTaxeId: null, timbre: 0 })
    const sansTaxeService = await vendre([OJJA, COCA])
    const temoin = await projection(sansTaxeService.orderId)

    expect(temoin.service).toBe(serveur.service)
    expect(serveur.taxe).toBeGreaterThan(temoin.taxe)
  })

  it('« taxable » SANS taux désigné ne taxe rien — et le dit par l’égalité', async () => {
    /*
     * C'est la raison d'être de `service_tax_rate_id` (migration 0036).
     * Cocher « taxable » sans choisir de taux laissait un réglage muet : le
     * domaine ne taxe le service que s'il connaît le taux. Le test fige ce
     * comportement plutôt que de le laisser dépendre d'une lecture du code.
     */
    await reglerOptions({ tauxServiceBp: 1000, taxable: true, tauxTaxeId: null, timbre: 0 })
    const avecCase = await vendre([OJJA])
    const a = await projection(avecCase.orderId)

    await reglerOptions({ tauxServiceBp: 1000, taxable: false, tauxTaxeId: null, timbre: 0 })
    const sansCase = await vendre([OJJA])
    const b = await projection(sansCase.orderId)

    expect(a.taxe).toBe(b.taxe)
    expect(a.total).toBe(b.total)
    expect(a).toEqual(await calculCaisse(avecCase.evenements))
  })

  it('un service posé SUR LA COMMANDE prime — et le serveur l’applique AUSSI', async () => {
    /*
     * ⚑ C'est le défaut que ce fichier a mis au jour.
     *
     * `reconstruireCommande` applique depuis toujours le service porté par la
     * commande (`service.set`) : un serveur retire le service sur une commande
     * à emporter, ou l'ajoute sur une table. Le projecteur LOCAL le faisait ;
     * la reprojection SERVEUR passait `config` tel quel et l'ignorait.
     *
     * La tablette imprimait donc un ticket avec service, le back-office
     * affichait la même vente sans, et rien n'échouait nulle part. Depuis,
     * les deux passent par `configEffective` — une seule copie.
     *
     * L'établissement est ici à 0 % : TOUT le service vient de l'événement.
     * Si le serveur l'ignorait, `serveur.service` vaudrait zéro et cette
     * ligne-ci le dirait.
     */
    await reglerOptions({ tauxServiceBp: 0, taxable: false, tauxTaxeId: null, timbre: 0 })

    const { orderId, evenements } = await vendre([OJJA], {
      service: { tauxBp: 1500, taxable: false },
    })
    const serveur = await projection(orderId)

    expect(
      serveur.service,
      'le service porté par la commande doit survivre à la reprojection serveur',
    ).toBeGreaterThan(0)
    expect(serveur).toEqual(await calculCaisse(evenements))
  })

  it('la commande prime sur l’établissement, dans les DEUX sens', async () => {
    // L'établissement pratique 10 %, la commande n'en veut pas.
    await reglerOptions({ tauxServiceBp: 1000, taxable: false, tauxTaxeId: null, timbre: 0 })

    const { orderId, evenements } = await vendre([OJJA], {
      service: { tauxBp: 0, taxable: false },
    })
    const serveur = await projection(orderId)

    expect(serveur.service, 'le serveur doit RETIRER le service, pas le garder').toBe(0)
    expect(serveur).toEqual(await calculCaisse(evenements))
  })
})
