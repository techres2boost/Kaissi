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

      {vue === 'salle' ? (
        <div className="grille-tables">
          {tables.map((t) => {
            const commande = parTable.get(t.id)
            return (
              <button
                key={t.id}
                type="button"
                className={`table ${commande ? 'occupee' : 'libre'}`}
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
                    <span className={`badge ${commande.statut}`}>
                      {libelleStatut(commande.statut as StatutCommande)}
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
              <span className={`badge ${c.statut}`}>
                {libelleStatut(c.statut as StatutCommande)}
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
                <span className={`badge ${c.statut}`}>
                  {libelleStatut(c.statut as StatutCommande)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
