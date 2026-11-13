'use client'

/**
 * Suivre un incident : le prendre en charge, le résoudre, le rouvrir.
 *
 * La note est facultative mais c'est elle qui fait l'historique : « résolu »
 * sans un mot ne dit pas, trois semaines plus tard, ce qui avait été fait.
 * Qui agit n'est PAS envoyé d'ici : le service relit l'adresse du compte
 * connecté.
 */

import { useState, useTransition } from 'react'
import { traiterIncident } from '../app/editeur/actions.js'
import { useT } from '../i18n/client.js'

export function ActionsIncident({
  id,
  statut,
}: {
  id: string
  statut: 'ouvert' | 'pris_en_charge' | 'resolu'
}) {
  const t = useT()
  const [note, setNote] = useState('')
  const [resultat, setResultat] = useState<{ erreur?: string; succes?: string }>({})
  const [enCours, demarrer] = useTransition()
  const agir = (action: 'prendre_en_charge' | 'resoudre' | 'rouvrir') =>
    demarrer(async () => {
      const r = await traiterIncident(id, action, note)
      setResultat(r)
      if (r.succes) setNote('')
    })

  return (
    <div className="actions-incident">
      <input
        type="text"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('Note de suivi (facultative)')}
        aria-label={t('Note de suivi (facultative)')}
      />
      <div className="actions-incident-boutons">
        {statut === 'ouvert' && (
          <button type="button" className="discret" disabled={enCours} onClick={() => agir('prendre_en_charge')}>
            {t('Prendre en charge')}
          </button>
        )}
        {statut !== 'resolu' ? (
          <button type="button" disabled={enCours} onClick={() => agir('resoudre')}>
            {t('Marquer résolu')}
          </button>
        ) : (
          <button type="button" className="discret" disabled={enCours} onClick={() => agir('rouvrir')}>
            {t('Rouvrir')}
          </button>
        )}
      </div>
      {resultat.erreur && <span className="ecart negatif">{t.m(resultat.erreur)}</span>}
      {resultat.succes && <span className="indication">{t.m(resultat.succes)}</span>}
    </div>
  )
}
