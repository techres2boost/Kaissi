'use client'

/**
 * Les réductions de la maison — « Happy hour », « Personnel ».
 *
 * ── Ce que cet écran achète ───────────────────────────────────────────────
 *
 * Un nom. « 12 % sur la table 4 » ne se juge pas : happy hour, geste
 * commercial, personnel de la maison, ce sont trois décisions différentes, et
 * le rapport ne pouvait pas les distinguer. Déclarées ici, elles se
 * choisissent d'un geste sur la caisse et se regroupent dans le rapport.
 *
 * ── Ce qu'il n'achète PAS ─────────────────────────────────────────────────
 *
 * Aucun droit. Le plafond de remise reste celui du RÔLE : une réduction à
 * 50 % demandera toujours l'autorisation d'un responsable, qu'elle soit
 * déclarée ici ou tapée à la main.
 */

import { useActionState, useState, useTransition } from 'react'
import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import {
  archiverReduction,
  creerReduction,
  modifierReduction,
  type Resultat,
} from '../app/[restaurant]/reductions/gestion/actions.js'
import { useT } from '../i18n/client.js'

export interface Reduction {
  id: string
  nom: string
  type: 'pourcentage' | 'montant'
  valeurBp: number | null
  montantMillimes: number | null
  position: number
  archivee: boolean
}

function valeurLisible(r: Reduction): string {
  return r.type === 'montant'
    ? `− ${formaterTND(millimes(r.montantMillimes ?? 0))}`
    : `− ${formaterPourcentage(r.valeurBp ?? 0)} %`
}

/** La valeur telle qu'un champ doit l'afficher : « 10 », « 12,5 », « 2,000 ». */
function pourChamp(r: Reduction): string {
  if (r.type === 'pourcentage') return formaterPourcentage(r.valeurBp ?? 0)
  const m = r.montantMillimes ?? 0
  return `${Math.floor(m / 1000)},${String(m % 1000).padStart(3, '0')}`
}

function LigneReduction({
  restaurantId,
  reduction,
}: {
  restaurantId: string
  reduction: Reduction
}) {
  const t = useT()
  const [resultat, action] = useActionState(
    modifierReduction.bind(null, restaurantId, reduction.id, reduction.type),
    null as Resultat | null,
  )
  return (
    <form
      action={action}
      style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <input
        name="nom"
        defaultValue={reduction.nom}
        aria-label={t('Nom de la réduction {nom}', { nom: reduction.nom })}
        style={{ maxWidth: '14rem' }}
        maxLength={60}
      />
      <input
        name="valeur"
        defaultValue={pourChamp(reduction)}
        aria-label={
          reduction.type === 'pourcentage'
            ? t('Pourcentage de {nom}', { nom: reduction.nom })
            : t('Montant de {nom}, en dinars', { nom: reduction.nom })
        }
        inputMode="decimal"
        style={{ maxWidth: '6rem', textAlign: 'end' }}
      />
      <span className="detail">{reduction.type === 'pourcentage' ? '%' : 'TND'}</span>
      <button type="submit" className="discret">{t('Enregistrer')}</button>
      {resultat?.erreur && <span className="ecart negatif">{t.m(resultat.erreur)}</span>}
      {resultat?.succes && <span className="detail">{t('Enregistrée.')}</span>}
    </form>
  )
}

export function GestionReductions({
  restaurantId,
  modifiable,
  reductions,
}: {
  restaurantId: string
  modifiable: boolean
  reductions: Reduction[]
}) {
  const t = useT()
  const [type, setType] = useState<'pourcentage' | 'montant'>('pourcentage')
  const [resultat, action, enCours] = useActionState(
    creerReduction.bind(null, restaurantId),
    null as Resultat | null,
  )
  const [message, setMessage] = useState<Resultat | null>(null)
  const [bascule, demarrer] = useTransition()

  const actives = reductions.filter((r) => !r.archivee)
  const archivees = reductions.filter((r) => r.archivee)

  return (
    <>
      {resultat?.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
      {resultat?.succes && <p className="message succes">{t.m(resultat.succes)}</p>}
      {message?.erreur && <p className="message erreur">{t.m(message.erreur)}</p>}
      {message?.succes && <p className="message succes">{t.m(message.succes)}</p>}

      <section className="carte">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
          {/* « En service », et non « Réductions » : le titre de la page le
              dit déjà, et le mot répété deux fois de suite ne se lit plus.
              Il fait surtout pendant à « Archivées », plus bas. */}
          <h2 style={{ marginBottom: 0 }}>{t('En service')}</h2>
          <span className="etiquette">{actives.length}</span>
        </div>
        <p className="indication">{t('Elles apparaissent sur la caisse, au moment de la remise. La saisie libre reste possible : un geste commercial n’entre dans aucune case, et il se décide devant un client qui attend.')}</p>

        {actives.length === 0 ? (
          <p className="vide">{t('Aucune réduction déclarée. La caisse ne propose alors que la saisie libre — et le rapport ne peut pas dire pourquoi une remise a été accordée.')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('Réduction')}</th>
                <th className="nombre">{t('Valeur')}</th>
                {modifiable && <th />}
              </tr>
            </thead>
            <tbody>
              {actives.map((r) => (
                <tr key={r.id}>
                  <td>
                    {modifiable ? (
                      <LigneReduction restaurantId={restaurantId} reduction={r} />
                    ) : (
                      r.nom
                    )}
                  </td>
                  <td className="nombre">{valeurLisible(r)}</td>
                  {modifiable && (
                    <td style={{ textAlign: 'end' }}>
                      <button
                        type="button"
                        className="discret danger"
                        disabled={bascule}
                        onClick={() =>
                          demarrer(async () =>
                            setMessage(await archiverReduction(restaurantId, r.id, true)),
                          )
                        }
                      >{t('Archiver')}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {modifiable && (
          <form action={action} style={{ marginTop: '1rem' }}>
            <div className="champs deux">
              <div className="champ">
                <label htmlFor="nom-reduction">{t('Nouvelle réduction')}</label>
                <input
                  id="nom-reduction"
                  name="nom"
                  placeholder={t('Happy hour')}
                  maxLength={60}
                  required
                />
              </div>
              <div className="champ">
                <label htmlFor="type-reduction">{t('Type')}</label>
                <select
                  id="type-reduction"
                  name="type"
                  value={type}
                  onChange={(e) => setType(e.target.value as 'pourcentage' | 'montant')}
                >
                  <option value="pourcentage">{t('Pourcentage')}</option>
                  <option value="montant">{t('Montant fixe')}</option>
                </select>
              </div>
            </div>

            {/*
              Un seul des deux champs est demandé. Les afficher tous les deux
              laisserait choisir lequel compte — et la base refuse une ligne
              qui porterait les deux, ce qui donnerait une erreur cryptique.
            */}
            {type === 'pourcentage' ? (
              <div className="champ">
                <label htmlFor="pourcentage">{t('Pourcentage')}</label>
                <input
                  id="pourcentage"
                  name="pourcentage"
                  inputMode="decimal"
                  placeholder="10"
                  required
                />
                <p className="indication">{t('En pour-cent, sans le signe. « 12,5 » est accepté.')}</p>
              </div>
            ) : (
              <div className="champ">
                <label htmlFor="montant">{t('Montant')}</label>
                <input id="montant" name="montant" inputMode="decimal" placeholder="2.000" required />
                <p className="indication">{t('En dinars, avec')}{' '}<strong>{t('trois')}</strong>{' '}{t('décimales.')}</p>
              </div>
            )}

            <input
              type="hidden"
              name="position"
              value={String(reductions.reduce((m, r) => Math.max(m, r.position), 0) + 1)}
            />
            <button type="submit" disabled={enCours}>
              {enCours ? t('Création…') : t('Créer la réduction')}
            </button>
          </form>
        )}
      </section>

      {modifiable && archivees.length > 0 && (
        <section className="carte">
          <h2>{t('Archivées')}</h2>
          <p className="indication">{t('Archiver n’est pas supprimer : les ventes déjà encaissées portent cette réduction, et le rapport continue de les regrouper.')}</p>
          <table>
            <tbody>
              {archivees.map((r) => (
                <tr key={r.id}>
                  <td>{r.nom}</td>
                  <td className="nombre">{valeurLisible(r)}</td>
                  <td style={{ textAlign: 'end' }}>
                    <button
                      type="button"
                      className="discret"
                      disabled={bascule}
                      onClick={() =>
                        demarrer(async () =>
                          setMessage(await archiverReduction(restaurantId, r.id, false)),
                        )
                      }
                    >{t('Remettre')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
