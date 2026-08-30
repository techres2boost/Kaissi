/**
 * Encaissement.
 *
 * Gère le paiement partiel et le paiement mixte (espèces + carte), parce que
 * c'est ce qui se passe réellement : un client paie 20 dinars en espèces et
 * le reste par carte, et la caisse doit suivre sans acrobatie.
 *
 * Le rendu de monnaie vient de `calculerRendu` — jamais d'une soustraction
 * écrite ici.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  calculerRendu,
  calculerTotaux,
  depuisDecimal,
  formaterTND,
  millimes,
  suggestionsEspeces,
  type EtatCommande,
  type Millimes,
  type ModePaiement,
} from '@kaissi/domain'
import { rendreTicketClient } from '@kaissi/printing'
import { useApp } from '../etat/contexte.js'
import { RefusOperation } from '../donnees/session.js'
import { Modale } from '../composants/Modale.js'
import { PaveNumerique } from '../composants/PaveNumerique.js'
import { TicketEcran } from '../composants/TicketEcran.js'
import { IMPRESSION_ACTIVE } from '../config.js'

interface Props {
  readonly orderId: string
  readonly onRetour: () => void
  readonly onTermine: () => void
}

export function EcranPaiement({ orderId, onRetour, onTermine }: Props) {
  const app = useApp()
  const { session, employe, config, methodesPaiement, tables, stations } = app

  const [etat, setEtat] = useState<EtatCommande | null>(null)
  const [methodeId, setMethodeId] = useState<string | null>(null)
  const [saisie, setSaisie] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  /**
   * Ticket de la vente qui vient d'être close, tant que le caissier ne l'a
   * pas fermé. La vente est DÉJÀ enregistrée à ce stade : fermer cette
   * fenêtre ne peut plus rien annuler, elle ne fait que rendre la caisse.
   */
  const [ticketEmis, setTicketEmis] = useState<Uint8Array | null>(null)

  const recharger = useCallback(async () => {
    setEtat(await session.etatDe(orderId))
  }, [session, orderId])

  useEffect(() => {
    void recharger()
    setMethodeId(methodesPaiement[0]?.id ?? null)
  }, [recharger, methodesPaiement])

  const totaux = useMemo(() => {
    if (!etat) return null
    return calculerTotaux({
      lignes: etat.lignes,
      remiseGlobale: etat.remiseGlobale ?? undefined,
      config,
    })
  }, [etat, config])

  const verse = useMemo(
    () =>
      millimes(
        (etat?.paiements ?? [])
          .filter((p) => !p.annule)
          .reduce((total, p) => total + p.montantMillimes, 0),
      ),
    [etat],
  )

  const encaissement = totaux ? calculerRendu(totaux.totalMillimes, verse) : null
  const resteDu = encaissement?.resteDuMillimes ?? millimes(0)

  /**
   * Monnaie à rendre = somme des rendus enregistrés sur chaque paiement.
   *
   * Surtout PAS `total − versé` : le versé ne compte que ce qui est IMPUTÉ à
   * la commande. Un client qui tend 11 dinars pour 10,100 verrait « rendu
   * 0,000 » et repartirait sans ses 900 millimes.
   */
  const aRendre = millimes(
    (etat?.paiements ?? [])
      .filter((p) => !p.annule)
      .reduce((total, p) => total + (p.renduMillimes ?? 0), 0),
  )
  const methode = methodesPaiement.find((m) => m.id === methodeId) ?? null

  // Ce que le caissier a tapé, ou le reste dû s'il n'a rien tapé.
  const montantSaisi: Millimes =
    saisie === '' ? resteDu : depuisDecimal(saisie)

  const enregistrer = async (montant: Millimes, recu?: Millimes) => {
    if (!methode || !totaux || montant <= 0) return
    setEnCours(true)
    try {
      // Un versement supérieur au reste dû n'est pas encaissé en trop :
      // on impute le reste dû, la différence devient de la monnaie rendue.
      const impute = millimes(Math.min(montant, resteDu))
      const rendu = millimes(Math.max((recu ?? montant) - impute, 0))
      await session.enregistrerPaiement(employe, orderId, {
        methodeId: methode.id,
        mode: methode.type as ModePaiement,
        montantMillimes: impute,
        recuMillimes: recu ?? impute,
        renduMillimes: rendu,
      })
      setSaisie('')
      await recharger()
      app.rafraichir()
    } catch (e) {
      setMessage(
        e instanceof RefusOperation || e instanceof Error ? e.message : String(e),
      )
    } finally {
      setEnCours(false)
    }
  }

  const cloturer = async () => {
    if (!totaux) return
    setEnCours(true)
    try {
      const libelleTable = tables.find((t) => t.id === etat?.tableId)?.label ?? null
      const imprimante = [...stations.values()].find((s) => s.hote) ?? null
      const especes = (etat?.paiements ?? []).some((p) => !p.annule && p.mode === 'cash')
      const { ticket } = await session.cloturer(employe, orderId, {
        libellesPaiement: Object.fromEntries(methodesPaiement.map((m) => [m.id, m.nom])),
        libelleTable,
        hoteImprimante: imprimante?.hote ?? null,
        portImprimante: imprimante?.port,
        ouvrirTiroir: especes,
        imprimer: true,
      })
      app.rafraichir()
      // Impression allumée : le ticket part en file et la caisse enchaîne.
      // Éteinte (MVP) : on l'affiche, et c'est le caissier qui enchaîne.
      if (IMPRESSION_ACTIVE) {
        onTermine()
      } else {
        setTicketEmis(rendreTicketClient(ticket, { ouvrirTiroir: false }))
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setEnCours(false)
    }
  }

  if (!etat || !totaux || !encaissement) {
    return (
      <div className="ecran-centre">
        <div className="pastille-chargement" aria-hidden="true" />
      </div>
    )
  }

  const suggestions = methode?.type === 'cash' ? suggestionsEspeces(resteDu) : []
  const paiementsVivants = etat.paiements.filter((p) => !p.annule)

  return (
    <div className="paiement">
      <section className="colonne-recap">
        <button type="button" className="retour" onClick={onRetour}>
          ‹ Commande
        </button>

        <div className="bloc-total">
          <span className="libelle">Total à payer</span>
          <span className="valeur">{formaterTND(totaux.totalMillimes)}</span>
        </div>

        {paiementsVivants.length > 0 && (
          <ul className="paiements-faits">
            {paiementsVivants.map((p) => (
              <li key={p.id}>
                <span>{methodesPaiement.find((m) => m.id === p.methodeId)?.nom ?? p.mode}</span>
                <span>{formaterTND(p.montantMillimes)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={`bloc-reste ${encaissement.solde ? 'solde' : ''}`}>
          <span className="libelle">
            {encaissement.solde ? 'Monnaie à rendre' : 'Reste à payer'}
          </span>
          <span className="valeur">
            {formaterTND(encaissement.solde ? aRendre : encaissement.resteDuMillimes)}
          </span>
        </div>

        {encaissement.solde && (
          <button
            type="button"
            className="principal grand"
            disabled={enCours}
            onClick={() => void cloturer()}
          >
            {enCours ? 'Clôture…' : IMPRESSION_ACTIVE ? 'Encaisser et imprimer' : 'Encaisser'}
          </button>
        )}
      </section>

      <section className="colonne-saisie">
        <div className="modes">
          {methodesPaiement.map((m) => (
            <button
              key={m.id}
              type="button"
              className={methodeId === m.id ? 'actif' : ''}
              onClick={() => setMethodeId(m.id)}
            >
              {m.nom}
            </button>
          ))}
        </div>

        {!encaissement.solde && (
          <>
            {suggestions.length > 0 && (
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void enregistrer(millimes(Math.min(s, resteDu)), s)}
                    disabled={enCours}
                  >
                    {formaterTND(s, { symbole: false })}
                  </button>
                ))}
              </div>
            )}

            <div className="montant-saisi">
              <span className="libelle">Montant reçu</span>
              <span className="valeur">{formaterTND(montantSaisi)}</span>
            </div>

            <PaveNumerique
              valeur={saisie}
              onChange={setSaisie}
              decimale
              onValider={() => void enregistrer(montantSaisi, montantSaisi)}
              libelleValider="Encaisser"
              validerActif={!enCours && montantSaisi > 0}
            />
          </>
        )}
      </section>

      {message && (
        <Modale titre="Opération refusée" onFermer={() => setMessage(null)}>
          <p>{message}</p>
        </Modale>
      )}

      {ticketEmis && (
        <Modale titre="Ticket client" onFermer={onTermine}>
          <TicketEcran charge={ticketEmis} />
          <p className="aide">
            La vente est enregistrée. Montrez ce ticket au client, ou fermez
            simplement cette fenêtre.
          </p>
          <button type="button" className="principal grand" onClick={onTermine}>
            Terminer
          </button>
        </Modale>
      )}
    </div>
  )
}
