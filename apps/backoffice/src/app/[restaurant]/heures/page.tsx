/**
 * Heures travaillées — la pointeuse de TOUTES les caisses.
 *
 * Chaque caisse ne connaît que ses propres pointages ; le back-office les
 * reçoit tous (`POST /sync/pointages`). C'est donc ici, et seulement ici,
 * qu'on additionne les heures d'un employé qui arrive sur la caisse 1 et
 * repart sur la caisse 2.
 *
 * Les heures viennent de `heuresParEmploye` (domaine) — la même règle que la
 * caisse. Une sortie oubliée n'est PAS comptée jusqu'à maintenant : elle est
 * « à vérifier », et le gérant saisit la sortie sur la ligne.
 *
 * ⚠ Heures de la TABLETTE : elles tracent, elles ne prouvent pas. Et ce
 *   n'est pas un registre du temps de travail au sens du Code du travail —
 *   à faire valider si un tel registre est exigé.
 */

import { etatPointage, formaterDuree, heuresParEmploye, dureeMinutes, type Pointage } from '@kaissi/domain'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { journeeCourante, libelleJournee } from '../../../serveur/journee.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { chargerFiche, chargerNomsEmployes, resoudrePeriode } from '../../../serveur/ventes.js'
import { SelecteurPeriode } from '../../../composants/SelecteurPeriode.js'
import { CorrectionSortie } from '../../../composants/CorrectionSortie.js'
import { traduction } from '../../../i18n/serveur.js'

export const dynamic = 'force-dynamic'

export default async function PageHeures({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>
  searchParams: Promise<{ du?: string; au?: string }>
}) {
  const t = await traduction()
  const { restaurant } = await params
  const { du, au } = await searchParams
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  const fiche = await chargerFiche(restaurant)
  const periode = resoudrePeriode(fiche, du, au)
  const aujourdhui = journeeCourante(fiche.timezone, fiche.bascule)
  const supabase = await supabaseServeur()

  const [pointagesRes, nom] = await Promise.all([
    supabase
      .from('time_entries')
      .select('id, user_id, clock_in_at, clock_out_at, corrected_at, devices(label)')
      .eq('restaurant_id', restaurant)
      .gte('clock_in_at', periode.bornes.debut.toISOString())
      .lt('clock_in_at', periode.bornes.fin.toISOString())
      .order('clock_in_at', { ascending: false }),
    chargerNomsEmployes(),
  ])

  if (pointagesRes.error) {
    return (
      <section className="bloc">
        <h1>{t('Heures travaillées')}</h1>
        <p className="message erreur">{t('Lecture impossible :')}{' '}{pointagesRes.error.message}</p>
      </section>
    )
  }

  const lignes = pointagesRes.data ?? []
  const pointages: Pointage[] = lignes.map((l) => ({
    id: l.id,
    employeId: l.user_id,
    arriveeA: l.clock_in_at,
    sortieA: l.clock_out_at,
  }))
  const heures = heuresParEmploye(pointages)
  const totalMinutes = heures.reduce((somme, h) => somme + h.minutes, 0)
  const aVerifier = heures.reduce((somme, h) => somme + h.aVerifier, 0)
  const presents = heures.reduce((somme, h) => somme + h.enCours, 0)

  const heure = (valeur: string | null) =>
    valeur
      ? new Date(valeur).toLocaleString(t.locale, {
          timeZone: fiche.timezone,
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '—'
  /** L'heure locale de l'établissement, au format d'un champ `datetime-local`. */
  const pourChamp = (iso: string) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: fiche.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .format(new Date(iso))
      .replace(' ', 'T')

  const libelleEtat = {
    clos: null,
    en_cours: t('présent'),
    sortie_oubliee: t('sortie oubliée'),
    incoherent: t('heures incohérentes'),
  } as const

  return (
    <>
      <header className="entete-rapport">
        <h1>{t('Heures travaillées')}</h1>
        <p className="sous-titre">
          {periode.du === periode.au
            ? libelleJournee(periode.du, t.locale)
            : t('Du {valeur} au {valeur2}', { valeur: libelleJournee(periode.du, t.locale), valeur2: libelleJournee(periode.au, t.locale) })}
        </p>
      </header>

      <SelecteurPeriode du={periode.du} au={periode.au} aujourdhui={aujourdhui} />

      <div className="cartes-kpi">
        <div className="kpi">
          <span className="kpi-libelle">{t('Heures pointées')}</span>
          <span className="kpi-valeur">{formaterDuree(totalMinutes)}</span>
          <span className="kpi-aide">{t('{n} employé(s)', { n: heures.length })}</span>
        </div>
        <div className="kpi">
          <span className="kpi-libelle">{t('Présents')}</span>
          <span className="kpi-valeur">{presents}</span>
          <span className="kpi-aide">{t('pointés, sans sortie encore')}</span>
        </div>
        <div className={`kpi ${aVerifier > 0 ? 'attention' : ''}`}>
          <span className="kpi-libelle">{t('À vérifier')}</span>
          <span className="kpi-valeur">{aVerifier}</span>
          <span className="kpi-aide">{t('sorties oubliées : non comptées tant qu’elles ne sont pas corrigées')}</span>
        </div>
      </div>

      <section className="bloc">
        <h2>{t('Par employé')}</h2>
        {heures.length === 0 ? (
          <p className="vide">{t('Aucun pointage sur cette période. On pointe sur la caisse : « Pointer mon arrivée ou ma sortie », sous la prise de poste.')}</p>
        ) : (
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>{t('Employé')}</th>
                  <th className="nombre">{t('Pointages')}</th>
                  <th className="nombre">{t('Heures')}</th>
                  <th className="nombre">{t('À vérifier')}</th>
                </tr>
              </thead>
              <tbody>
                {heures.map((h) => (
                  <tr key={h.employeId ?? '—'}>
                    <td>{nom(h.employeId)}</td>
                    <td className="nombre">{h.pointages}</td>
                    <td className="nombre">{formaterDuree(h.minutes)}</td>
                    <td className="nombre">{h.aVerifier || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lignes.length > 0 && (
        <section className="bloc">
          <h2>{t('Pointages')}</h2>
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>{t('Employé')}</th>
                  <th>{t('Arrivée')}</th>
                  <th>{t('Sortie')}</th>
                  <th className="nombre">{t('Durée')}</th>
                  <th>{t('Caisse')}</th>
                  <th>{t('État')}</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => {
                  const p = pointages[i]!
                  const etat = etatPointage(p)
                  const caisse = l.devices as { label: string } | null
                  return (
                    <tr key={l.id}>
                      <td>{nom(l.user_id)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{heure(l.clock_in_at)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {heure(l.clock_out_at)}
                        {l.corrected_at && <small className="detail"> {t('corrigée')}</small>}
                      </td>
                      <td className="nombre detail">
                        {etat === 'clos' && l.clock_out_at
                          ? formaterDuree(dureeMinutes(l.clock_in_at, l.clock_out_at))
                          : '—'}
                      </td>
                      <td className="detail">{caisse?.label ?? '—'}</td>
                      <td>
                        {libelleEtat[etat] && <span className="etiquette">{libelleEtat[etat]}</span>}
                        {(etat === 'sortie_oubliee' || etat === 'incoherent') && etablissement.gestionnaire && (
                          <CorrectionSortie
                            restaurantId={restaurant}
                            pointageId={l.id}
                            valeurInitiale={pourChamp(l.clock_out_at ?? l.clock_in_at)}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="indication">{t('Les heures sont celles des tablettes : elles tracent qui a pointé, elles ne prouvent pas l’heure exacte. Une sortie corrigée ici porte la mention « corrigée ».')}</p>
        </section>
      )}
    </>
  )
}
