'use client'

/**
 * L'en-tête et le pied du ticket client.
 *
 * ── Pourquoi un APERÇU à côté du formulaire ──────────────────────────────
 *
 * Un ticket de 80 mm fait 42 caractères de large. Une adresse saisie dans un
 * champ de trois cents pixels paraît courte et sort sur quatre lignes à
 * l'impression — et on ne le découvre qu'avec un rouleau entre les mains.
 * L'aperçu est monospacé et borné à la largeur réelle : ce qui déborde ici
 * débordera là-bas.
 */

import { useActionState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { enregistrerRecu, type Resultat } from '../app/[restaurant]/recu/actions.js'
import { useT } from '../i18n/client.js'

export interface Recu {
  nom: string
  adresse: string | null
  telephone: string | null
  fiscal: string | null
  pied: string | null
}

/** 42 caractères : la largeur utile d'un rouleau de 80 mm en police normale. */
const LARGEUR_TICKET = 42

function Apercu({ recu }: { recu: Recu }) {
  const t = useT()
  const lignes = [
    recu.nom,
    ...(recu.adresse ? recu.adresse.split('\n') : []),
    ...(recu.telephone ? [recu.telephone] : []),
    ...(recu.fiscal ? [`MF ${recu.fiscal}`] : []),
  ]
  const pied = (recu.pied ?? '').split('\n').filter((l) => l.trim() !== '')

  return (
    <div className="apercu-ticket" aria-label={t('Aperçu du ticket')}>
      {lignes.map((l, i) => (
        <div key={`h${i}`} className={l.length > LARGEUR_TICKET ? 'trop-long' : ''}>
          {l}
        </div>
      ))}
      <div className="apercu-separateur">{'─'.repeat(LARGEUR_TICKET)}</div>
      <div className="apercu-corps">{t('… articles, total, paiement …')}</div>
      <div className="apercu-separateur">{'─'.repeat(LARGEUR_TICKET)}</div>
      {pied.length === 0 ? (
        <div className="apercu-defaut">Merci de votre visite !</div>
      ) : (
        pied.map((l, i) => (
          <div key={`p${i}`} className={l.length > LARGEUR_TICKET ? 'trop-long' : ''}>
            {l}
          </div>
        ))
      )}
    </div>
  )
}

export function ReglagesRecu({
  restaurantId,
  modifiable,
  recu,
}: {
  restaurantId: string
  modifiable: boolean
  recu: Recu
}) {
  const t = useT()
  const [resultat, action] = useActionState(
    enregistrerRecu.bind(null, restaurantId),
    null as Resultat | null,
  )

  return (
    <div className="reglages-recu">
      <form action={action} className="carte formulaire-taux">
        <label htmlFor="recu-adresse">{t('Adresse')}</label>
        <textarea
          id="recu-adresse"
          name="adresse"
          rows={2}
          maxLength={200}
          defaultValue={recu.adresse ?? ''}
          disabled={!modifiable}
          placeholder={t('12 rue du Lac, Tunis')}
        />

        <label htmlFor="recu-tel">{t('Téléphone')}</label>
        <input
          id="recu-tel"
          name="telephone"
          maxLength={40}
          defaultValue={recu.telephone ?? ''}
          disabled={!modifiable}
          placeholder="+216 71 000 000"
        />

        <label htmlFor="recu-fiscal">{t('Identifiant fiscal')}</label>
        <input
          id="recu-fiscal"
          name="fiscal"
          maxLength={60}
          defaultValue={recu.fiscal ?? ''}
          disabled={!modifiable}
        />
        {/*
          ⚠ Le champ existe ; son format et son caractère obligatoire ne sont
            PAS affirmés par Kaissi. Les écrire ici en exemple les donnerait
            pour acquis.
        */}
        <p className="aide">
          <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{' '}{t('Kaissi n’impose aucun format et n’affirme pas que cette mention est obligatoire — vérifiez-le avec votre comptable.')}</p>

        <label htmlFor="recu-pied">{t('Pied de page')}</label>
        <textarea
          id="recu-pied"
          name="pied"
          rows={3}
          maxLength={400}
          defaultValue={recu.pied ?? ''}
          disabled={!modifiable}
          placeholder="Merci de votre visite !"
        />
        <p className="aide">{t('Une ligne par retour à la ligne. Vide : « Merci de votre visite ! ».')}</p>

        {modifiable && (
          <button type="submit" className="principal">{t('Enregistrer')}</button>
        )}
        {resultat?.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
        {resultat?.succes && <p className="message succes">{t.m(resultat.succes)}</p>}
      </form>

      <div className="carte">
        <h2>{t('Aperçu')}</h2>
        <p className="aide">{t('Largeur réelle d’un rouleau de 80 mm. Une ligne trop longue est signalée : à l’impression, elle repart à la ligne.')}</p>
        <Apercu recu={recu} />
      </div>
    </div>
  )
}
