/**
 * Rapport de journée — ce que le gérant regarde chaque matin.
 *
 * Les totaux sont additionnés ici par @kaissi/domain, le MÊME module que la
 * tablette. Refaire la somme en SQL produirait un second endroit où l'argent
 * se calcule, et donc un jour un écart entre les deux qu'il faudrait
 * expliquer au client (règle 7).
 */

import Link from 'next/link'
import {
  additionner,
  formaterPourcentage,
  formaterTND,
  type Millimes,
} from '@kaissi/domain'
import { montant } from '../../../serveur/montant.js'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import {
  bornesJourneeCommerciale,
  journeeCourante,
  journeeDecalee,
  libelleJournee,
} from '../../../serveur/journee.js'
import { traduction } from '../../../i18n/serveur.js'
import { aTraduire } from '@kaissi/i18n'

/**
 * Ventilation de TVA telle qu'elle est STOCKÉE dans `orders.tax_breakdown` :
 * la sérialisation directe de `VentilationTaxe` de `@kaissi/domain`. La base
 * s'y appelle `baseHtMillimes` ; `baseMillimes` n'existe que dans la vue
 * d'impression du ticket, qui renomme le champ.
 */
interface LigneVentilation {
  tauxTaxeId: string
  nom: string
  tauxBp: number
  baseHtMillimes: number
  taxeMillimes: number
}

const LIBELLE_PAIEMENT: Record<string, string> = {
  cash: aTraduire('paiement|Espèces'),
  card: 'Carte',
  online: aTraduire('paiement|En ligne'),
  other: 'Autre',
}

function somme(valeurs: readonly number[]): Millimes {
  return additionner(...valeurs.map((v) => montant(v)))
}

export default async function PageJournee({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<{ j?: string }>
}) {
  const t = await traduction()
  const { restaurant } = await params
  const { j } = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'exploitation')
  const supabase = await supabaseServeur()

  const { data: fiche } = await supabase
    .from('restaurants')
    .select('timezone, business_day_start, service_rate_bp, stamp_duty_millimes')
    .eq('id', restaurant)
    .single()

  const fuseau = fiche?.timezone ?? 'Africa/Tunis'
  const bascule = String(fiche?.business_day_start ?? '04:00')
  const journee = j ?? journeeCourante(fuseau, bascule)
  const { debut, fin } = bornesJourneeCommerciale(journee, fuseau, bascule)

  // Les commandes ANNULÉES sont chargées aussi : les compter à zéro serait
  // exact, mais ne pas les montrer du tout empêcherait de voir qu'une soirée
  // en a produit quinze.
  const { data: commandes, error: erreurCommandes } = await supabase
    .from('orders')
    .select(
      'id, status, ticket_number, total_millimes, subtotal_millimes, discount_millimes, tax_millimes, service_millimes, stamp_duty_millimes, tax_breakdown, closed_at, covers',
    )
    .eq('restaurant_id', restaurant)
    .gte('closed_at', debut.toISOString())
    .lt('closed_at', fin.toISOString())
    .order('closed_at', { ascending: false })

  const { data: paiements } = await supabase
    .from('payments')
    .select('type, amount_millimes')
    .eq('restaurant_id', restaurant)
    .is('voided_at', null)
    .gte('created_at', debut.toISOString())
    .lt('created_at', fin.toISOString())

  const { data: shifts } = await supabase
    .from('shifts')
    .select(
      // DEUX noms, pas un. `users` désigne qui a OUVERT ; `fermeur` qui a
      // COMPTÉ. L'alias est indispensable : deux jointures vers la même
      // table sans alias se confondent, et PostgREST ne rendrait qu'une des
      // deux — silencieusement.
      'id, opened_at, closed_at, opening_float_millimes, counted_millimes, expected_millimes, variance_millimes, closing_note, users!shifts_user_id_fkey(full_name), fermeur:users!shifts_closed_by_fkey(full_name)',
    )
    .eq('restaurant_id', restaurant)
    .gte('opened_at', debut.toISOString())
    .lt('opened_at', fin.toISOString())
    .order('opened_at', { ascending: true })

  const encaissees = (commandes ?? []).filter((c) => c.status === 'close')
  const annulees = (commandes ?? []).filter((c) => c.status === 'annulee')

  const chiffreAffaires = somme(encaissees.map((c) => c.total_millimes as number))
  const remises = somme(encaissees.map((c) => c.discount_millimes as number))
  const service = somme(encaissees.map((c) => c.service_millimes as number))
  const timbre = somme(encaissees.map((c) => c.stamp_duty_millimes as number))
  const couverts = encaissees.reduce((total, c) => total + ((c.covers as number) ?? 0), 0)

  // La ventilation de TVA est REGROUPÉE PAR TAUX, jamais additionnée toutes
  // taxes confondues : c'est ce que demande un pied de ticket, et c'est ce
  // qu'un comptable rapproche.
  const parTaux = new Map<string, LigneVentilation>()
  for (const commande of encaissees) {
    for (const ligne of (commande.tax_breakdown ?? []) as LigneVentilation[]) {
      const existant = parTaux.get(ligne.tauxTaxeId)
      if (existant) {
        existant.baseHtMillimes += montant(ligne.baseHtMillimes)
        existant.taxeMillimes += montant(ligne.taxeMillimes)
      } else {
        parTaux.set(ligne.tauxTaxeId, {
          ...ligne,
          baseHtMillimes: montant(ligne.baseHtMillimes),
          taxeMillimes: montant(ligne.taxeMillimes),
        })
      }
    }
  }
  const ventilation = [...parTaux.values()].sort((a, b) => b.tauxBp - a.tauxBp)

  const parMoyen = new Map<string, number>()
  for (const paiement of paiements ?? []) {
    const type = paiement.type as string
    parMoyen.set(type, (parMoyen.get(type) ?? 0) + (Number(paiement.amount_millimes) || 0))
  }
  const encaisse = somme([...parMoyen.values()])

  return (
    <>
      <h1>{t('Journée du')}{' '}{libelleJournee(journee, t.locale)}</h1>
      <p className="sous-titre">{t('De')}{' '}{debut.toLocaleString('fr-FR', { timeZone: fuseau, timeStyle: 'short' })}{' '}{t('à')}{' '}
        {fin.toLocaleString('fr-FR', { timeZone: fuseau, timeStyle: 'short' })}{' '}{t('le lendemain — une vente encaissée après minuit appartient à la soirée de la veille.')}</p>

      <nav style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Link className="bouton" href={`?j=${journeeDecalee(journee, -1)}`}>{t('← Veille')}</Link>
        <Link className="bouton" href={`?j=${journeeCourante(fuseau, bascule)}`}>{t('Aujourd\'hui')}</Link>
        <Link className="bouton" href={`?j=${journeeDecalee(journee, 1)}`}>{t('Lendemain →')}</Link>
      </nav>

      {erreurCommandes ? (
        <p className="message erreur">{t('Lecture impossible :')}{' '}{erreurCommandes.message}
        </p>
      ) : null}

      <div className="grille deux">
        <section className="carte">
          <h2>{t('Chiffre d\'affaires')}</h2>
          <table>
            <tbody>
              <tr>
                <td>{t('Commandes encaissées')}</td>
                <td className="nombre">{encaissees.length}</td>
              </tr>
              {couverts > 0 && (
                <tr>
                  <td>{t('Couverts')}</td>
                  <td className="nombre">{couverts}</td>
                </tr>
              )}
              <tr>
                <td>{t('Remises accordées')}</td>
                <td className="nombre">− {formaterTND(remises)}</td>
              </tr>
              {service > 0 && (
                <tr>
                  <td>{t('Service')}</td>
                  <td className="nombre">{formaterTND(service)}</td>
                </tr>
              )}
              {timbre > 0 && (
                <tr>
                  <td>{t('Droit de timbre ⚠')}</td>
                  <td className="nombre">{formaterTND(timbre)}</td>
                </tr>
              )}
              <tr className="total-ligne">
                <td>{t('Total')}</td>
                <td className="nombre">{formaterTND(chiffreAffaires)}</td>
              </tr>
            </tbody>
          </table>
          {annulees.length > 0 && (
            <p className="indication">
              {annulees.length}{' '}{t('commande')}{annulees.length > 1 ? 's' : ''}{' '}{t('annulée')}{annulees.length > 1 ? 's' : ''}{' '}{t('— comptée')}{annulees.length > 1 ? 's' : ''}{' '}{t('à zéro, mais conservée')}{annulees.length > 1 ? 's' : ''}{' '}{t('dans le journal.')}</p>
          )}
        </section>

        <section className="carte">
          <h2>{t('Encaissements')}</h2>
          {parMoyen.size === 0 ? (
            <p className="vide">{t('Aucun encaissement sur cette journée.')}</p>
          ) : (
            <table>
              <tbody>
                {[...parMoyen.entries()].map(([type, cumul]) => (
                  <tr key={type}>
                    <td>{t(LIBELLE_PAIEMENT[type] ?? type)}</td>
                    <td className="nombre">{formaterTND(montant(cumul))}</td>
                  </tr>
                ))}
                <tr className="total-ligne">
                  <td>{t('Total encaissé')}</td>
                  <td className="nombre">{formaterTND(encaisse)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {encaisse !== chiffreAffaires && parMoyen.size > 0 && (
            <p className="message avertissement" style={{ marginTop: '0.85rem' }}>{t('L\'encaissé diffère du chiffre d\'affaires de')}{' '}
              {formaterTND(montant(encaisse - chiffreAffaires))}{t('. C\'est normal si des commandes sont encore partiellement payées, ou si un paiement a été saisi sur une commande d\'une autre journée.')}</p>
          )}
        </section>
      </div>

      <section className="carte">
        <h2>{t('TVA par taux')}</h2>
        <p className="indication" style={{ marginTop: 0, marginBottom: '0.75rem' }}>{t('La taxe est arrondie PAR TAUX, puis additionnée — jamais l\'inverse. ⚠ Les taux applicables à la restauration doivent être confirmés par un expert-comptable tunisien.')}</p>
        {ventilation.length === 0 ? (
          <p className="vide">{t('Aucune vente taxable sur cette journée.')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('Taux')}</th>
                <th className="nombre">{t('Base')}</th>
                <th className="nombre">{t('TVA')}</th>
              </tr>
            </thead>
            <tbody>
              {ventilation.map((ligne) => (
                <tr key={ligne.tauxTaxeId}>
                  <td>
                    {ligne.nom} — {formaterPourcentage(ligne.tauxBp)} %
                  </td>
                  <td className="nombre">{formaterTND(montant(ligne.baseHtMillimes))}</td>
                  <td className="nombre">{formaterTND(montant(ligne.taxeMillimes))}</td>
                </tr>
              ))}
              <tr className="total-ligne">
                <td>{t('Total')}</td>
                <td className="nombre">
                  {formaterTND(somme(ventilation.map((l) => l.baseHtMillimes)))}
                </td>
                <td className="nombre">
                  {formaterTND(somme(ventilation.map((l) => l.taxeMillimes)))}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="carte">
        <h2>{t('Caisses')}</h2>
        {(shifts ?? []).length === 0 ? (
          <p className="vide">{t('Aucune prise de poste sur cette journée.')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('Ouverte par')}</th>
                <th>{t('Ouverture')}</th>
                <th>{t('Fermée par')}</th>
                <th>{t('Clôture')}</th>
                <th className="nombre">{t('Fond')}</th>
                <th className="nombre">{t('Compté')}</th>
                <th className="nombre">{t('Attendu')}</th>
                <th className="nombre">{t('Écart')}</th>
              </tr>
            </thead>
            <tbody>
              {(shifts ?? []).map((shift) => {
                const utilisateur = shift.users as { full_name: string } | null
                /*
                 * Qui a COMPTÉ la caisse. Distinct de qui l'a ouverte : un
                 * caissier ouvre à midi, un serveur compte le soir, et
                 * devant un écart c'est le second qu'on interroge.
                 *
                 * « — » pour les services clos avant la migration 0027, et
                 * pour ceux encore ouverts. On ne le remplace PAS par le nom
                 * de l'ouverture : ce serait mettre en cause quelqu'un qui
                 * n'a pas vu les billets.
                 */
                const fermeur = shift.fermeur as { full_name: string } | null
                const ecart = shift.variance_millimes as number | null
                const heure = (valeur: string | null) =>
                  valeur
                    ? new Date(valeur).toLocaleTimeString('fr-FR', {
                        timeZone: fuseau,
                        timeStyle: 'short',
                      })
                    : '—'
                return (
                  <tr key={shift.id as string}>
                    <td>{utilisateur?.full_name ?? '—'}</td>
                    <td>{heure(shift.opened_at as string)}</td>
                    <td>{fermeur?.full_name ?? <span className="detail">—</span>}</td>
                    <td>{heure(shift.closed_at as string | null)}</td>
                    <td className="nombre">
                      {formaterTND(montant(Number(shift.opening_float_millimes) || 0))}
                    </td>
                    <td className="nombre">
                      {shift.counted_millimes === null
                        ? '—'
                        : formaterTND(montant(Number(shift.counted_millimes)))}
                    </td>
                    <td className="nombre">
                      {shift.expected_millimes === null
                        ? '—'
                        : formaterTND(montant(Number(shift.expected_millimes)))}
                    </td>
                    <td
                      className={`nombre ecart ${
                        ecart === null ? '' : ecart < 0 ? 'negatif' : ecart > 0 ? 'positif' : 'nul'
                      }`}
                    >
                      {ecart === null ? '—' : formaterTND(montant(ecart))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="indication">{t('L\'écart est')}{' '}<strong>{t('compté − attendu')}</strong>{t(', jamais borné à zéro : un excédent est aussi anormal qu\'un manque, et un écart récurrent chez le même employé est un signal à regarder.')}</p>
      </section>
    </>
  )
}
