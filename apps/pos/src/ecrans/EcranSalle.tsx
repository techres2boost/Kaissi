/**
 * Écran d'accueil du service : tables, commandes en cours, à emporter.
 *
 * C'est l'écran le plus regardé de la journée. Il répond en un coup d'œil à
 * « quelles tables sont occupées » et « qu'est-ce qui attend d'être encaissé ».
 */

import { useEffect, useState } from 'react'
import { formaterTND, libelleStatut, millimes, type StatutCommande } from '@kaissi/domain'
import type { CommandeOuverte } from '@kaissi/db-local'
import { useApp } from '../etat/contexte.js'

interface Props {
  readonly onOuvrirCommande: (orderId: string) => void
  readonly onNouvelleCommande: (tableId: string | null) => void
}

export function EcranSalle({ onOuvrirCommande, onNouvelleCommande }: Props) {
  const { app, tables, version } = useApp()
  const [ouvertes, setOuvertes] = useState<CommandeOuverte[]>([])
  const [vue, setVue] = useState<'salle' | 'commandes'>('salle')

  useEffect(() => {
    let vivant = true
    void app.caisse.commandesOuvertes().then((c) => vivant && setOuvertes(c))
    return () => {
      vivant = false
    }
  }, [app, version])

  const parTable = new Map(ouvertes.filter((c) => c.tableId).map((c) => [c.tableId!, c]))
  const aEmporter = ouvertes.filter((c) => !c.tableId)
  /*
   * Ce que la cuisine a annoncé PRÊT.
   *
   * C'est l'information que le serveur en salle n'avait pas : il repassait
   * devant la cuisine « au cas où ». Le marqueur descend par le catalogue
   * (migration 0029), donc il exige le réseau — mais son absence ne coûte
   * rien : on retombe exactement sur l'écran d'avant.
   */
  const pretes = ouvertes.filter((c) => c.preteA !== null)

  return (
    <div className="salle">
      <div className="barre-salle">
        <div className="onglets-vue" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={vue === 'salle'}
            className={vue === 'salle' ? 'actif' : ''}
            onClick={() => setVue('salle')}
          >
            Salle
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={vue === 'commandes'}
            className={vue === 'commandes' ? 'actif' : ''}
            onClick={() => setVue('commandes')}
          >
            Commandes ({ouvertes.length})
          </button>
        </div>

        <button
          type="button"
          className="principal"
          onClick={() => onNouvelleCommande(null)}
        >
          + À emporter
        </button>
      </div>

      {/*
        Le bandeau, et pas seulement les badges.
        
        Une pastille sur une tuile suppose qu'on REGARDE la grille. En plein
        service on ne la regarde pas : on la traverse. Le bandeau dit d'un
        coup ce qui attend d'être servi, et il disparaît dès qu'il n'y a plus
        rien — un bandeau permanent redevient du décor en deux jours.
      */}
      {pretes.length > 0 && (
        <div className="bandeau-prets">
          <strong>Prêt à servir</strong>
          {pretes.map((c) => (
            <button key={c.id} type="button" onClick={() => onOuvrirCommande(c.id)}>
              {c.tableLabel ? `Table ${c.tableLabel}` : (c.numeroTicket ?? 'À emporter')}
            </button>
          ))}
        </div>
      )}

      {vue === 'salle' ? (
        <div className="grille-tables">
          {tables.map((t) => {
            const commande = parTable.get(t.id)
            return (
              <button
                key={t.id}
                type="button"
                className={`table ${commande ? 'occupee' : 'libre'} ${
                  commande?.preteA ? 'prete' : ''
                }`}
                onClick={() =>
                  commande ? onOuvrirCommande(commande.id) : onNouvelleCommande(t.id)
                }
              >
                <span className="numero">{t.label}</span>
                <span className="places">{t.places} pl.</span>
                {commande ? (
                  <>
                    <span className="montant">
                      {formaterTND(millimes(commande.totalMillimes), { symbole: false })}
                    </span>
                    {/*
                      « Prêt » REMPLACE le statut au lieu de s'ajouter à lui.
                      Sur une tuile de cette taille, « Envoyée » et « Prêt »
                      côte à côte se lisent moins vite qu'un seul mot — et
                      c'est « Prêt » qui appelle un geste.
                    */}
                    <span
                      className={`badge ${commande.preteA ? 'pret' : commande.statut}`}
                    >
                      {commande.preteA
                        ? 'Prêt'
                        : libelleStatut(commande.statut as StatutCommande)}
                    </span>
                  </>
                ) : (
                  <span className="libre-libelle">Libre</span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="liste-commandes">
          {ouvertes.length === 0 && (
            <p className="vide">Aucune commande en cours. Touchez une table pour commencer.</p>
          )}
          {ouvertes.map((c) => (
            <button key={c.id} type="button" onClick={() => onOuvrirCommande(c.id)}>
              <span className="ref">
                {c.tableLabel ? `Table ${c.tableLabel}` : 'À emporter'}
                <small>{c.numeroTicket ?? ''}</small>
              </span>
              <span className="articles">{c.nombreArticles} art.</span>
              <span className={`badge ${c.preteA ? 'pret' : c.statut}`}>
                {c.preteA ? 'Prêt' : libelleStatut(c.statut as StatutCommande)}
              </span>
              <span className="montant">{formaterTND(millimes(c.totalMillimes))}</span>
            </button>
          ))}
        </div>
      )}

      {vue === 'salle' && aEmporter.length > 0 && (
        <div className="bande-emporter">
          <h3>À emporter</h3>
          <div className="liste-emporter">
            {aEmporter.map((c) => (
              <button key={c.id} type="button" onClick={() => onOuvrirCommande(c.id)}>
                <span className="ref">{c.numeroTicket ?? '—'}</span>
                <span className="montant">
                  {formaterTND(millimes(c.totalMillimes), { symbole: false })}
                </span>
                <span className={`badge ${c.preteA ? 'pret' : c.statut}`}>
                  {c.preteA ? 'Prêt' : libelleStatut(c.statut as StatutCommande)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
