'use client'

/**
 * Saisir l'heure de sortie d'un pointage resté ouvert — une ligne, un champ.
 *
 * Le champ est une heure LOCALE de l'établissement ; l'action la convertit
 * dans son fuseau (`instantLocal`), jamais dans celui du navigateur ni du
 * serveur.
 */

import { useActionState } from 'react'
import { corrigerSortie, type Resultat } from '../app/[restaurant]/heures/actions.js'
import { useT } from '../i18n/client.js'

export function CorrectionSortie({
  restaurantId,
  pointageId,
  valeurInitiale,
}: {
  restaurantId: string
  pointageId: string
  /** « AAAA-MM-JJTHH:mm », heure locale de l'établissement. */
  valeurInitiale: string
}) {
  const t = useT()
  const [resultat, action, enCours] = useActionState(
    corrigerSortie.bind(null, restaurantId, pointageId),
    null as Resultat | null,
  )
  return (
    <form action={action} className="correction-sortie">
      <input
        type="datetime-local"
        name="sortie"
        defaultValue={valeurInitiale}
        aria-label={t('Heure de sortie')}
        required
      />
      <button type="submit" className="discret" disabled={enCours}>{t('Corriger la sortie')}</button>
      {resultat?.erreur && <span className="message erreur">{t.m(resultat.erreur)}</span>}
      {resultat?.succes && <span className="message succes">{t.m(resultat.succes)}</span>}
    </form>
  )
}
