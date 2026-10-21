/**
 * Pointeuse — qui est là aujourd'hui, et depuis quand, sur CETTE caisse.
 *
 * Même réserve que « Périodes de travail », et pour la même raison : les
 * pointages sont POUSSÉS et jamais retirés. Une tablette ne connaît que
 * ceux faits sur elle. Les heures de l'établissement, toutes caisses
 * confondues, sont au back-office (« Heures travaillées ») — l'écran le dit
 * une fois, en haut, plutôt que d'afficher un total qui aurait l'air juste.
 *
 * Les heures viennent de `heuresParEmploye` (domaine) : une sortie oubliée
 * n'est pas comptée jusqu'à maintenant, elle est « à vérifier ».
 */

import { useEffect, useState } from 'react'
import { etatPointage, formaterDuree, heuresParEmploye, type Pointage } from '@kaissi/domain'
import { useApp } from '../etat/contexte.js'
import { ModalePointeuse } from '../composants/Pointeuse.js'
import { dateLocale, t } from '../i18n.js'

/** Minuit local d'aujourd'hui et de demain : la journée de la tablette. */
function aujourdhui(): [string, string] {
  const debut = new Date()
  debut.setHours(0, 0, 0, 0)
  const fin = new Date(debut)
  fin.setDate(fin.getDate() + 1)
  return [debut.toISOString(), fin.toISOString()]
}

const heure = (iso: string) => dateLocale(new Date(iso), { hour: '2-digit', minute: '2-digit' })

export function EcranPointeuse({ onRetour }: { readonly onRetour: () => void }) {
  const { app, employes, version } = useApp()
  const [pointages, setPointages] = useState<Pointage[] | null>(null)
  const [pointer, setPointer] = useState(false)

  useEffect(() => {
    let vivant = true
    const [debut, fin] = aujourdhui()
    void app.pointeuse.entre(debut, fin).then((p) => vivant && setPointages(p))
    return () => {
      vivant = false
    }
  }, [app, version])

  const nom = (id: string | null) => employes.find((e) => e.id === id)?.nom ?? '—'
  const heures = pointages ? heuresParEmploye(pointages) : []

  return (
    <div className="pointeuse">
      <div className="barre-salle">
        <button type="button" className="lien" onClick={onRetour}>{t('‹ Salle')}</button>
        <strong>{t('Pointeuse')}</strong>
        <button type="button" className="principal" onClick={() => setPointer(true)}>
          {t('Pointer')}
        </button>
      </div>

      <p className="portee-caisse">{t('Les pointages de')}{' '}<strong>{t('cette caisse')}</strong>{' '}{t('aujourd’hui. Les heures de toute l’équipe sont au back-office, « Heures travaillées ».')}</p>

      {pointages === null ? (
        <p className="indication-vide">{t('Lecture des pointages…')}</p>
      ) : pointages.length === 0 ? (
        <p className="indication-vide">{t('Personne n’a encore pointé sur cette caisse aujourd’hui.')}</p>
      ) : (
        <>
          <ul className="liste-heures">
            {heures.map((h) => (
              <li key={h.employeId ?? '—'}>
                <strong>{nom(h.employeId)}</strong>
                <span className="duree">{formaterDuree(h.minutes)}</span>
                {h.enCours > 0 && <span className="badge ouverte">{t('présent')}</span>}
                {h.aVerifier > 0 && <span className="badge alerte">{t('à vérifier')}</span>}
              </li>
            ))}
          </ul>
          <ul className="liste-pointages">
            {pointages.map((p) => {
              const etat = etatPointage(p)
              return (
                <li key={p.id} className={etat}>
                  <span>{nom(p.employeId)}</span>
                  <span className="plage">
                    {`⁦${heure(p.arriveeA)} → ${p.sortieA ? heure(p.sortieA) : '…'}⁩`}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {pointer && <ModalePointeuse onFermer={() => setPointer(false)} />}
    </div>
  )
}
