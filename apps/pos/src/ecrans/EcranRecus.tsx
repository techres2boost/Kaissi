/**
 * Les reçus — l'historique des ventes, sur la caisse.
 *
 * ── Pourquoi il ne DEMANDE rien au serveur ────────────────────────────────
 *
 * La question posée était « on interroge le serveur quand il est là, et on
 * met en cache ? ». La réponse est non, et ce n'est pas un raccourci : le
 * cycle de synchronisation TIRE déjà les événements de tous les terminaux
 * (`/sync/pull`, curseur `evenements`, depuis 0 à l'appairage) et les rejoue
 * en local. La base de cette tablette contient donc les ventes des AUTRES
 * caisses, projetées par le même code du domaine.
 *
 * Ajouter une requête serveur créerait une seconde vérité, une route, un
 * cache à invalider — et un écran qui se vide quand le réseau tombe, sur le
 * produit dont la règle est que la caisse ne s'arrête jamais.
 *
 * ── « Pas de décalage entre les systèmes » — ce qui est atteignable ───────
 *
 * Pas au sens strict : une vente encaissée hors ligne existe sur la tablette
 * et pas au back-office tant qu'elle n'est pas remontée. C'est la définition
 * même du hors-ligne d'abord, pas un défaut à corriger.
 *
 * Ce qui est atteignable, et qui vaut mieux : que l'écart soit NOMMÉ. Chaque
 * reçu non remonté porte « en attente ». Le gérant qui compare la caisse au
 * back-office voit alors la différence expliquée à l'écran, au lieu de
 * chercher une panne.
 */

import { useEffect, useState } from 'react'
import { formaterTND, millimes } from '@kaissi/domain'
import type { Recu } from '@kaissi/db-local'
import { useApp } from '../etat/contexte.js'
import { ModaleRecu } from '../composants/ModaleRecu.js'
import { dateLocale, libellePaiement, t } from '../i18n.js'

/** Bornée, comme la requête : un an de tickets ne tient pas dans une tablette. */
const PAR_PAGE = 100

export function EcranRecus({ onRetour }: { readonly onRetour: () => void }) {
  const { app, version } = useApp()
  const [recus, setRecus] = useState<Recu[] | null>(null)
  const [limite, setLimite] = useState(PAR_PAGE)
  // Le reçu ouvert : on le relit, on le rembourse.
  const [ouvert, setOuvert] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    void app.caisse.recus(limite).then((r) => vivant && setRecus(r))
    return () => {
      vivant = false
    }
  }, [app, version, limite])

  const enAttente = (recus ?? []).filter((r) => r.enAttente).length

  return (
    <div className="recus">
      <div className="barre-salle">
        <button type="button" className="lien" onClick={onRetour}>{t('‹ Salle')}</button>
        <strong>{t('Reçus')}</strong>
        {enAttente > 0 && (
          <span
            className="badge attente"
            title={
              t(
                '{n} vente(s) encaissée(s) ne sont pas encore remontées au back-office. Elles le seront dès que la caisse aura du réseau — rien n’est perdu.',
                { n: enAttente },
              )
            }
          >
            {enAttente}{' '}{t('en attente d’envoi')}</span>
        )}
      </div>

      {recus === null ? (
        <p className="indication-vide">{t('Lecture des ventes…')}</p>
      ) : recus.length === 0 ? (
        <p className="indication-vide">{t('Aucune vente encaissée pour l’instant. Les reçus des autres caisses apparaissent ici dès qu’elles se sont synchronisées.')}</p>
      ) : (
        <>
          <ul className="liste-recus">
            {recus.map((r) => (
              <li key={r.id} className={r.statut === 'annulee' ? 'annulee' : ''}>
                {/*
                  Toute la ligne est le bouton : sur une tablette, viser un
                  petit « détail » en bout de ligne se rate une fois sur trois.
                */}
                <button type="button" className="ouvrir-recu" onClick={() => setOuvert(r.id)}>
                <div className="ref">
                  <strong>{r.numeroTicket ?? `— ${t('sans numéro')} —`}</strong>
                  <small>
                    {heure(r.termineeA)}
                    {r.tableLabel ? ` · ${r.tableLabel}` : ` · ${t('À emporter')}`}
                    {r.employe ? ` · ${r.employe}` : ''}
                  </small>
                </div>
                <div className="detail">
                  <span className="articles">{t('{n} art.', { n: r.nombreArticles })}</span>
                  <span className="modes">{modes(r.paiements)}</span>
                </div>
                <div className="cote">
                  <span className="montant">{formaterTND(millimes(r.totalMillimes))}</span>
                  {r.statut === 'annulee' && <span className="badge">{t('Annulée')}</span>}
                  {/*
                    Le marqueur est posé À CÔTÉ DU MONTANT, pas dans un
                    en-tête : c'est le montant qu'on compare au back-office,
                    et c'est donc là que l'explication de l'écart doit être.
                  */}
                  {r.rembourseMillimes > 0 && (
                    <span className="badge rembourse">{t('remboursé')}{' '}{formaterTND(millimes(r.rembourseMillimes))}
                    </span>
                  )}
                  {r.enAttente && (
                    <span className="badge attente" title={t('Pas encore remontée au back-office')}>{t('en attente')}</span>
                  )}
                </div>
                </button>
              </li>
            ))}
          </ul>

          {ouvert && <ModaleRecu orderId={ouvert} onFermer={() => setOuvert(null)} />}

          {recus.length >= limite && (
            <button
              type="button"
              className="lien charger-plus"
              onClick={() => setLimite((l) => l + PAR_PAGE)}
            >{t('Afficher {n} reçus de plus', { n: PAR_PAGE })}</button>
          )}
        </>
      )}
    </div>
  )
}

/** « 2026-09-13T08:14:… » → « 08:14 ». L'heure suffit : la liste est du jour au plus ancien. */
function heure(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const aujourdhui = new Date().toDateString() === d.toDateString()
  const h = dateLocale(d, { hour: '2-digit', minute: '2-digit' })
  return aujourdhui ? h : `${dateLocale(d, { day: '2-digit', month: '2-digit' })} ${h}`
}

/** « cash,card » → « Espèces, Carte ». Une note partagée en porte plusieurs. */
function modes(bruts: string): string {
  if (!bruts) return '—'
  return bruts.split(',').map(libellePaiement).join(', ')
}
