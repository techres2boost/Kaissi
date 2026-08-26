/**
 * Saisie du PIN d'un employé.
 *
 * Sert à deux choses distinctes :
 *   • prendre le poste sur le terminal (`titre` par défaut) ;
 *   • AUTORISER une opération escaladée — un manager pose son PIN pour
 *     débloquer une remise au-delà du plafond, une annulation de vente.
 *
 * Dans le second cas, l'identité du manager est consignée dans l'événement :
 * c'est tout l'intérêt de la traçabilité.
 */

import { useState } from 'react'
import {
  apresEchec,
  apresSucces,
  estBloque,
  secondesRestantes,
  TENTATIVES_VIERGES,
  type Employe,
  type EtatTentatives,
} from '@kaissi/domain'
import type { EmployeLocal } from '@kaissi/db-local'
import { useApp } from '../etat/contexte.js'
import { Modale } from './Modale.js'
import { PaveNumerique } from './PaveNumerique.js'

interface Props {
  readonly titre?: string
  readonly sousTitre?: string
  /** Restreint la liste aux employés habilités (managers, typiquement). */
  readonly candidats?: readonly EmployeLocal[]
  readonly onValide: (employe: Employe) => void
  readonly onAnnuler?: () => void
}

export function DemandePin({
  titre = 'Prise de poste',
  sousTitre,
  candidats,
  onValide,
  onAnnuler,
}: Props) {
  const { employes, app } = useApp()
  const liste = candidats ?? employes
  const [choisi, setChoisi] = useState<EmployeLocal | null>(
    liste.length === 1 ? liste[0]! : null,
  )
  const [pin, setPin] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [tentatives, setTentatives] = useState<EtatTentatives>(TENTATIVES_VIERGES)
  const [verification, setVerification] = useState(false)

  const bloque = estBloque(tentatives)

  const valider = async () => {
    if (!choisi || bloque) return
    setVerification(true)
    setErreur(null)
    try {
      // Argon2id prend ~1,5 s sur une tablette d'entrée de gamme : le bouton
      // est désactivé pendant ce temps, sinon le caissier tape trois fois.
      const employe = await app.employes.verifier(choisi.id, pin)
      if (employe) {
        setTentatives(apresSucces())
        setPin('')
        onValide(employe)
        return
      }
      const suivant = apresEchec(tentatives)
      setTentatives(suivant)
      setPin('')
      setErreur(
        estBloque(suivant)
          ? `Trop de tentatives. Réessayez dans ${secondesRestantes(suivant)} secondes.`
          : 'Code incorrect.',
      )
    } finally {
      setVerification(false)
    }
  }

  return (
    <Modale titre={titre} sousTitre={sousTitre} onFermer={onAnnuler}>
      {!choisi ? (
        <div className="liste-employes">
          {liste.map((e) => (
            <button key={e.id} type="button" onClick={() => setChoisi(e)}>
              <span className="nom">{e.nom}</span>
              <span className="role">{e.role}</span>
            </button>
          ))}
          {liste.length === 0 && (
            <p className="vide">
              Aucun employé habilité n'est configuré sur ce terminal.
            </p>
          )}
        </div>
      ) : (
        <div className="saisie-pin">
          <button type="button" className="employe-choisi" onClick={() => setChoisi(null)}>
            {choisi.nom} <span className="changer">changer</span>
          </button>

          <div className="points" aria-label={`${pin.length} chiffre(s) saisis`}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span key={i} className={i < pin.length ? 'plein' : ''} />
            ))}
          </div>

          {erreur && <p className="erreur">{erreur}</p>}
          {verification && <p className="aide">Vérification…</p>}

          <PaveNumerique
            valeur={pin}
            onChange={setPin}
            maxLongueur={8}
            onValider={() => void valider()}
            libelleValider="Entrer"
            validerActif={pin.length >= 4 && !bloque && !verification}
          />
        </div>
      )}
    </Modale>
  )
}
