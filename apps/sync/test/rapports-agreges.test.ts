/**
 * R-1 — les rapports agrégés EN SQL rendent EXACTEMENT les mêmes chiffres.
 *
 * ── Pourquoi ce test existe, et pourquoi il a cette forme ────────────────
 *
 * La migration 0033 déplace les sommes des rapports depuis JavaScript vers
 * PostgreSQL. C'est du CALCUL D'ARGENT : cela ne se valide pas en relisant
 * le SQL, si soigneusement soit-il commenté. On le valide en faisant tourner
 * les DEUX chemins sur les MÊMES ventes et en exigeant l'égalité au millime.
 *
 *   • chemin historique — les lignes remontent, `packages/domain` additionne
 *     (`apps/backoffice/src/serveur/rapports.ts`) ;
 *   • chemin R-1 — `kaissi.rapport_ventes` additionne, et le domaine ne fait
 *     plus que les décisions : arrondi UNIQUE des coûts, marge, part du CA.
 *
 * Le jeu de ventes est délibérément hostile : deux taux de TVA, deux
 * employés, une remise de ligne AVEC motif et une SANS, une remise globale
 * répartie au prorata, une ligne annulée, un coût fractionnaire (celui d'un
 * gramme de fromage, inférieur au millime), deux moyens de paiement, un
 * remboursement, et surtout une vente encaissée à 1 h DU MATIN — celle qui
 * appartient à la soirée de la veille, et qui casse tout découpage naïf sur
 * la date calendaire.
 *
 * ⚑ Un test qui ne ferait passer que des cas simples validerait l'évidence.
 *   Ce sont l'étape 4 (répartition de la remise globale) et l'étape 6
 *   (arrondi de la TVA par taux) qui produisent les écarts de caisse en
 *   production ; c'est donc là qu'il faut mettre des ventes tordues.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { millimes, pointsDeBase, uuidV7 } from '@kaissi/domain'
import { DepotPostgres } from '../src/depot-postgres.js'
import { creerServeur } from '../src/serveur.js'
/*
 * Les fonctions PURES du back-office, importées telles quelles.
 *
 * Les recopier ici aurait produit une troisième implémentation, et le test
 * aurait comparé deux copies plutôt que le code livré. Ces deux modules
 * n'ont aucune dépendance à Next ni à Supabase — c'est précisément ce qui
 * rend l'import possible, et c'est une propriété qu'il vaut mieux garder.
 */
import {
  calculerIndicateurs,
  ventilerParCategorie,
  ventilerParEmploye,
  ventilerParJournee,
  ventilerParPaiement,
  ventilerParProduit,
  ventilerParReduction,
  type CommandeVendue,
  type LigneVendue,
} from '../../backoffice/src/serveur/rapports.js'
import {
  creerAppareil,
  ev,
  nettoyer,
  DEMO_ORG,
  DEMO_RESTO,
  EMPLOYE_DEMO,
  EMPLOYE_2,
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

const CARTE = '01930000-0000-7000-8000-000000000501'

/** Deux produits de catégories différentes, pour que la ventilation compte. */
const PLAT = '01930000-0000-7000-8000-000000000204' // Ojja merguez — « Plats »
const BOISSON = '01930000-0000-7000-8000-000000000221' // Coca — « Boissons »

const FUSEAU = 'Africa/Tunis'
const BASCULE = '04:00:00'

/** Bornes larges : c'est la fonction qui doit filtrer, pas le test. */
const DEBUT = '2026-03-01T00:00:00.000Z'
const FIN = '2026-03-31T00:00:00.000Z'

interface Article {
  produitId: string
  designation: string
  prixMillimes: number
  quantite: number
  tauxTaxeId: string
  /** Remise de LIGNE, en points de base, avec son motif éventuel. */
  remiseLigneBp?: number
  motifLigne?: string
  annulee?: boolean
}

/**
 * Pousse une vente complète par le VRAI chemin : `/sync/push`, puis la
 * projection du service. Écrire les lignes directement en SQL aurait testé
 * ma compréhension des colonnes, pas ce que la caisse produit.
 */
async function vendre(
  appareil: AppareilTest,
  options: {
    closeA: string
    closePar: string
    articles: Article[]
    remiseGlobaleBp?: number
    motifGlobal?: string
    mode?: 'cash' | 'card'
  },
): Promise<void> {
  const orderId = uuidV7()
  const evenements: ReturnType<typeof ev>[] = [
    ev(appareil, orderId, 'order.opened', {
      type: 'takeaway',
      ouvertePar: EMPLOYE_DEMO,
      numeroTicket: `${appareil.prefixe}-${orderId.slice(-6)}`,
    }),
  ]

  for (const article of options.articles) {
    const ligneId = uuidV7()
    evenements.push(
      ev(appareil, orderId, 'line.added', {
        ligneId,
        produitId: article.produitId,
        designation: article.designation,
        quantite: article.quantite,
        prixBaseMillimes: millimes(article.prixMillimes),
        modificateursMillimes: millimes(0),
        tauxTaxeId: article.tauxTaxeId,
      }),
    )
    if (article.remiseLigneBp !== undefined) {
      evenements.push(
        ev(appareil, orderId, 'discount.applied', {
          ligneId,
          remise: {
            type: 'pourcentage',
            valeurBp: pointsDeBase(article.remiseLigneBp),
            ...(article.motifLigne ? { motif: article.motifLigne } : {}),
          },
        }),
      )
    }
    // Une ligne ANNULÉE : elle reste dans le journal, disparaît des totaux.
    if (article.annulee) {
      evenements.push(ev(appareil, orderId, 'line.voided', { ligneId, motif: 'erreur de saisie' }))
    }
  }

  if (options.remiseGlobaleBp !== undefined) {
    evenements.push(
      ev(appareil, orderId, 'discount.applied', {
        remise: {
          type: 'pourcentage',
          valeurBp: pointsDeBase(options.remiseGlobaleBp),
          ...(options.motifGlobal ? { motif: options.motifGlobal } : {}),
        },
      }),
    )
  }

  /*
   * Le paiement est horodaté COMME la clôture (à la minute près).
   *
   * `payments.created_at` vient du `clientTs` de son événement, et les
   * rapports filtrent les paiements sur cette date-là. Laisser l'horodatage
   * par défaut de l'aide les placerait hors de la période, et le test
   * comparerait deux ventilations vides — c'est-à-dire rien.
   */
  const paiement = ev(appareil, orderId, 'payment.recorded', {
    paiementId: uuidV7(),
    methodeId: options.mode === 'card' ? CARTE : ESPECES,
    mode: options.mode ?? 'cash',
    montantMillimes: millimes(1_000),
    recuMillimes: millimes(1_000),
    renduMillimes: millimes(0),
  })
  evenements.push({ ...paiement, clientTs: options.closeA })

  // La CLÔTURE porte l'instant : `closed_at` vient du `clientTs` de cet
  // événement, et c'est lui qui décide de la journée commerciale.
  const cloture = ev(appareil, orderId, 'order.closed', {
    totalMillimes: millimes(0),
    closePar: options.closePar,
  })
  evenements.push({ ...cloture, clientTs: options.closeA })

  const reponse = await app.request('http://test/sync/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${appareil.jetonClair}`,
    },
    body: JSON.stringify({ protocolVersion: 1, batchId: uuidV7(), evenements }),
  })
  expect(reponse.status).toBe(200)
}

/* ─────────────────────────────────────────────────────────────────────────
 * Le chemin HISTORIQUE, reconstitué à l'identique de `chargerVentes`.
 * ───────────────────────────────────────────────────────────────────────── */

interface CheminLigneAligne {
  lignes: LigneVendue[]
  commandes: CommandeVendue[]
  paiements: { type: string; montantMillimes: number }[]
  remboursements: { montantMillimes: number }[]
  nomEmploye: (id: string | null) => string
}

async function chargerLigneAligne(): Promise<CheminLigneAligne> {
  const commandesRes = await client.query<{
    id: string
    total_millimes: string
    closed_at: string
    opened_by: string | null
    closed_by: string | null
    discount_id: string | null
    discount_label: string | null
  }>(
    `select id, total_millimes, closed_at, opened_by, closed_by, discount_id, discount_label
       from kaissi.orders
      where restaurant_id = $1 and status = 'close'
        and closed_at >= $2 and closed_at < $3
      order by closed_at desc`,
    [DEMO_RESTO, DEBUT, FIN],
  )

  const lignesRes = await client.query<{
    order_id: string
    product_id: string | null
    designation: string
    qty: number
    line_gross_millimes: string
    line_discount_millimes: string
    global_discount_share_millimes: string
    line_total_millimes: string
    line_tax_millimes: string
    discount_id: string | null
    discount_label: string | null
    position: number
    cost_per_unit: string | null
    category_id: string | null
    category_name: string | null
  }>(
    `select i.order_id, i.product_id, i.designation, i.qty,
            i.line_gross_millimes, i.line_discount_millimes,
            i.global_discount_share_millimes, i.line_total_millimes,
            i.line_tax_millimes, i.discount_id, i.discount_label, i.position,
            p.cost_per_unit, p.category_id, c.name as category_name
       from kaissi.order_items i
       join kaissi.orders o on o.id = i.order_id
       left join kaissi.products p on p.id = i.product_id
       left join kaissi.categories c on c.id = p.category_id
      where o.restaurant_id = $1 and o.status = 'close'
        and o.closed_at >= $2 and o.closed_at < $3
        and i.voided_at is null
      order by o.closed_at desc, i.order_id, i.position`,
    [DEMO_RESTO, DEBUT, FIN],
  )

  const retenues = new Set(commandesRes.rows.map((c) => c.id))

  const paiementsRes = await client.query<{ type: string; amount_millimes: string; order_id: string }>(
    `select type, amount_millimes, order_id from kaissi.payments
      where restaurant_id = $1 and voided_at is null
        and created_at >= $2 and created_at < $3`,
    [DEMO_RESTO, DEBUT, FIN],
  )
  const remboursementsRes = await client.query<{ amount_millimes: string }>(
    `select amount_millimes from kaissi.refunds
      where restaurant_id = $1 and created_at >= $2 and created_at < $3`,
    [DEMO_RESTO, DEBUT, FIN],
  )
  const employesRes = await client.query<{ id: string; full_name: string }>(
    'select id, full_name from kaissi.users',
  )
  const noms = new Map(employesRes.rows.map((u) => [u.id, u.full_name]))

  return {
    commandes: commandesRes.rows.map((c) => ({
      id: c.id,
      totalMillimes: Number(c.total_millimes),
      vendeurId: c.closed_by ?? c.opened_by ?? null,
      closeA: c.closed_at,
      reductionId: c.discount_id,
      reductionNom: c.discount_label,
    })),
    lignes: lignesRes.rows.map((l) => ({
      orderId: l.order_id,
      produitId: l.product_id,
      designation: l.designation,
      quantite: l.qty,
      brutMillimes: Number(l.line_gross_millimes),
      remiseLigneMillimes: Number(l.line_discount_millimes),
      remiseGlobaleMillimes: Number(l.global_discount_share_millimes),
      netMillimes: Number(l.line_total_millimes),
      taxeMillimes: Number(l.line_tax_millimes),
      coutUnitaire: l.cost_per_unit === null ? null : Number(l.cost_per_unit),
      categorieId: l.category_id,
      categorieNom: l.category_name,
      reductionId: l.discount_id,
      reductionNom: l.discount_label,
    })),
    paiements: paiementsRes.rows
      .filter((p) => retenues.has(p.order_id))
      .map((p) => ({ type: p.type, montantMillimes: Number(p.amount_millimes) })),
    remboursements: remboursementsRes.rows.map((r) => ({
      montantMillimes: Number(r.amount_millimes),
    })),
    nomEmploye: (id) => (id && noms.get(id)) || 'Inconnu',
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Le chemin R-1.
 * ───────────────────────────────────────────────────────────────────────── */

interface SommeSql {
  cle: string
  libelle?: string
  quantite: number
  net_millimes: number
  brut_millimes: number
  remises_millimes: number
  taxes_millimes: number
  cout_exact: number
  tickets?: number
}

interface AgregatsSql {
  nombreTickets: number
  indicateurs: {
    ca_net_millimes: number
    ca_brut_millimes: number
    remises_millimes: number
    taxes_millimes: number
    cout_exact: number
    articles_vendus: number
    lignes_sans_cout: number
  }
  remboursementsMillimes: number
  parProduit: SommeSql[]
  parCategorie: SommeSql[]
  parEmploye: SommeSql[]
  parReduction: { cle: string; libelle: string; montant_millimes: number; ventes: number }[]
  parPaiement: { type: string; montant_millimes: number; nombre: number }[]
  parJournee: { journee: string; total_millimes: number; tickets: number; net_millimes: number }[]
}

async function agreger(filtres?: {
  employe?: string
  heureDebut?: number
  heureFin?: number
}): Promise<AgregatsSql> {
  const { rows } = await client.query<{ r: AgregatsSql }>(
    'select kaissi.rapport_ventes($1,$2,$3,$4,$5,$6,$7,$8) as r',
    [
      DEMO_RESTO,
      DEBUT,
      FIN,
      FUSEAU,
      BASCULE,
      filtres?.employe ?? null,
      filtres?.heureDebut ?? 0,
      filtres?.heureFin ?? 23,
    ],
  )
  return rows[0]!.r
}

/** Comparaison par CLÉ et non par position : le tri n'est pas l'objet du test. */
function parCle<T extends { cle: string }>(liste: readonly T[]): Map<string, T> {
  return new Map(liste.map((x) => [x.cle, x]))
}

beforeAll(async () => {
  await nettoyer()

  /*
   * Un coût FRACTIONNAIRE sur un seul produit.
   *
   * 1,234567 millime par unité : sous le millime, donc précisément le cas
   * où un arrondi par ligne dériverait. Le domaine n'arrondit qu'au total,
   * et le SQL ne doit pas arrondir du tout — c'est ce que compare ce test.
   */
  await client.query(
    'update kaissi.products set cost_per_unit = 1.234567 where id = $1',
    [PLAT],
  )
  // Et l'autre SANS coût : `lignesSansCout` doit compter, dans les deux
  // chemins, sinon la marge s'afficherait à 100 % en paraissant juste.
  await client.query('update kaissi.products set cost_per_unit = null where id = $1', [BOISSON])

  const p1 = await creerAppareil('R1')

  // 1 — vente simple, espèces, employé 1, 14 h locale.
  await vendre(p1, {
    closeA: '2026-03-10T13:00:00.000Z',
    closePar: EMPLOYE_DEMO,
    articles: [
      { produitId: PLAT, designation: 'Ojja merguez', prixMillimes: 24_500, quantite: 3, tauxTaxeId: TVA_19 },
    ],
  })

  // 2 — DEUX taux de TVA, une remise de ligne AVEC motif, carte, employé 2.
  await vendre(p1, {
    closeA: '2026-03-10T19:30:00.000Z',
    closePar: EMPLOYE_2,
    mode: 'card',
    articles: [
      {
        produitId: PLAT, designation: 'Ojja merguez', prixMillimes: 24_500, quantite: 2,
        tauxTaxeId: TVA_19, remiseLigneBp: 1_000, motifLigne: 'Happy hour',
      },
      { produitId: BOISSON, designation: 'Coca-Cola 33cl', prixMillimes: 3_500, quantite: 4, tauxTaxeId: TVA_07 },
    ],
  })

  // 3 — remise GLOBALE, répartie au prorata sur deux taux. C'est l'étape 4
  //     de `totaux.ts`, la première source d'écart en production.
  await vendre(p1, {
    closeA: '2026-03-11T18:00:00.000Z',
    closePar: EMPLOYE_DEMO,
    remiseGlobaleBp: 1_500,
    motifGlobal: 'Geste commercial',
    articles: [
      { produitId: PLAT, designation: 'Ojja merguez', prixMillimes: 24_500, quantite: 1, tauxTaxeId: TVA_19 },
      { produitId: BOISSON, designation: 'Coca-Cola 33cl', prixMillimes: 3_500, quantite: 3, tauxTaxeId: TVA_07 },
    ],
  })

  // 4 — une remise de ligne SANS motif : elle doit se ranger sous « Sans
  //     motif », visible, plutôt que de disparaître dans un total muet.
  await vendre(p1, {
    closeA: '2026-03-11T20:15:00.000Z',
    closePar: EMPLOYE_2,
    articles: [
      { produitId: BOISSON, designation: 'Coca-Cola 33cl', prixMillimes: 3_500, quantite: 2, tauxTaxeId: TVA_07, remiseLigneBp: 2_000 },
    ],
  })

  // 5 — une LIGNE ANNULÉE dans une vente encaissée : le client ne l'a pas
  //     payée, elle ne doit être ni du chiffre ni du coût, des deux côtés.
  await vendre(p1, {
    closeA: '2026-03-12T12:00:00.000Z',
    closePar: EMPLOYE_DEMO,
    articles: [
      { produitId: PLAT, designation: 'Ojja merguez', prixMillimes: 24_500, quantite: 1, tauxTaxeId: TVA_19 },
      { produitId: BOISSON, designation: 'Coca-Cola 33cl', prixMillimes: 3_500, quantite: 5, tauxTaxeId: TVA_07, annulee: true },
    ],
  })

  /*
   * 6 — LA vente qui casse tout découpage naïf : encaissée à 1 h du matin
   *     locale le 13 mars, elle appartient à la SOIRÉE DU 12. Un `::date`
   *     sur `closed_at` la mettrait au 13 — et le samedi soir paraîtrait
   *     moitié moins bon qu'il ne l'a été.
   *
   *     00:15 UTC = 01:15 à Tunis (UTC+1 en mars).
   */
  await vendre(p1, {
    closeA: '2026-03-13T00:15:00.000Z',
    closePar: EMPLOYE_2,
    articles: [
      { produitId: PLAT, designation: 'Ojja merguez', prixMillimes: 24_500, quantite: 2, tauxTaxeId: TVA_19 },
    ],
  })

  // Un remboursement, qui n'appartient à aucune ventilation mais compte
  // dans les indicateurs de tête.
  await client.query(
    `insert into kaissi.refunds (id, organization_id, restaurant_id, payment_id, amount_millimes, reason, created_at)
     select $1,$2,$3, p.id, 5000, 'test', '2026-03-12T12:30:00.000Z'
       from kaissi.payments p where p.restaurant_id = $3 limit 1`,
    [uuidV7(), DEMO_ORG, DEMO_RESTO],
  )
})

afterAll(async () => {
  await client.query('delete from kaissi.refunds where restaurant_id = $1', [DEMO_RESTO])
  await client.query('update kaissi.products set cost_per_unit = null where id in ($1,$2)', [
    PLAT,
    BOISSON,
  ])
  await nettoyer()
  await depot.fermer()
  await client.end()
})

describe('les deux chemins rendent les mêmes chiffres', () => {
  it('indicateurs de tête : au millime, coûts fractionnaires compris', async () => {
    const { lignes, commandes, remboursements } = await chargerLigneAligne()
    const attendu = calculerIndicateurs(lignes, commandes, remboursements)
    const obtenu = await agreger()

    expect(obtenu.indicateurs.ca_net_millimes).toBe(attendu.caNetMillimes)
    expect(obtenu.indicateurs.ca_brut_millimes).toBe(attendu.caBrutMillimes)
    expect(obtenu.indicateurs.remises_millimes).toBe(attendu.remisesMillimes)
    expect(obtenu.remboursementsMillimes).toBe(attendu.remboursementsMillimes)
    expect(obtenu.nombreTickets).toBe(attendu.nombreTickets)
    expect(obtenu.indicateurs.articles_vendus).toBe(attendu.articlesVendus)
    expect(obtenu.indicateurs.lignes_sans_cout).toBe(attendu.lignesSansCout)

    /*
     * Le coût sort de SQL NON arrondi, exprès : c'est `totaliserCouts()` du
     * domaine qui arrondit, une fois. On refait donc ici le geste que fait
     * `agregats.ts` — et le résultat doit tomber sur le même millime.
     */
    expect(Math.round(Number(obtenu.indicateurs.cout_exact))).toBe(attendu.coutMillimes)

    // Et le jeu de ventes est bien non trivial : un test qui compare deux
    // zéros passerait sans rien prouver.
    expect(attendu.caNetMillimes).toBeGreaterThan(0)
    expect(attendu.coutMillimes).toBeGreaterThan(0)
    expect(attendu.lignesSansCout).toBeGreaterThan(0)
  })

  it('par article : mêmes quantités, mêmes CA, même désignation', async () => {
    const { lignes } = await chargerLigneAligne()
    const attendu = parCle(ventilerParProduit(lignes))
    const obtenu = parCle((await agreger()).parProduit)

    expect(obtenu.size).toBe(attendu.size)
    expect(obtenu.size).toBeGreaterThan(1)
    for (const [cle, a] of attendu) {
      const o = obtenu.get(cle)
      expect(o, `article ${cle} absent du chemin SQL`).toBeDefined()
      expect(o!.libelle).toBe(a.libelle)
      expect(o!.quantite).toBe(a.quantite)
      expect(o!.net_millimes).toBe(a.marge.caMillimes)
      expect(o!.brut_millimes).toBe(a.brutMillimes)
      expect(o!.remises_millimes).toBe(a.remisesMillimes)
      expect(o!.taxes_millimes).toBe(a.taxesMillimes)
      expect(Math.round(Number(o!.cout_exact))).toBe(a.marge.coutMillimes)
    }
  })

  it('par catégorie', async () => {
    const { lignes } = await chargerLigneAligne()
    const attendu = parCle(ventilerParCategorie(lignes))
    const obtenu = parCle((await agreger()).parCategorie)

    expect(obtenu.size).toBe(attendu.size)
    for (const [cle, a] of attendu) {
      const o = obtenu.get(cle)!
      expect(o.libelle).toBe(a.libelle)
      expect(o.net_millimes).toBe(a.marge.caMillimes)
      expect(o.quantite).toBe(a.quantite)
    }
  })

  it('par employé, et le compte de TICKETS que SQL ajoute', async () => {
    const { lignes, commandes, nomEmploye } = await chargerLigneAligne()
    const attendu = parCle(ventilerParEmploye(lignes, commandes, nomEmploye))
    const obtenu = parCle((await agreger()).parEmploye)

    expect(obtenu.size).toBe(attendu.size)
    // Deux employés distincts : sans cela, « la vente s'attribue à qui l'a
    // encaissée » ne serait pas éprouvé.
    expect(obtenu.size).toBe(2)
    for (const [cle, a] of attendu) {
      const o = obtenu.get(cle)!
      expect(o.net_millimes).toBe(a.marge.caMillimes)
      expect(o.quantite).toBe(a.quantite)
    }

    const ticketsSql = [...obtenu.values()].reduce((t, e) => t + (e.tickets ?? 0), 0)
    expect(ticketsSql).toBe(commandes.length)
  })

  it('par réduction : motifs nommés, « Sans motif », et remise globale', async () => {
    const { lignes, commandes } = await chargerLigneAligne()
    const attendu = new Map(ventilerParReduction(lignes, commandes).map((r) => [r.cle, r]))
    const obtenu = new Map((await agreger()).parReduction.map((r) => [r.cle, r]))

    expect(obtenu.size).toBe(attendu.size)
    // Les trois cas voulus : deux motifs figés + « sans motif ».
    expect(attendu.size).toBe(3)
    for (const [cle, a] of attendu) {
      const o = obtenu.get(cle)
      expect(o, `réduction ${cle} absente du chemin SQL`).toBeDefined()
      expect(o!.libelle).toBe(a.libelle)
      expect(o!.montant_millimes).toBe(a.montantMillimes)
      expect(o!.ventes).toBe(a.ventes)
    }
  })

  it('par moyen de paiement', async () => {
    const { paiements } = await chargerLigneAligne()
    const attendu = new Map(ventilerParPaiement(paiements).map((p) => [p.type, p]))
    const obtenu = new Map((await agreger()).parPaiement.map((p) => [p.type, p]))

    expect(obtenu.size).toBe(attendu.size)
    expect(obtenu.size).toBe(2) // espèces ET carte
    for (const [type, a] of attendu) {
      expect(obtenu.get(type)!.montant_millimes).toBe(a.montantMillimes)
      expect(obtenu.get(type)!.nombre).toBe(a.nombre)
    }
  })
})

describe('la journée commerciale — la règle la plus facile à réécrire de travers', () => {
  it('découpe exactement comme `journeeCourante`, 1 h du matin comprise', async () => {
    const { commandes } = await chargerLigneAligne()
    const attendu = new Map(
      ventilerParJournee(commandes, FUSEAU, BASCULE, { du: '2026-03-10', au: '2026-03-13' })
        .filter((j) => j.tickets > 0)
        .map((j) => [j.journee, j]),
    )
    const obtenu = new Map((await agreger()).parJournee.map((j) => [j.journee, j]))

    expect(obtenu.size).toBe(attendu.size)
    for (const [journee, a] of attendu) {
      const o = obtenu.get(journee)
      expect(o, `journée ${journee} absente du chemin SQL`).toBeDefined()
      expect(o!.total_millimes).toBe(a.caMillimes)
      expect(o!.tickets).toBe(a.tickets)
    }
  })

  it("la vente d'1 h du matin appartient à la VEILLE, pas au lendemain", async () => {
    const obtenu = new Map((await agreger()).parJournee.map((j) => [j.journee, j]))
    // Encaissée le 13 mars à 01:15 heure de Tunis : elle compte au 12.
    expect(obtenu.has('2026-03-13')).toBe(false)
    expect(obtenu.get('2026-03-12')!.tickets).toBe(2)
  })
})

describe('les filtres', () => {
  it("le filtre par employé rend la même chose des deux côtés", async () => {
    const { lignes, commandes, remboursements } = await chargerLigneAligne()
    const gardees = commandes.filter((c) => c.vendeurId === EMPLOYE_2)
    const ids = new Set(gardees.map((c) => c.id))
    const attendu = calculerIndicateurs(
      lignes.filter((l) => ids.has(l.orderId)),
      gardees,
      remboursements,
    )
    const obtenu = await agreger({ employe: EMPLOYE_2 })

    expect(obtenu.indicateurs.ca_net_millimes).toBe(attendu.caNetMillimes)
    expect(obtenu.nombreTickets).toBe(gardees.length)
    // Un filtre qui ne filtre rien passerait ce test sans le vouloir.
    expect(gardees.length).toBeLessThan(commandes.length)
  })

  it("le filtre horaire se lit en heure LOCALE, jamais en UTC", async () => {
    /*
     * Ventes à 13:00, 19:30 et 00:15 UTC — soit 14 h, 20 h 30 et 1 h 15 à
     * Tunis. Une tranche « 20–23 » ne doit retenir que celles de 20 h 30 ; en
     * lisant l'heure UTC, on retiendrait la vente de 19:30 comme étant à
     * 19 h et on la manquerait.
     */
    const obtenu = await agreger({ heureDebut: 20, heureFin: 23 })
    expect(obtenu.nombreTickets).toBe(2) // celle de 19:30 UTC et celle de 20:15 UTC
    const tout = await agreger()
    expect(obtenu.indicateurs.ca_net_millimes).toBeLessThan(tout.indicateurs.ca_net_millimes)
  })
})

describe('ce que le chemin agrégé ne doit PAS faire', () => {
  it("n'arrondit aucun coût — c'est le domaine qui décide", async () => {
    const obtenu = await agreger()
    /*
     * 1,234567 millime l'unité × un nombre entier d'unités : le total est
     * fractionnaire. S'il remontait déjà entier, c'est que SQL aurait
     * arrondi — donc décidé — et la règle 7 serait enfreinte sans que rien
     * ne le signale.
     */
    const cout = Number(obtenu.indicateurs.cout_exact)
    expect(Number.isInteger(cout)).toBe(false)
  })

  /*
   * ── Le piège qui a coûté le plus cher à trouver ────────────────────────
   *
   * La fonction a d'abord été écrite en `language sql`. Elle était juste, et
   * elle mettait **27 secondes** sur 92 jours de ventes — là où la même
   * requête, écrite à la main avec des dates littérales, en mettait 175 ms.
   *
   * La cause : PostgreSQL ne connaît pas les bornes de la période quand il
   * planifie le corps d'une fonction. Il estime UNE commande, choisit des
   * boucles imbriquées, et rebalaye un CTE de 18 000 lignes une fois par
   * commande. `plan_cache_mode = 'force_custom_plan'` le lui interdit — mais
   * ce réglage n'a AUCUN effet sur une fonction `language sql` : son corps
   * ne passe pas par le cache de plans qui l'honore. D'où `plpgsql`.
   *
   * Ces deux propriétés ne se voient pas dans un test de résultat : la
   * fonction rend les mêmes chiffres, en cent fois plus de temps. Un test de
   * durée serait instable en intégration continue ; on fige donc la
   * DÉCLARATION, qui est ce qu'on risque de « nettoyer » un jour en trouvant
   * le `begin … end` inutile.
   */
  it('reste en `plpgsql` et en `force_custom_plan` — sinon elle est 70× plus lente', async () => {
    const { rows } = await client.query<{ langue: string; reglages: string[] | null }>(
      `select l.lanname as langue, p.proconfig as reglages
         from pg_proc p
         join pg_language l on l.oid = p.prolang
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kaissi' and p.proname = 'rapport_ventes'`,
    )
    expect(rows[0]?.langue).toBe('plpgsql')
    expect(rows[0]?.reglages ?? []).toContain('plan_cache_mode=force_custom_plan')
  })

  it("s'exécute avec les droits de l'APPELANT — jamais en `security definer`", async () => {
    /*
     * `appliquer_rupture_auto` est en `definer` parce qu'elle doit écrire
     * au-delà des droits de l'appelant. Celle-ci LIT des chiffres d'affaires :
     * en `definer`, elle rendrait ceux d'un autre restaurant à qui saurait
     * deviner un UUID. Le `p_restaurant` est un filtre, pas un contrôle
     * d'accès — c'est RLS qui décide, et RLS ne s'applique que si la
     * fonction reste en `invoker`.
     */
    const { rows } = await client.query<{ definer: boolean }>(
      `select p.prosecdef as definer from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kaissi' and p.proname = 'rapport_ventes'`,
    )
    expect(rows[0]?.definer).toBe(false)
  })

  it('ne rend rien pour un autre restaurant', async () => {
    const { rows } = await client.query<{ r: AgregatsSql }>(
      "select kaissi.rapport_ventes($1,$2,$3) as r",
      ['01930000-0000-7000-8000-0000000009ff', DEBUT, FIN],
    )
    expect(rows[0]!.r.nombreTickets).toBe(0)
    expect(rows[0]!.r.parProduit).toEqual([])
  })
})
