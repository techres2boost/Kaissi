/**
 * Périodes de travail — un service de caisse, de son ouverture à sa clôture.
 *
 * ── Pourquoi cet écran, alors que « Journée » montre déjà les caisses ─────
 *
 * « Journée » est un rapport de JOUR : il montre les services de cette
 * journée-là, au milieu du chiffre d'affaires, des paiements et de la TVA.
 * C'est la bonne vue pour clôturer le soir.
 *
 * Ce n'est pas la bonne vue pour la question qui suit : « qui rend une caisse
 * juste, et qui rend une caisse fausse ? » Celle-là se lit sur PLUSIEURS
 * semaines, service par service, et un écart isolé ne dit rien — c'est sa
 * RÉPÉTITION chez la même personne qui parle. Un écran de jour ne peut pas
 * la montrer ; celui-ci ne fait que ça.
 *
 * ── L'écart est ce qu'on vient voir ───────────────────────────────────────
 *
 * Il peut être négatif, et c'est tout son intérêt. Il n'est jamais borné à
 * zéro, jamais présenté en valeur absolue : un manque et un excédent ne
 * racontent pas la même histoire.
 */

import { formaterTND, millimes } from '@kaissi/domain'
import { montant } from '../../../serveur/montant.js'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { journeeCourante, libelleJournee } from '../../../serveur/journee.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { chargerFiche, resoudrePeriode } from '../../../serveur/ventes.js'
import { BoutonsExport } from '../../../composants/BoutonsExport.js'
import { SelecteurPeriode } from '../../../composants/SelecteurPeriode.js'

export const dynamic = 'force-dynamic'

export default async function PagePeriodes({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<{ du?: string; au?: string }>
}) {
  const { restaurant } = await params
  const { du, au } = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const fiche = await chargerFiche(restaurant)
  const periode = resoudrePeriode(fiche, du, au)
  const aujourdhui = journeeCourante(fiche.timezone, fiche.bascule)
  const supabase = await supabaseServeur()

  const [servicesRes, paiementsRes] = await Promise.all([
    supabase
      .from('shifts')
      .select(
        // Les DEUX noms : qui a ouvert, qui a COMPTÉ. Alias explicites —
        // deux jointures vers la même table sans alias se confondent, et
        // PostgREST n'en rendrait qu'une, silencieusement.
        'id, opened_at, closed_at, opening_float_millimes, counted_millimes, expected_millimes, variance_millimes, closing_note, users!shifts_user_id_fkey(full_name), fermeur:users!shifts_closed_by_fkey(full_name)',
      )
      .eq('restaurant_id', restaurant)
      .gte('opened_at', periode.bornes.debut.toISOString())
      .lt('opened_at', periode.bornes.fin.toISOString())
      .order('opened_at', { ascending: false }),
    // Les encaissements portent déjà leur `shift_id` : on n'attribue donc
    // rien par fenêtre de temps, ce qui aurait rangé une vente du bout de
    // nuit dans le service suivant.
    supabase
      .from('payments')
      .select('shift_id, amount_millimes, voided_at')
      .eq('restaurant_id', restaurant)
      .gte('created_at', periode.bornes.debut.toISOString())
      .lt('created_at', periode.bornes.fin.toISOString()),
  ])

  if (servicesRes.error) {
    return (
      <section className="bloc">
        <h1>Périodes de travail</h1>
        <p className="message erreur">Lecture impossible : {servicesRes.error.message}</p>
      </section>
    )
  }

  const encaisseParService = new Map<string, { total: number; nombre: number }>()
  for (const p of paiementsRes.data ?? []) {
    // Un paiement ANNULÉ n'est pas un encaissement : le compter gonflerait
    // l'attendu et fabriquerait un écart qui n'existe pas.
    if (p.voided_at || !p.shift_id) continue
    const cumul = encaisseParService.get(p.shift_id) ?? { total: 0, nombre: 0 }
    cumul.total += Number(p.amount_millimes) || 0
    cumul.nombre += 1
    encaisseParService.set(p.shift_id, cumul)
  }

  const services = servicesRes.data ?? []
  const clos = services.filter((s) => s.closed_at !== null)
  const ecartTotal = clos.reduce((t, s) => t + (Number(s.variance_millimes) || 0), 0)
  const nonJustes = clos.filter((s) => (Number(s.variance_millimes) || 0) !== 0)

  const heure = (valeur: string | null) =>
    valeur
      ? new Date(valeur).toLocaleString('fr-FR', {
          timeZone: fiche.timezone,
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '—'

  /** Durée du service, en heures et minutes — « 7 h 20 ». */
  const duree = (debut: string, fin: string | null) => {
    if (!fin) return 'en cours'
    const minutes = Math.max(0, Math.round((new Date(fin).getTime() - new Date(debut).getTime()) / 60000))
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
  }

  return (
    <>
      <header className="entete-rapport">
        <h1>Périodes de travail</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du)
            : `Du ${libelleJournee(periode.du)} au ${libelleJournee(periode.au)}`}
        </p>
      </header>

      <SelecteurPeriode du={periode.du} au={periode.au} aujourdhui={aujourdhui} />

      <BoutonsExport
        restaurantId={restaurant}
        exports={[{ quoi: 'periodes', libelle: 'Périodes de travail' }]}
        du={periode.du}
        au={periode.au}
      />

      <div className="cartes-kpi">
        <div className="kpi">
          <span className="kpi-libelle">Services</span>
          <span className="kpi-valeur">{services.length}</span>
          <span className="kpi-aide">
            {services.length - clos.length} encore ouvert(s)
          </span>
        </div>
        <div className={`kpi ${ecartTotal !== 0 ? 'attention' : ''}`}>
          <span className="kpi-libelle">Écart cumulé</span>
          <span className={`kpi-valeur ${ecartTotal < 0 ? 'negatif' : ''}`}>
            {formaterTND(montant(ecartTotal))}
          </span>
          <span className="kpi-aide">Compté − attendu, sur les services clos</span>
        </div>
        <div className={`kpi ${nonJustes.length > 0 ? 'attention' : ''}`}>
          <span className="kpi-libelle">Caisses non justes</span>
          <span className="kpi-valeur">
            {nonJustes.length} <small>/ {clos.length}</small>
          </span>
          <span className="kpi-aide">
            Un écart isolé arrive ; c’est sa répétition qui parle.
          </span>
        </div>
      </div>

      <section className="bloc">
        <h2>Services</h2>
        {services.length === 0 ? (
          <p className="vide">Aucune prise de poste sur cette période.</p>
        ) : (
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>Ouverte par</th>
                  <th>Ouverture</th>
                  <th>Fermée par</th>
                  <th>Clôture</th>
                  <th className="nombre">Durée</th>
                  <th className="nombre">Fond</th>
                  <th className="nombre">Encaissé</th>
                  <th className="nombre">Attendu</th>
                  <th className="nombre">Compté</th>
                  <th className="nombre">Écart</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => {
                  const ouvreur = s.users as { full_name: string } | null
                  const fermeur = s.fermeur as { full_name: string } | null
                  const ecart = s.variance_millimes === null ? null : Number(s.variance_millimes)
                  const encaisse = encaisseParService.get(s.id)
                  return (
                    <tr key={s.id}>
                      <td>{ouvreur?.full_name ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{heure(s.opened_at)}</td>
                      {/* « — » pour les services clos avant la migration 0027 :
                          c'est la vérité. Recopier le nom de l'ouverture
                          mettrait en cause quelqu'un qui n'a pas vu les billets. */}
                      <td>{fermeur?.full_name ?? <span className="detail">—</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{heure(s.closed_at)}</td>
                      <td className="nombre detail">{duree(s.opened_at, s.closed_at)}</td>
                      <td className="nombre">
                        {formaterTND(montant(Number(s.opening_float_millimes) || 0))}
                      </td>
                      <td className="nombre">
                        {encaisse ? (
                          <>
                            {formaterTND(millimes(encaisse.total))}
                            <small className="detail"> {encaisse.nombre} op.</small>
                          </>
                        ) : (
                          <span className="detail">—</span>
                        )}
                      </td>
                      <td className="nombre">
                        {s.expected_millimes === null
                          ? '—'
                          : formaterTND(montant(Number(s.expected_millimes)))}
                      </td>
                      <td className="nombre">
                        {s.counted_millimes === null
                          ? '—'
                          : formaterTND(montant(Number(s.counted_millimes)))}
                      </td>
                      <td
                        className={`nombre ecart ${
                          ecart === null ? '' : ecart < 0 ? 'negatif' : ecart > 0 ? 'positif' : 'nul'
                        }`}
                      >
                        {ecart === null ? '—' : formaterTND(montant(ecart))}
                      </td>
                      <td className="detail">{s.closing_note ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="indication">
          L’<strong>écart</strong> est <em>compté − attendu</em>. Il peut être
          négatif, et c’est tout son intérêt : un manque et un excédent ne
          racontent pas la même histoire, donc il n’est jamais présenté en
          valeur absolue.
        </p>
      </section>
    </>
  )
}
