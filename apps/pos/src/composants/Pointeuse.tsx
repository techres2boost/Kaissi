/**
 * Pointer son arrivée ou sa sortie — au PIN, sur n'importe quelle caisse.
 *
 * Deux temps, et pas un de plus : QUI (le PIN, qui trace), puis le geste.
 * La caisse propose le seul geste qui a du sens — « Pointer la sortie » si
 * la personne est déjà pointée ici, « Pointer l'arrivée » sinon. Un écran à
 * deux boutons ferait pointer deux arrivées d'affilée, et la journée
 * deviendrait illisible.
 *
 * Joignable depuis l'écran VERROUILLÉ : le cuisinier qui arrive pointe sans
 * prendre la caisse, et sans qu'une caisse soit ouverte.
 *
 * L'heure est celle de la tablette (voir `pointeuse.ts` dans le domaine) :
 * elle trace, elle ne prouve pas.
 */

import { useEffect, useState } from 'react'
import { dureeMinutes, formaterDuree, uuidV7, type Employe, type Pointage } from '@kaissi/domain'
import { useApp } from '../etat/contexte.js'
import { DemandePin } from './DemandePin.js'
import { Modale } from './Modale.js'
import { dateLocale, t, tm } from '../i18n.js'

const heure = (iso: string) => dateLocale(new Date(iso), { hour: '2-digit', minute: '2-digit' })

export function ModalePointeuse({ onFermer }: { readonly onFermer: () => void }) {
  const { app, identite, rafraichir } = useApp()
  const [qui, setQui] = useState<Employe | null>(null)
  const [ouvert, setOuvert] = useState<Pointage | null | undefined>(undefined)
  const [fait, setFait] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    if (!qui) return
    let vivant = true
    void app.pointeuse.ouvertDe(qui.id).then((p) => vivant && setOuvert(p))
    return () => {
      vivant = false
    }
  }, [app, qui])

  if (!qui) {
    return (
      <DemandePin
        titre={t('Pointeuse')}
        sousTitre={t('Qui pointe ?')}
        onValide={setQui}
        onAnnuler={onFermer}
      />
    )
  }

  const pointer = async () => {
    setEnCours(true)
    setErreur(null)
    try {
      const maintenant = new Date().toISOString()
      if (ouvert) {
        await app.pointeuse.pointerSortie(ouvert.id, maintenant)
        setFait(
          t('Sortie pointée à {heure} — {duree} depuis l’arrivée.', {
            heure: heure(maintenant),
            duree: formaterDuree(dureeMinutes(ouvert.arriveeA, maintenant)),
          }),
        )
      } else {
        await app.pointeuse.pointerArrivee({
          id: uuidV7(),
          organizationId: identite.organizationId,
          restaurantId: identite.restaurantId,
          deviceId: identite.deviceId,
          employeId: qui.id,
          arriveeA: maintenant,
        })
        setFait(t('Arrivée pointée à {heure}. Bon service !', { heure: heure(maintenant) }))
      }
      rafraichir()
    } catch (e) {
      setErreur(e instanceof Error ? tm(e.message) : String(e))
    } finally {
      setEnCours(false)
    }
  }

  if (fait) {
    return (
      <Modale
        titre={qui.nom}
        onFermer={onFermer}
        pied={<button type="button" className="principal" onClick={onFermer}>{t('OK')}</button>}
      >
        <p className="pointage-fait">{fait}</p>
      </Modale>
    )
  }

  return (
    <Modale
      titre={qui.nom}
      sousTitre={
        ouvert === undefined
          ? t('Lecture…')
          : ouvert
            ? t('Pointé depuis {heure} sur cette caisse.', { heure: heure(ouvert.arriveeA) })
            : t('Pas encore pointé sur cette caisse.')
      }
      onFermer={onFermer}
      pied={
        <>
          <button type="button" onClick={onFermer}>{t('Annuler')}</button>
          <button
            type="button"
            className="principal"
            disabled={ouvert === undefined || enCours}
            onClick={() => void pointer()}
          >
            {ouvert ? t('Pointer la sortie') : t('Pointer l’arrivée')}
          </button>
        </>
      }
    >
      {ouvert && (
        <p className="aide">
          {t('Présent depuis {duree}.', {
            duree: formaterDuree(dureeMinutes(ouvert.arriveeA, new Date().toISOString())),
          })}
        </p>
      )}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
    </Modale>
  )
}
