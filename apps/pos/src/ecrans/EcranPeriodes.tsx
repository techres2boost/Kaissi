/**
 * Périodes de travail — l'historique des services de CETTE caisse.
 *
 * ── Ce que cet écran ne prétend pas être ──────────────────────────────────
 *
 * Il ne montre que les services de ce terminal. Contrairement aux reçus,
 * dont les événements redescendent par `/sync/pull`, les services de caisse
 * sont POUSSÉS et jamais retirés : le protocole ne les fait pas redescendre.
 *
 * On aurait pu ajouter les shifts au pull et afficher un total
 * d'établissement. On ne l'a pas fait pour cette version, et surtout on ne
 * fait pas SEMBLANT : un total présenté comme celui du restaurant alors qu'il
 * ne couvre qu'une caisse est un chiffre faux — et l'écart de caisse est le
 * chiffre que le patron regarde. L'écran le dit donc, une fois, en haut.
 *
 * ── L'écart, et pourquoi il est affiché tel quel ──────────────────────────
 *
 * Un écart NÉGATIF n'est pas une anomalie de calcul : il manque de l'argent
 * dans le tiroir, et c'est précisément ce qu'on vient voir. Le borner, le
 * masquer ou l'afficher en valeur absolue reviendrait à effacer la seule
 * information utile de l'écran.
 */

import { useEffect, useState } from 'react'
import { ecartSignificatif, formaterTND, millimes } from '@kaissi/domain'
import type { PeriodeTravail } from '@kaissi/db-local'
import { useApp } from '../etat/contexte.js'
import { dateLocale, t } from '../i18n.js'

export function EcranPeriodes({ onRetour }: { readonly onRetour: () => void }) {
  const { app, version } = useApp()
  const [periodes, setPeriodes] = useState<PeriodeTravail[] | null>(null)

  useEffect(() => {
    let vivant = true
    void app.caisse.periodes().then((p) => vivant && setPeriodes(p))
    return () => {
      vivant = false
    }
  }, [app, version])

  return (
    <div className="periodes">
      <div className="barre-salle">
        <button type="button" className="lien" onClick={onRetour}>{t('‹ Salle')}</button>
        <strong>{t('Périodes de travail')}</strong>
      </div>

      <p className="portee-caisse">{t('Les services de')}{' '}<strong>{t('cette caisse')}</strong>{' '}{t('uniquement. Le total de l’établissement, toutes caisses confondues, est au back-office.')}</p>

      {periodes === null ? (
        <p className="indication-vide">{t('Lecture des services…')}</p>
      ) : periodes.length === 0 ? (
        <p className="indication-vide">{t('Aucun service ouvert sur cette caisse pour l’instant.')}</p>
      ) : (
        <ul className="liste-periodes">
          {periodes.map((p) => {
            const enCours = p.fermeeA === null
            const ecart = p.ecartMillimes
            return (
              <li key={p.id} className={enCours ? 'en-cours' : ''}>
                <div className="entete">
                  <strong>{plage(p.ouverteA, p.fermeeA)}</strong>
                  {enCours && <span className="badge ouverte">{t('en cours')}</span>}
                  {p.enAttente && !enCours && (
                    <span
                      className="badge attente"
                      title={t('Ce service n’est pas encore remonté au back-office.')}
                    >{t('en attente')}</span>
                  )}
                </div>

                <dl className="chiffres">
                  <div>
                    <dt>{t('Ouvert par')}</dt>
                    <dd>{p.ouvertePar ?? '—'}</dd>
                  </div>
                  <div>
                    {/*
                      La caisse porte le nom de qui l'a FERMÉE (migration
                      0027). Devant un écart, le nom qui compte est celui de
                      la personne qui a vu les billets ; afficher celui de
                      l'ouverture mettrait en cause quelqu'un parti depuis
                      quatre heures. « — » pour les services clos avant cette
                      migration : recopier l'autre nom inventerait une donnée
                      fausse qui aurait l'air juste.
                    */}
                    <dt>{t('Compté par')}</dt>
                    <dd>{p.fermeePar ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('Ventes')}</dt>
                    <dd>{p.nombreVentes}</dd>
                  </div>
                  <div>
                    <dt>{t('Encaissé')}</dt>
                    <dd>{formaterTND(millimes(p.chiffreAffairesMillimes))}</dd>
                  </div>
                  <div>
                    <dt>{t('Fond de caisse')}</dt>
                    <dd>{formaterTND(millimes(p.fondDeCaisseMillimes))}</dd>
                  </div>
                  {!enCours && (
                    <>
                      <div>
                        <dt>{t('Attendu')}</dt>
                        <dd>
                          {p.attenduMillimes === null
                            ? '—'
                            : formaterTND(millimes(p.attenduMillimes))}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('Compté')}</dt>
                        <dd>
                          {p.compteMillimes === null
                            ? '—'
                            : formaterTND(millimes(p.compteMillimes))}
                        </dd>
                      </div>
                      <div className={classeEcart(ecart)}>
                        <dt>{t('Écart')}</dt>
                        <dd>{ecart === null ? '—' : signe(ecart)}</dd>
                      </div>
                    </>
                  )}
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * L'écart est signalé À PARTIR d'un seuil, pas dès le premier millime.
 *
 * `ecartSignificatif` vit dans le domaine : c'est une règle, pas une
 * préférence d'affichage. Peindre en rouge un écart de 50 millimes
 * apprendrait à ignorer la couleur — et elle doit rester lisible le jour où
 * il manque vingt dinars.
 */
function classeEcart(ecart: number | null): string {
  if (ecart === null || ecart === 0) return ''
  return ecartSignificatif(millimes(ecart)) ? 'ecart-fort' : 'ecart-faible'
}

/** « +2,500 TND » / « −18,000 TND ». Le signe est l'information. */
function signe(ecart: number): string {
  const texte = formaterTND(millimes(Math.abs(ecart)))
  if (ecart === 0) return texte
  return `${ecart > 0 ? '+' : '−'}${texte}`
}

/** « 13/09 08:14 → 15:40 », ou « 13/09 08:14 → … » si le service est ouvert. */
function plage(ouverte: string, fermee: string | null): string {
  const d = new Date(ouverte)
  const jour = Number.isNaN(d.getTime())
    ? ouverte
    : dateLocale(d, { day: '2-digit', month: '2-digit' })
  const h = (iso: string) => {
    const x = new Date(iso)
    return Number.isNaN(x.getTime())
      ? '?'
      : dateLocale(x, { hour: '2-digit', minute: '2-digit' })
  }
  // Une PLAGE horaire se lit de gauche à droite dans les deux langues : la
  // flèche n'est pas un caractère miroir, et en arabe « 10:00 → 18:00 »
  // s'afficherait inversé, flèche pointant vers l'heure d'ouverture. On
  // l'isole (LRI … PDI) pour qu'elle reste un bloc.
  return `${jour} \u2066${h(ouverte)} → ${fermee ? h(fermee) : '…'}\u2069`
}
