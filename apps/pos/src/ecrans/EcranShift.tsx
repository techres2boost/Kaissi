/**
 * Ouverture et clôture de shift.
 *
 * Rien ne s'encaisse sans shift ouvert : sans lui, aucun écart de caisse
 * n'est calculable, et l'écart de caisse est LE chiffre que le patron
 * regarde. La clôture impose un comptage réel — jamais un simple « OK ».
 */

import { useEffect, useState } from 'react'
import {
  COUPURES_TND,
  depuisDecimal,
  ecartSignificatif,
  formaterTND,
  millimes,
  resumerShift,
  totaliserComptage,
  uuidV7,
  type ResumeShift,
  type Shift,
} from '@kaissi/domain'
import { rendreTicketShift } from '@kaissi/printing'
import { useApp } from '../etat/contexte.js'
import { PaveNumerique } from '../composants/PaveNumerique.js'

interface Props {
  readonly onOuvert: () => void
}

export function EcranOuvertureShift({ onOuvert }: Props) {
  const { app, employe, identite, rafraichir } = useApp()
  const [saisie, setSaisie] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const fond = saisie === '' ? millimes(0) : depuisDecimal(saisie)

  const ouvrir = async () => {
    if (!employe) return
    setEnCours(true)
    setErreur(null)
    try {
      const shiftId = uuidV7()
      await app.caisse.ouvrirShift({
        id: shiftId,
        organizationId: identite.organizationId,
        restaurantId: identite.restaurantId,
        deviceId: identite.deviceId,
        employeId: employe.id,
        caisseId: null,
        fondDeCaisseMillimes: fond,
      })
      await app.etat.ecrire('shift_courant', shiftId)
      rafraichir()
      onOuvert()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="ecran-centre">
      <div className="carte-action">
        <h1>Ouverture de caisse</h1>
        <p className="aide">
          Comptez le fond de caisse avant de commencer le service. C'est lui qui
          sert de référence à l'écart constaté ce soir.
        </p>

        <div className="montant-saisi">
          <span className="libelle">Fond de caisse</span>
          <span className="valeur">{formaterTND(fond)}</span>
        </div>

        {erreur && <p className="erreur">{erreur}</p>}

        <PaveNumerique
          valeur={saisie}
          onChange={setSaisie}
          decimale
          onValider={() => void ouvrir()}
          libelleValider={enCours ? 'Ouverture…' : 'Ouvrir la caisse'}
          validerActif={!enCours && employe !== null}
        />
      </div>
    </div>
  )
}

interface PropsCloture {
  readonly shift: Shift
  readonly onFerme: () => void
  readonly onAnnuler: () => void
}

export function EcranClotureShift({ shift, onFerme, onAnnuler }: PropsCloture) {
  const { app, employe, etablissement, impression, identite, stations } = useApp()
  const [resume, setResume] = useState<ResumeShift | null>(null)
  const [comptage, setComptage] = useState<Record<number, number>>({})
  const [note, setNote] = useState('')
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    let vivant = true
    void (async () => {
      const [encaissements, mouvements, totaux] = await Promise.all([
        app.caisse.encaissementsDe(shift.id),
        app.caisse.mouvementsDe(shift.id),
        app.caisse.totauxDe(shift.id),
      ])
      if (!vivant) return
      setResume(
        resumerShift({
          shift,
          encaissements,
          mouvements,
          nombreCommandes: totaux.nombreCommandes,
          chiffreAffairesMillimes: millimes(totaux.chiffreAffairesMillimes),
        }),
      )
    })()
    return () => {
      vivant = false
    }
  }, [app, shift])

  const compte = totaliserComptage(comptage)
  const ecart = resume ? compte - resume.attenduMillimes : 0
  const alerte = ecartSignificatif(millimes(ecart))

  const cloturer = async () => {
    if (!resume) return
    setEnCours(true)
    try {
      await app.caisse.cloturerShift(shift.id, compte, resume.attenduMillimes, note || null)
      await app.etat.ecrire('shift_courant', '')

      // Le rapport part à l'imprimante du bar, celle qui est près de la caisse.
      const imprimante = [...stations.values()].find((s) => s.hote) ?? null
      await impression.mettreEnFile({
        id: uuidV7(),
        restaurantId: identite.restaurantId,
        kind: 'rapport',
        charge: rendreTicketShift({
          type: 'shift',
          etablissement,
          employe: employe?.nom ?? null,
          ouvertA: shift.ouvertA,
          closA: new Date().toISOString(),
          resume: { ...resume, compteMillimes: millimes(compte), ecartMillimes: millimes(ecart) },
        }),
        hote: imprimante?.hote ?? null,
        port: imprimante?.port,
      })
      onFerme()
    } finally {
      setEnCours(false)
    }
  }

  if (!resume) {
    return (
      <div className="ecran-centre">
        <div className="pastille-chargement" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="cloture">
      <section className="bloc-cloture">
        <h1>Clôture de caisse</h1>

        <dl className="recap">
          <dt>Commandes encaissées</dt>
          <dd>{resume.nombreCommandes}</dd>
          <dt>Chiffre d'affaires</dt>
          <dd>{formaterTND(resume.chiffreAffairesMillimes)}</dd>
          <dt>Fond de caisse</dt>
          <dd>{formaterTND(resume.fondDeCaisseMillimes)}</dd>
          <dt>Espèces encaissées</dt>
          <dd>{formaterTND(resume.especesMillimes)}</dd>
          {resume.entreesMillimes > 0 && (
            <>
              <dt>Entrées d'espèces</dt>
              <dd>{formaterTND(resume.entreesMillimes)}</dd>
            </>
          )}
          {resume.sortiesMillimes > 0 && (
            <>
              <dt>Sorties d'espèces</dt>
              <dd>− {formaterTND(resume.sortiesMillimes)}</dd>
            </>
          )}
          <dt className="fort">Attendu en caisse</dt>
          <dd className="fort">{formaterTND(resume.attenduMillimes)}</dd>
          {resume.carteMillimes > 0 && (
            <>
              <dt>Carte (hors tiroir)</dt>
              <dd>{formaterTND(resume.carteMillimes)}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="bloc-cloture">
        <h2>Comptage du tiroir</h2>
        <p className="aide">
          Comptez réellement les coupures. Un écart n'est pas une faute : c'est
          une information.
        </p>

        <div className="coupures">
          {COUPURES_TND.map((coupure) => (
            <label key={coupure}>
              <span className="valeur-coupure">{formaterTND(coupure, { symbole: false })}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={comptage[coupure] ?? ''}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10)
                  setComptage((c) => ({ ...c, [coupure]: Number.isFinite(n) && n >= 0 ? n : 0 }))
                }}
              />
            </label>
          ))}
        </div>

        <div className="resultat-comptage">
          <div className="ligne">
            <span>Compté</span>
            <strong>{formaterTND(millimes(compte))}</strong>
          </div>
          <div className={`ligne ecart ${ecart === 0 ? 'juste' : alerte ? 'alerte' : 'leger'}`}>
            <span>Écart</span>
            <strong>
              {ecart > 0 ? '+' : ''}
              {formaterTND(millimes(ecart))}
            </strong>
          </div>
        </div>

        {alerte && (
          <label className="motif">
            Écart supérieur à 1 dinar — expliquez ce qui s'est passé
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Erreur de rendu de monnaie, achat non enregistré…"
            />
          </label>
        )}

        <div className="actions">
          <button type="button" className="secondaire" onClick={onAnnuler}>
            Annuler
          </button>
          <button
            type="button"
            className="principal"
            disabled={enCours || (alerte && note.trim() === '')}
            onClick={() => void cloturer()}
          >
            {enCours ? 'Clôture…' : 'Clôturer et imprimer'}
          </button>
        </div>
        {alerte && note.trim() === '' && (
          <p className="aide">Un écart significatif exige une justification écrite.</p>
        )}
      </section>
    </div>
  )
}
