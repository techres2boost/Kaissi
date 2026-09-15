'use client'

/**
 * Fermer, rouvrir, supprimer — les trois gestes du cycle de vie.
 *
 * ── Fermer n'est pas supprimer, et l'écran doit le faire sentir ───────────
 *
 * Les deux mots se confondent dans l'esprit de qui vient d'ouvrir un
 * établissement par erreur. Ils n'ont pourtant rien de commun :
 *
 *   • FERMER est réversible et garde tout. C'est le geste normal — un
 *     restaurant qui s'arrête, une saison qui se termine.
 *   • SUPPRIMER est définitif, et la base le REFUSE dès qu'une vente existe.
 *
 * L'écran propose donc la fermeture en premier, et ne montre la suppression
 * qu'après l'avoir demandée — puis, seulement si l'établissement est vraiment
 * vierge, ce qu'on va CHERCHER avant de l'afficher.
 */

import { useState, useTransition } from 'react'
import { Archive, ArchiveRestore, Trash2, TriangleAlert } from 'lucide-react'
import {
  changerStatutEtablissement,
  obstaclesSuppression,
  supprimerEtablissement,
} from '../app/administration/actions.js'
import type { Resultat } from '../app/administration/fuseaux.js'

export interface EtablissementCycle {
  id: string
  nom: string
  ferme: boolean
  fermeLe: string | null
  administrateur: boolean
  /** Faux quand c'est le seul établissement administré : on ne le supprime pas. */
  supprimable: boolean
}

interface Obstacles {
  ventes: number
  services: number
  evenements: number
  appareils: number
  audit: number
}

export function CycleEtablissement({ etablissement }: { etablissement: EtablissementCycle }) {
  const [enCours, demarrer] = useTransition()
  const [retour, setRetour] = useState<Resultat | null>(null)
  const [obstacles, setObstacles] = useState<Obstacles | null>(null)
  const [erreurObstacles, setErreurObstacles] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [panneau, setPanneau] = useState(false)

  if (!etablissement.administrateur) return null

  const bloque =
    obstacles !== null &&
    (obstacles.ventes > 0 || obstacles.evenements > 0 || obstacles.audit > 0)

  return (
    <div className="cycle-etablissement">
      <div className="actions-taux">
        <button
          type="button"
          className="discret"
          disabled={enCours}
          onClick={() =>
            demarrer(() => {
              void changerStatutEtablissement(
                etablissement.id,
                etablissement.ferme ? 'actif' : 'ferme',
              ).then(setRetour)
            })
          }
        >
          {etablissement.ferme ? (
            <>
              <ArchiveRestore size={15} strokeWidth={1.9} aria-hidden="true" /> Rouvrir
            </>
          ) : (
            <>
              <Archive size={15} strokeWidth={1.9} aria-hidden="true" /> Fermer
            </>
          )}
        </button>

        {!panneau && (
          <button
            type="button"
            className="discret"
            disabled={enCours}
            onClick={() => {
              setPanneau(true)
              setErreurObstacles(null)
              /*
               * On CHERCHE avant de proposer.
               *
               * Afficher le champ de confirmation puis répondre « impossible,
               * cet établissement a vendu » ferait retaper un nom pour rien.
               * Le compte arrive d'abord ; la suppression n'est proposée que
               * si elle est réellement possible.
               */
              demarrer(() => {
                void obstaclesSuppression(etablissement.id).then((r) => {
                  if (r.erreur) {
                    setErreurObstacles(r.erreur)
                    return
                  }
                  setObstacles({
                    ventes: r.ventes ?? 0,
                    services: r.services ?? 0,
                    evenements: r.evenements ?? 0,
                    appareils: r.appareils ?? 0,
                    audit: r.audit ?? 0,
                  })
                })
              })
            }}
          >
            <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" /> Supprimer…
          </button>
        )}
      </div>

      {panneau && (
        <div className="panneau-suppression">
          {erreurObstacles && <p className="message erreur">{erreurObstacles}</p>}

          {obstacles === null && !erreurObstacles && (
            <p className="indication">Vérification en cours…</p>
          )}

          {obstacles !== null && !etablissement.supprimable && (
            <p className="message avertissement">
              <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />{' '}
              <strong>C’est le seul établissement que vous administrez.</strong>{' '}
              Le supprimer vous laisserait un compte qui n’ouvre sur rien, et
              sans moyen d’en rouvrir un : l’ouverture exige un établissement
              modèle.
            </p>
          )}

          {obstacles !== null && etablissement.supprimable && bloque && (
            <div className="message avertissement">
              <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />{' '}
              <strong>Cet établissement ne peut pas être supprimé.</strong> Il
              porte {obstacles.ventes} vente(s), {obstacles.services} service(s)
              de caisse et {obstacles.audit} entrée(s) de journal d’audit. Ce
              sont des écritures comptables : elles ne se suppriment pas.
              <br />
              <strong>Fermez-le</strong> — il disparaît de l’exploitation,
              aucune nouvelle caisse ne peut y être mise en service, et ses
              données restent consultables.
            </div>
          )}

          {obstacles !== null && etablissement.supprimable && !bloque && (
            <>
              <p className="message avertissement">
                <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />{' '}
                <strong>Suppression définitive.</strong> Cet établissement n’a
                jamais rien encaissé. Seront supprimés : sa carte, ses
                catégories, ses postes, ses taux de taxe, ses modes de paiement
                {obstacles.appareils > 0
                  ? `, et ses ${obstacles.appareils} appareil(s) appairé(s)`
                  : ''}
                . C’est irréversible.
              </p>
              <label htmlFor={`conf-${etablissement.id}`}>
                Retapez <strong>{etablissement.nom}</strong> pour confirmer
              </label>
              <input
                id={`conf-${etablissement.id}`}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={etablissement.nom}
                autoComplete="off"
              />
              <p className="indication">
                {/*
                  Retaper plutôt que cocher : on coche par réflexe, on ne
                  retape pas un nom par réflexe — et le retaper oblige à lire
                  LEQUEL on supprime.
                */}
                Un nom à retaper plutôt qu’une case à cocher : cela oblige à
                lire lequel des établissements va disparaître.
              </p>
              <button
                type="button"
                className="danger-plein"
                disabled={enCours || confirmation.trim() !== etablissement.nom}
                onClick={() =>
                  demarrer(() => {
                    void supprimerEtablissement(etablissement.id, confirmation.trim()).then(
                      setRetour,
                    )
                  })
                }
              >
                Supprimer définitivement
              </button>
            </>
          )}

          <button
            type="button"
            className="discret"
            onClick={() => {
              setPanneau(false)
              setObstacles(null)
              setConfirmation('')
            }}
          >
            Annuler
          </button>
        </div>
      )}

      {retour?.erreur && <p className="message erreur">{retour.erreur}</p>}
      {retour?.succes && <p className="message succes">{retour.succes}</p>}
    </div>
  )
}
