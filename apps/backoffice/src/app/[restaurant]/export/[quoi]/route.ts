/**
 * Exports CSV du back-office — une seule route, un seul garde d'accès.
 *
 * ── Pourquoi une route unique plutôt qu'un fichier par écran ──────────────
 *
 * Chaque export porte les mêmes obligations : vérifier le rôle, respecter la
 * période demandée, passer par RLS, et neutraliser les cellules. Les répartir
 * dans six fichiers, c'est six occasions d'en oublier une — et un export qui
 * oublie le garde de rôle rend à un cuisinier le chiffre d'affaires qu'on
 * vient de lui retirer de l'écran.
 *
 * Les données ne sont JAMAIS rechargées autrement que par les mêmes
 * fonctions que les pages (`chargerVentes`, `ventilerParProduit`…). Un export
 * qui recalculerait de son côté finirait par afficher un total différent de
 * l'écran d'à côté, et c'est ce total-là que le client apporterait à son
 * comptable.
 */

import { notFound } from 'next/navigation'
import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../../serveur/session.js'
import { supabaseServeur } from '../../../../serveur/supabase.js'
import { chargerFiche, chargerVentes, resoudrePeriode } from '../../../../serveur/ventes.js'
import {
  calculerIndicateurs,
  ventilerParCategorie,
  ventilerParEmploye,
  ventilerParPaiement,
  ventilerParProduit,
} from '../../../../serveur/rapports.js'
import { nomFichier, reponseCsv, versCsv, type Cellule } from '../../../../serveur/export-csv.js'
import { reconstruireTicket } from '../../../../serveur/ticket.js'

/** Un export est une photo d'un instant : jamais de rendu mis en cache. */
export const dynamic = 'force-dynamic'

const SUJETS = [
  'ventes',
  'articles',
  'categories',
  'employes',
  'paiements',
  'tickets',
  'stock',
  'mouvements',
  /** UN ticket, tel qu'il s'imprime — pas un tableau. */
  'ticket',
  'periodes',
] as const
type Sujet = (typeof SUJETS)[number]

function estSujet(valeur: string): valeur is Sujet {
  return (SUJETS as readonly string[]).includes(valeur)
}

/** Montant en TEXTE français, comme à l'écran : « 24,500 TND ». */
const tnd = (m: number) => formaterTND(millimes(Math.round(m)))

/**
 * Le même montant, en nombre BRUT calculable dans le tableur.
 *
 * Les deux colonnes coexistent volontairement : la première se lit, la
 * seconde s'additionne. N'en donner qu'une oblige soit à retaper les
 * chiffres, soit à lire « 24500 » partout.
 */
const brut = (m: number) => (Math.round(m) / 1000).toFixed(3).replace('.', ',')

const horodatage = (iso: string | null, timezone: string) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' })
    : ''

export async function GET(
  requete: Request,
  { params }: { params: Promise<{ restaurant: string; quoi: string }> },
) {
  const { restaurant, quoi } = await params
  if (!estSujet(quoi)) notFound()

  const { etablissement } = await etablissementObligatoire(restaurant)
  // MÊME garde que les écrans. Un export sans garde rendrait à un rôle de
  // préparation exactement ce qu'on vient de lui retirer de l'interface.
  ecranReserve(etablissement, 'gestion')

  const url = new URL(requete.url)
  const fiche = await chargerFiche(restaurant)
  const periode = resoudrePeriode(
    fiche,
    url.searchParams.get('du') ?? undefined,
    url.searchParams.get('au') ?? undefined,
  )

  /*
   * UN ticket : ni période, ni CSV.
   *
   * C'est un document, pas un tableau — un tableur n'a rien à en faire, et
   * le découper en colonnes lui ferait perdre exactement ce qui en fait une
   * pièce : sa mise en page. On rend donc le texte tel qu'il s'imprime.
   */
  if (quoi === 'ticket') {
    const commande = url.searchParams.get('commande')
    if (!commande) return new Response('Paramètre « commande » absent.', { status: 400 })
    const rendu = await reconstruireTicket(restaurant, commande)
    if ('erreur' in rendu) return new Response(rendu.erreur, { status: 404 })
    return new Response(rendu.apercu, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${nomFichier(
          'ticket',
          etablissement.nom,
          rendu.ticket.numeroTicket,
        ).replace(/\.csv$/, '.txt')}"`,
        'cache-control': 'no-store',
      },
    })
  }

  // Le stock ne dépend pas d'une période : c'est un état, pas un flux.
  if (quoi === 'stock' || quoi === 'mouvements') {
    return quoi === 'stock'
      ? exporterStock(restaurant, etablissement.nom)
      : exporterMouvements(restaurant, etablissement.nom, fiche.timezone)
  }

  const ventes = await chargerVentes(restaurant, periode)
  if (ventes.erreur) {
    return new Response(`Lecture impossible : ${ventes.erreur}`, { status: 502 })
  }

  const suffixe = `${periode.du}_${periode.au}`
  const nom = (prefixe: string) => nomFichier(prefixe, etablissement.nom, suffixe)

  switch (quoi) {
    case 'ventes': {
      const i = calculerIndicateurs(ventes.lignes, ventes.commandes, ventes.remboursements)
      return reponseCsv(
        versCsv(
          ['Indicateur', 'Valeur', 'Valeur brute (TND)'],
          [
            ['Période', `${periode.du} → ${periode.au}`, null],
            ['Tickets encaissés', String(i.nombreTickets), null],
            ['Articles vendus', String(i.articlesVendus), null],
            ['CA net (après remises)', tnd(i.caNetMillimes), brut(i.caNetMillimes)],
            ['CA brut (avant remises)', tnd(i.caBrutMillimes), brut(i.caBrutMillimes)],
            ['Remises accordées', tnd(i.remisesMillimes), brut(i.remisesMillimes)],
            ['Remboursements', tnd(i.remboursementsMillimes), brut(i.remboursementsMillimes)],
            ["Coût d'achat", tnd(i.coutMillimes), brut(i.coutMillimes)],
            ['Marge', tnd(i.marge.margeMillimes), brut(i.marge.margeMillimes)],
            [
              'Marge %',
              i.marge.margeBp === null ? 'non calculable' : `${formaterPourcentage(i.marge.margeBp)} %`,
              null,
            ],
            [
              'Panier moyen',
              i.panierMoyenMillimes === null ? '' : tnd(i.panierMoyenMillimes),
              i.panierMoyenMillimes === null ? null : brut(i.panierMoyenMillimes),
            ],
            /*
             * Le nombre de lignes SANS coût saisi part avec le reste.
             *
             * Sans lui, la marge de la ligne du dessus paraît exacte alors
             * qu'elle est surestimée d'autant. C'est précisément le chiffre
             * qu'un gérant emmène chez son comptable : il doit savoir sur
             * quoi il repose.
             */
            ['Lignes sans coût saisi (marge surestimée d’autant)', String(i.lignesSansCout), null],
          ],
        ),
        nom('ventes'),
      )
    }

    case 'articles': {
      // LE rapport que réclame un restaurateur : ce qui se vend, combien, et
      // ce que ça rapporte. Trié par chiffre d'affaires décroissant, parce
      // que c'est dans cet ordre qu'on le lit.
      const lignes: Cellule[][] = ventilerParProduit(ventes.lignes).map((v) => [
        v.libelle,
        v.quantite,
        tnd(v.marge.caMillimes),
        brut(v.marge.caMillimes),
        tnd(v.marge.margeMillimes),
        v.marge.margeBp === null ? 'non calculable' : `${formaterPourcentage(v.marge.margeBp)} %`,
        `${formaterPourcentage(v.part)} %`,
      ])
      return reponseCsv(
        versCsv(
          [
            'Article',
            'Quantité',
            'CA après remises',
            'CA (TND)',
            'Marge',
            'Marge %',
            'Part du CA',
          ],
          lignes,
        ),
        nom('ventes-par-article'),
      )
    }

    case 'categories':
      return reponseCsv(
        versCsv(
          ['Catégorie', 'Quantité', 'CA après remises', 'CA (TND)', 'Part du CA'],
          ventilerParCategorie(ventes.lignes).map((v) => [
            v.libelle,
            v.quantite,
            tnd(v.marge.caMillimes),
            brut(v.marge.caMillimes),
            `${formaterPourcentage(v.part)} %`,
          ]),
        ),
        nom('ventes-par-categorie'),
      )

    case 'employes':
      return reponseCsv(
        versCsv(
          ['Employé', 'Articles', 'CA après remises', 'CA (TND)', 'Part du CA'],
          ventilerParEmploye(ventes.lignes, ventes.commandes, ventes.nomEmploye).map((v) => [
            v.libelle,
            v.quantite,
            tnd(v.marge.caMillimes),
            brut(v.marge.caMillimes),
            `${formaterPourcentage(v.part)} %`,
          ]),
        ),
        nom('ventes-par-employe'),
      )

    case 'paiements':
      return reponseCsv(
        versCsv(
          ['Moyen de paiement', 'Opérations', 'Encaissé', 'Encaissé (TND)'],
          ventilerParPaiement(ventes.paiements).map((v) => [
            v.libelle,
            v.nombre,
            tnd(v.montantMillimes),
            brut(v.montantMillimes),
          ]),
        ),
        nom('paiements'),
      )

    case 'periodes': {
      const supabase = await supabaseServeur()
      const { data } = await supabase
        .from('shifts')
        .select(
          'id, opened_at, closed_at, opening_float_millimes, counted_millimes, expected_millimes, variance_millimes, closing_note, users!shifts_user_id_fkey(full_name), fermeur:users!shifts_closed_by_fkey(full_name)',
        )
        .eq('restaurant_id', restaurant)
        .gte('opened_at', periode.bornes.debut.toISOString())
        .lt('opened_at', periode.bornes.fin.toISOString())
        .order('opened_at', { ascending: false })

      const nom = (v: unknown) => (v as { full_name: string } | null)?.full_name ?? ''
      return reponseCsv(
        versCsv(
          [
            'Ouverte par',
            'Ouverture',
            'Fermée par',
            'Clôture',
            'Fond',
            'Attendu',
            'Compté',
            'Écart',
            'Écart (TND)',
            'Note',
          ],
          (data ?? []).map((s) => [
            nom(s.users),
            horodatage(s.opened_at, fiche.timezone),
            nom(s.fermeur),
            horodatage(s.closed_at, fiche.timezone),
            tnd(Number(s.opening_float_millimes) || 0),
            s.expected_millimes === null ? '' : tnd(Number(s.expected_millimes)),
            s.counted_millimes === null ? '' : tnd(Number(s.counted_millimes)),
            s.variance_millimes === null ? '' : tnd(Number(s.variance_millimes)),
            // L'écart part AUSSI en nombre brut : c'est la colonne qu'on
            // additionne et qu'on trie dans le tableur, et il peut être
            // négatif — jamais borné, jamais en valeur absolue.
            s.variance_millimes === null ? '' : brut(Number(s.variance_millimes)),
            s.closing_note ?? '',
          ]),
        ),
        nom('periodes-de-travail'),
      )
    }

    case 'tickets':
      return reponseCsv(
        versCsv(
          ['Ticket', 'Encaissé le', 'Vendeur', 'Couverts', 'Articles', 'Total TTC', 'Total (TND)'],
          ventes.tickets.map((t) => [
            t.numero ?? t.id,
            horodatage(t.closeA, fiche.timezone),
            t.vendeur,
            t.couverts,
            t.nombreArticles,
            tnd(t.totalMillimes),
            brut(t.totalMillimes),
          ]),
        ),
        nom('tickets'),
      )
  }
}

/** L'état du stock : un instantané, sans période. */
async function exporterStock(restaurantId: string, etablissement: string): Promise<Response> {
  const supabase = await supabaseServeur()
  const [produitsRes, stockRes, categoriesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, category_id, cost_per_unit, is_available, unavailable_reason')
      .eq('restaurant_id', restaurantId)
      .is('archived_at', null)
      .order('position'),
    supabase
      .from('stock_actuel')
      .select('product_id, qty_on_hand, min_qty, qty_vendue, counted_at')
      .eq('restaurant_id', restaurantId),
    supabase.from('categories').select('id, name').eq('restaurant_id', restaurantId),
  ])

  const stocks = new Map((stockRes.data ?? []).map((s) => [s.product_id, s]))
  const categories = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.name]))

  return reponseCsv(
    versCsv(
      ['Produit', 'Catégorie', 'Quantité', 'Seuil', 'Vendu depuis le comptage', 'Dernier comptage', 'En vente', 'Motif du retrait'],
      (produitsRes.data ?? []).map((p) => {
        const s = stocks.get(p.id)
        return [
          p.name,
          p.category_id ? (categories.get(p.category_id) ?? '') : '',
          // Un stock NÉGATIF n'est pas borné à zéro : c'est le seul signal qui
          // dit « il manque une réception ». Le borner ferait paraître juste
          // un stock faux.
          s ? String(Number(s.qty_on_hand)) : '',
          s?.min_qty === null || s?.min_qty === undefined ? '' : String(Number(s.min_qty)),
          s ? String(Number(s.qty_vendue)) : '',
          s?.counted_at ? new Date(s.counted_at).toLocaleDateString('fr-FR') : '',
          p.is_available ? 'oui' : 'non',
          p.unavailable_reason ?? '',
        ]
      }),
    ),
    nomFichier('stock', etablissement),
  )
}

/** L'historique des mouvements manuels — les ventes n'y sont pas. */
async function exporterMouvements(
  restaurantId: string,
  etablissement: string,
  timezone: string,
): Promise<Response> {
  const supabase = await supabaseServeur()
  const { data: mouvements } = await supabase
    .from('stock_movements')
    .select('id, product_id, qty_delta, reason, note, supplier, created_by, created_at')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(5000)

  const idsProduits = [...new Set((mouvements ?? []).map((m) => m.product_id))]
  const idsAuteurs = [
    ...new Set((mouvements ?? []).map((m) => m.created_by).filter((i): i is string => !!i)),
  ]
  const [produitsRes, auteursRes] = await Promise.all([
    idsProduits.length === 0
      ? { data: [] }
      : supabase.from('products').select('id, name').in('id', idsProduits),
    idsAuteurs.length === 0
      ? { data: [] }
      : supabase.from('users').select('id, full_name').in('id', idsAuteurs),
  ])
  const nomProduit = new Map((produitsRes.data ?? []).map((p) => [p.id, p.name]))
  const auteurs = new Map((auteursRes.data ?? []).map((u) => [u.id, u.full_name]))

  return reponseCsv(
    versCsv(
      ['Date', 'Heure', 'Produit', 'Mouvement', 'Motif', 'Fournisseur', 'Note', 'Par'],
      (mouvements ?? []).map((m) => {
        const d = new Date(m.created_at)
        return [
          d.toLocaleDateString('fr-FR', { timeZone: timezone }),
          d.toLocaleTimeString('fr-FR', { timeZone: timezone, timeStyle: 'short' }),
          nomProduit.get(m.product_id) ?? 'Produit archivé',
          // Le signe est ce qu'on lit en premier : « +12 » ou « −3 ».
          Number(m.qty_delta) > 0 ? `+${m.qty_delta}` : String(m.qty_delta),
          m.reason,
          m.supplier ?? '',
          m.note ?? '',
          m.created_by ? (auteurs.get(m.created_by) ?? '') : '',
        ]
      }),
    ),
    nomFichier('mouvements-stock', etablissement),
  )
}
