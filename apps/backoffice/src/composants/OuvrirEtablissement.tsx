'use client'

/**
 * Le formulaire d'ouverture d'un établissement.
 *
 * ── Quatre champs, et pas un de plus ──────────────────────────────────────
 *
 * Un nom, un modèle, un fuseau, une heure de bascule. Ni adresse, ni
 * téléphone, ni identifiant fiscal : ce sont des champs qu'on remplit
 * plus tard, dans les réglages, et les demander ici transformerait une
 * création d'une minute en formulaire qu'on remet à demain.
 *
 * ── Ce que le modèle recopie, et ce qu'il ne recopie pas ──────────────────
 *
 * Les taux de taxe, les modes de paiement et les postes — c'est-à-dire tout
 * ce sans quoi une caisse ne peut RIEN encaisser. Pas la carte : on ne
 * devine pas un menu, et un restaurant qui ouvrirait avec les plats d'un
 * autre serait plus long à corriger qu'à saisir.
 */

import { useActionState } from 'react'
import Link from 'next/link'
/*
 * Deux imports, et la séparation est la correction elle-même : l'ACTION
 * vient du module `'use server'`, les CONSTANTES d'un module ordinaire. Les
 * mélanger a coûté un écran mort en production — voir `fuseaux.ts`.
 */
import { ouvrirEtablissement } from '../app/administration/actions.js'
import { FUSEAUX, type Resultat } from '../app/administration/fuseaux.js'
import { useT } from '../i18n/client.js'

export function OuvrirEtablissement({
  modeles,
}: {
  modeles: readonly { id: string; nom: string }[]
}) {
  const t = useT()
  const [resultat, action, enCours] = useActionState(
    ouvrirEtablissement,
    null as Resultat | null,
  )

  return (
    <section className="carte">
      <h2>{t('Ouvrir un établissement')}</h2>

      {resultat?.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
      {resultat?.succes && (
        <p className="message succes">
          {t.m(resultat.succes)}{' '}
          {resultat.restaurantId && (
            <Link href={{ pathname: `/${resultat.restaurantId}/catalogue` }}>{t('Saisir la carte →')}</Link>
          )}
        </p>
      )}

      <form action={action}>
        <div className="champs deux">
          <label className="champ">{t('Nom de l’établissement')}<input name="nom" placeholder={t('Snack Lac 2')} maxLength={200} required />
          </label>
          <label className="champ">{t('Reprendre les réglages de')}<select name="modele" defaultValue={modeles[0]?.id ?? ''}>
              {modeles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="champs deux">
          <label className="champ">{t('Fuseau horaire')}<select name="timezone" defaultValue="Africa/Tunis">
              {FUSEAUX.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="champ">{t('Bascule de la journée commerciale')}<input name="bascule" defaultValue="04:00" pattern="\d{2}:\d{2}" required />
            <span className="indication">{t('Une vente encaissée')}{' '}<strong>{t('avant')}</strong>{' '}{t('cette heure appartient à la journée de la veille. 04:00 est l’usage courant, pas une règle : un salon de thé qui ouvre à 6 h la voudra plus tôt.')}</span>
          </label>
        </div>

        <p className="indication">{t('Sont repris du modèle :')}{' '}<strong>{t('taux de taxe')}</strong>,{' '}
          <strong>{t('modes de paiement')}</strong>{' '}{t('et')}{' '}<strong>{t('postes de préparation')}</strong>{' '}{t('— sans eux, une caisse ne peut rien encaisser. La')}{' '}<strong>{t('carte')}</strong>{' '}{t('n’est pas copiée : elle se saisit, et vous en devenez automatiquement administrateur.')}</p>

        <button type="submit" className="principal" disabled={enCours}>
          {enCours ? t('Ouverture…') : t('Ouvrir l’établissement')}
        </button>
      </form>
    </section>
  )
}
