/**
 * Historique des tickets, et le détail de l'un d'eux.
 *
 * Deux vues en une page : la liste sur la période, et — quand `?ticket=…`
 * est présent — le détail ligne à ligne d'une vente, avec ses paiements.
 * C'est la page qu'on ouvre quand un client conteste un montant.
 */

import Link from 'next/link'
import { formaterPourcentage, formaterTND } from '@kaissi/domain'
import { montant } from '../../../serveur/montant.js'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { journeeCourante, libelleJournee } from '../../../serveur/journee.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { reconstruireTicket } from '../../../serveur/ticket.js'
import { chargerFiche, chargerVentes, resoudrePeriode } from '../../../serveur/ventes.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { SelecteurPeriode } from '../../../composants/SelecteurPeriode.js'

export const dynamic = 'force-dynamic'

const LIBELLE_PAIEMENT: Record<string, string> = {
  cash: 'Espèces',
  card: 'Carte',
  online: 'En ligne',
  other: 'Autre',
}

function heure(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function PageTickets({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<{ du?: string; au?: string; ticket?: string }>
}) {
  const { restaurant } = await params
  const { du, au, ticket } = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const fiche = await chargerFiche(restaurant)
  const periode = resoudrePeriode(fiche, du, au)
  const ventes = await chargerVentes(restaurant, periode)
  const aujourdhui = journeeCourante(fiche.timezone, fiche.bascule)

  if (ventes.erreur) {
    return (
      <section className="bloc">
        <h1>Tickets</h1>
        <p className="message erreur">Lecture impossible : {ventes.erreur}</p>
      </section>
    )
  }

  const totalPeriode = ventes.tickets.reduce((t, x) => t + x.totalMillimes, 0)

  return (
    <>
      <header className="entete-rapport">
        <h1>Tickets</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du)
            : `Du ${libelleJournee(periode.du)} au ${libelleJournee(periode.au)}`}
        </p>
      </header>

      <SelecteurPeriode du={periode.du} au={periode.au} aujourdhui={aujourdhui} />

      {/* Les bornes affichées sont recopiées dans le lien : sans elles, on
          regarde septembre et on télécharge la semaine en cours. */}
      <BoutonsExport
        restaurantId={restaurant}
        exports={[{ quoi: 'tickets', libelle: 'Tickets' }]}
        du={periode.du}
        au={periode.au}
      />

      {ticket && <DetailTicket restaurantId={restaurant} orderId={ticket} periode={periode} />}

      <section className="bloc">
        <h2>
          {ventes.tickets.length} ticket(s) · {formaterTND(montant(totalPeriode))}
        </h2>
        {ventes.tickets.length === 0 ? (
          <p className="vide">Aucun ticket encaissé sur cette période.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Encaissé le</th>
                <th>Par</th>
                <th className="nombre">Articles</th>
                <th className="nombre">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ventes.tickets.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.numero ?? '—'}</td>
                  <td>{heure(t.closeA)}</td>
                  <td>{t.vendeur}</td>
                  <td className="nombre">{t.nombreArticles}</td>
                  <td className="nombre">{formaterTND(montant(t.totalMillimes))}</td>
                  <td>
                    <Link
                      href={{
                        pathname: `/${restaurant}/tickets`,
                        query: { du: periode.du, au: periode.au, ticket: t.id },
                      }}
                    >
                      Détail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

/**
 * Le détail d'une vente.
 *
 * Requête dédiée plutôt que filtrage de ce qui est déjà chargé : on veut ici
 * les lignes ANNULÉES aussi. Elles n'entrent dans aucun chiffre, mais elles
 * expliquent l'écart entre ce que le client a commandé et ce qu'il a payé —
 * c'est précisément la question qu'on vient poser sur cette page.
 */
async function DetailTicket({
  restaurantId,
  orderId,
  periode,
}: {
  restaurantId: string
  orderId: string
  periode: { du: string; au: string }
}) {
  const supabase = await supabaseServeur()
  // Le ticket TEL QUE LE POS le montre — reconstruit depuis le journal, par
  // la même chaîne que la caisse. Chargé en parallèle du reste : il répond à
  // une autre question, et l'une ne doit pas attendre l'autre.
  const ticketPapier = await reconstruireTicket(restaurantId, orderId)
  const [commandeRes, lignesRes, paiementsRes] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, ticket_number, status, opened_at, closed_at, covers, subtotal_millimes, discount_millimes, tax_millimes, service_millimes, stamp_duty_millimes, total_millimes, tax_breakdown',
      )
      .eq('id', orderId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),
    supabase
      .from('order_items')
      .select(
        'id, designation, qty, line_gross_millimes, line_discount_millimes, global_discount_share_millimes, line_total_millimes, line_tax_millimes, note, voided_at, position',
      )
      .eq('order_id', orderId)
      .order('position', { ascending: true }),
    supabase
      .from('payments')
      .select('id, type, amount_millimes, change_millimes, voided_at, created_at')
      .eq('order_id', orderId),
  ])

  const commande = commandeRes.data
  if (!commande) {
    return (
      <section className="bloc">
        <p className="message avertissement">Ticket introuvable sur cet établissement.</p>
      </section>
    )
  }

  const lignes = lignesRes.data ?? []
  const paiements = paiementsRes.data ?? []

  return (
    <section className="bloc detail-ticket">
      {/*
        LE TICKET, tel que le client l'a en main.

        Deux vues cohabitent volontairement, parce qu'elles répondent à deux
        questions différentes : celle-ci dit « qu'y a-t-il sur son papier »,
        le tableau qui suit dit « pourquoi ce montant » — avec les lignes
        annulées, que le ticket ne montre pas.

        Le rendu vient de la MÊME chaîne que la caisse : mêmes événements,
        même code de mise en page ESC/POS. Le jour où l'imprimante sera
        branchée, ce bloc n'aura pas à changer.
      */}
      <details open className="ticket-papier">
        <summary>Ticket, tel qu’il s’imprime</summary>
        {'erreur' in ticketPapier ? (
          <p className="indication">
            Ticket non reconstructible : {ticketPapier.erreur} Le détail
            ci-dessous reste exact — il vient de la projection.
          </p>
        ) : (
          <>
            <pre className="ticket-ecran">{ticketPapier.apercu}</pre>
            <p className="actions-export">
              <a
                href={`/${restaurantId}/export/ticket?commande=${orderId}`}
                download
                className="discret"
              >
                Exporter ce ticket
              </a>
              <span className="detail">
                Fichier texte, à joindre à une réclamation ou à une pièce
                comptable.
              </span>
            </p>
          </>
        )}
      </details>

      <div className="detail-entete">
        <h2>Ticket {commande.ticket_number ?? '—'}</h2>
        <Link
          href={{
            pathname: `/${restaurantId}/tickets`,
            query: { du: periode.du, au: periode.au },
          }}
        >
          ✕ Fermer
        </Link>
      </div>

      <dl className="lignes-chiffres">
        <dt>Ouvert le</dt>
        <dd>{heure(commande.opened_at)}</dd>
        <dt>Encaissé le</dt>
        <dd>{heure(commande.closed_at)}</dd>
        {commande.covers !== null && (
          <>
            <dt>Couverts</dt>
            <dd>{commande.covers}</dd>
          </>
        )}
      </dl>

      <table>
        <thead>
          <tr>
            <th>Article</th>
            <th className="nombre">Qté</th>
            <th className="nombre">Brut</th>
            <th className="nombre">Remise</th>
            <th className="nombre">Net HT</th>
            <th className="nombre">TVA</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => {
            const remise = l.line_discount_millimes + l.global_discount_share_millimes
            return (
              <tr key={l.id} className={l.voided_at ? 'ligne-annulee' : ''}>
                <td>
                  {l.designation}
                  {l.voided_at && <span className="etiquette inactif"> annulée</span>}
                  {l.note && <small className="detail"> « {l.note} »</small>}
                </td>
                <td className="nombre">{l.qty}</td>
                <td className="nombre">{formaterTND(montant(l.line_gross_millimes))}</td>
                <td className="nombre">
                  {remise > 0 ? `− ${formaterTND(montant(remise))}` : '—'}
                </td>
                <td className="nombre">{formaterTND(montant(l.line_total_millimes))}</td>
                <td className="nombre">{formaterTND(montant(l.line_tax_millimes))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="grille deux" style={{ marginTop: '1rem' }}>
        <dl className="lignes-chiffres">
          <dt>Sous-total</dt>
          <dd>{formaterTND(montant(commande.subtotal_millimes))}</dd>
          <dt>Remises</dt>
          <dd>− {formaterTND(montant(commande.discount_millimes))}</dd>
          <dt>TVA</dt>
          <dd>{formaterTND(montant(commande.tax_millimes))}</dd>
          {commande.service_millimes > 0 && (
            <>
              <dt>Service</dt>
              <dd>{formaterTND(montant(commande.service_millimes))}</dd>
            </>
          )}
          {commande.stamp_duty_millimes > 0 && (
            <>
              <dt>Timbre</dt>
              <dd>{formaterTND(montant(commande.stamp_duty_millimes))}</dd>
            </>
          )}
          <dt className="fort">Total</dt>
          <dd className="fort">{formaterTND(montant(commande.total_millimes))}</dd>
        </dl>

        <div>
          <h3>Transactions</h3>
          {paiements.length === 0 ? (
            <p className="vide">Aucun paiement enregistré.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Moyen</th>
                  <th className="nombre">Montant</th>
                  <th className="nombre">Rendu</th>
                </tr>
              </thead>
              <tbody>
                {paiements.map((p) => (
                  <tr key={p.id} className={p.voided_at ? 'ligne-annulee' : ''}>
                    <td>
                      {LIBELLE_PAIEMENT[p.type] ?? p.type}
                      {p.voided_at && <span className="etiquette inactif"> annulé</span>}
                    </td>
                    <td className="nombre">{formaterTND(montant(p.amount_millimes))}</td>
                    <td className="nombre">
                      {p.change_millimes > 0 ? formaterTND(montant(p.change_millimes)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <h3>Ventilation de TVA</h3>
      <table>
        <thead>
          <tr>
            <th>Taux</th>
            <th className="nombre">Base HT</th>
            <th className="nombre">TVA</th>
          </tr>
        </thead>
        <tbody>
          {(commande.tax_breakdown ?? []).map((v) => (
            <tr key={v.tauxTaxeId}>
              <td>
                {v.nom} ({formaterPourcentage(v.tauxBp)} %)
              </td>
              <td className="nombre">{formaterTND(montant(v.baseHtMillimes))}</td>
              <td className="nombre">{formaterTND(montant(v.taxeMillimes))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
