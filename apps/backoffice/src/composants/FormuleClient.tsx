'use client'

/** Gratuit / Payant pour UN client, sur l'écran de l'éditeur. */

import { useState, useTransition } from 'react'
import { changerFormuleClient } from '../app/editeur/actions.js'
import { useT } from '../i18n/client.js'

export function FormuleClient({
  organizationId,
  planActuel,
}: {
  organizationId: string
  planActuel: string
}) {
  const t = useT()
  const [resultat, setResultat] = useState<{ erreur?: string; succes?: string }>({})
  const [enCours, demarrer] = useTransition()
  const choisir = (formule: 'gratuit' | 'pro') =>
    demarrer(async () => setResultat(await changerFormuleClient(organizationId, formule)))

  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <button
        type="button"
        className="discret"
        disabled={enCours || planActuel === 'gratuit'}
        onClick={() => choisir('gratuit')}
      >{t('Gratuit')}</button>
      <button
        type="button"
        className="discret"
        disabled={enCours || planActuel === 'pro'}
        onClick={() => choisir('pro')}
      >{t('Payant')}</button>
      {resultat.erreur && <span className="ecart negatif">{t.m(resultat.erreur)}</span>}
    </div>
  )
}
