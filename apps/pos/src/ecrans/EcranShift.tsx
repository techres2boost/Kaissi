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
import { IMPRESSION_ACTIVE } from '../config.js'
import { useApp } from '../etat/contexte.js'
import { PaveNumerique } from '../composants/PaveNumerique.js'
import { Modale } from '../composants/Modale.js'
import { TicketEcran } from '../composants/TicketEcran.js'
import { construireRapportZ } from '../donnees/rapport-z.js'
import { t, tm } from '../i18n.js'

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
      setErreur(e instanceof Error ? tm(e.message) : String(e))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="ecran-centre ouverture-caisse">
      <div className="carte-action">
        <h1>{t('Ouverture de caisse')}</h1>
        <p className="aide">{t('Comptez le fond de caisse avant de commencer le service. C\'est lui qui sert de référence à l\'écart constaté ce soir.')}</p>

        <div className="montant-saisi">
          <span className="libelle">{t('Fond de caisse')}</span>
          <span className="valeur">{formaterTND(fond)}</span>
        </div>

        {erreur && <p className="erreur">{erreur}</p>}

        <PaveNumerique
          valeur={saisie}
          onChange={setSaisie}
          decimale
          onValider={() => void ouvrir()}
          libelleValider={enCours ? t('Ouverture…') : t('Ouvrir la caisse')}
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
  /** Le Z de ce service, affiché une fois la caisse close. */
  const [rapportZ, setRapportZ] = useState<Uint8Array | null>(null)

  useEffect(() => {
    let vivant = true
    void (async () => {
      const [encaissements, mouvements, totaux, remboursements] = await Promise.all([
        app.caisse.encaissementsDe(shift.id),
        app.caisse.mouvementsDe(shift.id),
        app.caisse.totauxDe(shift.id),
        app.caisse.remboursementsDe(shift.id),
      ])
      if (!vivant) return
      setResume(
        resumerShift({
          shift,
          encaissements,
          mouvements,
          nombreCommandes: totaux.nombreCommandes,
          chiffreAffairesMillimes: millimes(totaux.chiffreAffairesMillimes),
          remboursements,
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
      /*
       * On enregistre QUI COMPTE, et non qui a ouvert.
       *
       * Un caissier ouvre à midi, un serveur compte le soir : devant un
       * écart, le nom qui compte est celui de la personne qui a vu les
       * billets. Afficher celui de l'ouverture met en cause quelqu'un qui
       * était parti depuis quatre heures.
       */
      await app.caisse.cloturerShift(
        shift.id,
        compte,
        resume.attenduMillimes,
        note || null,
        employe?.id ?? null,
      )
      await app.etat.ecrire('shift_courant', '')

      /*
       * Le Z se construit sur le service RELU en base, clos : c'est
       * exactement celui que « Périodes de travail » rouvrira demain.
       *
       * Impression éteinte (MVP) : il s'affiche À L'ÉCRAN, et rien n'entre
       * en file. Allumée, il part en plus à l'imprimante du bar, celle qui
       * est près de la caisse.
       */
      const clos = (await app.caisse.shiftParId(shift.id)) ?? shift
      const { charge } = await construireRapportZ(app, clos, {
        etablissement,
        employe: employe?.nom ?? null,
      })
      if (IMPRESSION_ACTIVE) {
        const imprimante = [...stations.values()].find((s) => s.hote) ?? null
        await impression.mettreEnFile({
          id: uuidV7(),
          restaurantId: identite.restaurantId,
          kind: 'rapport',
          charge,
          hote: imprimante?.hote ?? null,
          port: imprimante?.port,
        })
      }
      setRapportZ(charge)
    } finally {
      setEnCours(false)
    }
  }

  if (rapportZ) {
    return (
      <Modale
        titre={t('Rapport de clôture (Z)')}
        sousTitre={t('La caisse est close. Ce rapport se rouvre à tout moment depuis « Périodes de travail ».')}
        pied={
          <button type="button" className="principal" onClick={onFerme}>{t('Terminer')}</button>
        }
      >
        <TicketEcran charge={rapportZ} />
      </Modale>
    )
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
        <h1>{t('Clôture de caisse')}</h1>

        <dl className="recap">
          <dt>{t('Commandes encaissées')}</dt>
          <dd>{resume.nombreCommandes}</dd>
          <dt>{t('Chiffre d\'affaires')}</dt>
          <dd>{formaterTND(resume.chiffreAffairesMillimes)}</dd>
          <dt>{t('Fond de caisse')}</dt>
          <dd>{formaterTND(resume.fondDeCaisseMillimes)}</dd>
          <dt>{t('Espèces encaissées')}</dt>
          <dd>{formaterTND(resume.especesMillimes)}</dd>
          {resume.entreesMillimes > 0 && (
            <>
              <dt>{t('Entrées d\'espèces')}</dt>
              <dd>{formaterTND(resume.entreesMillimes)}</dd>
            </>
          )}
          {resume.sortiesMillimes > 0 && (
            <>
              <dt>{t('Sorties d\'espèces')}</dt>
              <dd>− {formaterTND(resume.sortiesMillimes)}</dd>
            </>
          )}
          {resume.remboursementsEspecesMillimes > 0 && (
            <>
              <dt>{t('Remboursé en espèces')}</dt>
              <dd>− {formaterTND(resume.remboursementsEspecesMillimes)}</dd>
            </>
          )}
          <dt className="fort">{t('Attendu en caisse')}</dt>
          <dd className="fort">{formaterTND(resume.attenduMillimes)}</dd>
          {resume.carteMillimes > 0 && (
            <>
              <dt>{t('Carte (hors tiroir)')}</dt>
              <dd>{formaterTND(resume.carteMillimes)}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="bloc-cloture">
        <h2>{t('Comptage du tiroir')}</h2>
        <p className="aide">{t('Comptez réellement les coupures. Un écart n\'est pas une faute : c\'est une information.')}</p>

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
            <span>{t('Compté')}</span>
            <strong>{formaterTND(millimes(compte))}</strong>
          </div>
          <div className={`ligne ecart ${ecart === 0 ? 'juste' : alerte ? 'alerte' : 'leger'}`}>
            <span>{t('Écart')}</span>
            <strong>
              {ecart > 0 ? '+' : ''}
              {formaterTND(millimes(ecart))}
            </strong>
          </div>
        </div>

        {alerte && (
          <label className="motif">{t('Écart supérieur à 1 dinar — expliquez ce qui s\'est passé')}<textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t('Erreur de rendu de monnaie, achat non enregistré…')}
            />
          </label>
        )}

        <div className="actions">
          <button type="button" className="secondaire" onClick={onAnnuler}>{t('Annuler')}</button>
          <button
            type="button"
            className="principal"
            disabled={enCours || (alerte && note.trim() === '')}
            onClick={() => void cloturer()}
          >
            {enCours ? t('Clôture…') : IMPRESSION_ACTIVE ? t('Clôturer et imprimer') : t('Clôturer la caisse')}
          </button>
        </div>
        {alerte && note.trim() === '' && (
          <p className="aide">{t('Un écart significatif exige une justification écrite.')}</p>
        )}
      </section>
    </div>
  )
}
