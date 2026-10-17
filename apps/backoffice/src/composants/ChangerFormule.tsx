'use client'

/**
 * Les deux boutons de formule — affichés à l'ÉDITEUR seulement.
 *
 * Les masquer aux autres n'interdit rien : c'est le service qui refuse.
 * On ne les montre pas pour ne pas proposer un geste qui échouerait.
 */

import { useState, useTransition } from 'react'
import { changerFormule, type ResultatFormule } from '../app/[restaurant]/abonnement/actions.js'
import { useT } from '../i18n/client.js'

export function ChangerFormule({
  restaurant,
  planActuel,
}: {
  restaurant: string
  planActuel: string
}) {
  const t = useT()
  const [resultat, setResultat] = useState<ResultatFormule>({})
  const [enCours, demarrer] = useTransition()

  const choisir = (formule: 'gratuit' | 'pro') =>
    demarrer(async () => {
      setResultat(await changerFormule(restaurant, formule))
    })

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={planActuel === 'gratuit' ? 'discret' : undefined}
          disabled={enCours || planActuel === 'gratuit'}
          onClick={() => choisir('gratuit')}
        >{t('Passer en Gratuit')}</button>
        <button
          type="button"
          className={planActuel === 'pro' ? 'discret' : 'principal'}
          disabled={enCours || planActuel === 'pro'}
          onClick={() => choisir('pro')}
        >{t('Passer en Payant')}</button>
      </div>
      {resultat.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
      {resultat.succes && <p className="message succes">{t.m(resultat.succes)}</p>}
    </div>
  )
}
