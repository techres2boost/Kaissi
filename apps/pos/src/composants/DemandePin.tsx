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

import { useEffect, useState } from 'react'
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
  /**
   * Propose d'emblée le pavé PIN de la personne attendue, au lieu de la liste.
   *
   * Vrai à la PRISE DE POSTE seulement. Sur une escalade — un manager
   * autorise une remise au-delà du plafond — c'est tout l'inverse : celui qui
   * tient la caisse n'est PAS celui dont on attend le PIN, et pré-remplir son
   * nom l'inviterait à taper le sien.
   */
  readonly proposerLHabitue?: boolean
  readonly onValide: (employe: Employe) => void
  readonly onAnnuler?: () => void
}

export function DemandePin({
  titre = 'Prise de poste',
  sousTitre,
  candidats,
  proposerLHabitue = false,
  onValide,
  onAnnuler,
}: Props) {
  const { employes, app } = useApp()
  const liste = candidats ?? employes
  const [choisi, setChoisi] = useState<EmployeLocal | null>(
    liste.length === 1 ? liste[0]! : null,
  )

  /*
   * ── Qui proposer, et dans quel ordre ──────────────────────────────────
   *
   * L'écran listait toute l'équipe à chaque prise de poste — cuisine, bar,
   * caissiers, gérant — alors que sur un terminal donné c'est presque
   * toujours la même personne qui reprend.
   *
   * L'ordre est celui de la probabilité, pas de la hiérarchie :
   *   1. la dernière personne dont le PIN a été accepté ICI ;
   *   2. à défaut — premier jour, aucun poste encore pris — celle dont le
   *      compte a mis ce terminal en service.
   *
   * Ce n'est qu'un CONFORT de saisie. Le PIN reste exigé et vérifié hors
   * ligne contre le hachage synchronisé ; se tromper de proposition coûte un
   * appui sur « changer ». Le PIN trace, il ne protège pas.
   *
   * Un employé archivé ou suspendu a disparu de `liste` : la recherche ne le
   * retrouve pas, et l'écran retombe sur la liste complète. C'est le bon
   * comportement — proposer quelqu'un qui ne peut plus ouvrir la caisse
   * ferait taper un PIN qui sera refusé sans qu'on dise pourquoi.
   */
  useEffect(() => {
    if (!proposerLHabitue) return
    let vivant = true
    void (async () => {
      const [dernier, appaireur] = await Promise.all([
        app.etat.lire('dernier_employe'),
        app.etat.lire('employe_appaireur'),
      ])
      if (!vivant) return
      const habituel =
        liste.find((e) => e.id === dernier) ?? liste.find((e) => e.id === appaireur)
      // `setChoisi` seulement si on a trouvé : ne JAMAIS remettre à null, on
      // écraserait un choix que la personne vient de faire à la main.
      if (habituel) setChoisi((actuel) => actuel ?? habituel)
    })()
    return () => {
      vivant = false
    }
    // `liste` est recalculée à chaque rendu : la dépendre ferait tourner cet
    // effet en boucle. Sa longueur suffit à repérer un vrai changement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, proposerLHabitue, liste.length])
  const [pin, setPin] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [tentatives, setTentatives] = useState<EtatTentatives>(TENTATIVES_VIERGES)
  const [verification, setVerification] = useState(false)
  /*
   * Ce terminal est-il rattaché à un établissement, et depuis quand a-t-il
   * reçu la carte ? Les deux servent au MÊME message : expliquer un « Code
   * incorrect » qui n'a rien d'incorrect.
   */
  const [contexteCode, setContexteCode] = useState<{
    appaire: boolean
    catalogueRecuLe: string | null
  } | null>(null)

  useEffect(() => {
    let vivant = true
    void Promise.all([
      app.etat.lire('jeton_appareil'),
      app.etat.lire('catalogue_applique_a'),
    ]).then(([jeton, recu]) => {
      if (vivant) setContexteCode({ appaire: !!jeton, catalogueRecuLe: recu })
    })
    return () => {
      vivant = false
    }
  }, [app])

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
        /*
         * On retient qui vient de PRENDRE LE POSTE — et rien d'autre.
         *
         * La première version écrivait aussi sur une escalade, au motif qu'un
         * manager qui débloque une remise est quelqu'un qui se sert de ce
         * terminal. C'est faux, et le parcours l'a dit tout seul : Ahmed
         * autorise une remise par-dessus l'épaule de Salma, repart, et c'est
         * LUI qu'on proposait au verrouillage suivant — alors que Salma n'a
         * pas quitté la caisse. Le même drapeau qui décide d'afficher la
         * proposition décide donc de l'écrire.
         */
        if (proposerLHabitue) void app.etat.ecrire('dernier_employe', employe.id)
        onValide(employe)
        return
      }
      const suivant = apresEchec(tentatives)
      setTentatives(suivant)
      setPin('')
      /*
       * ── « Code incorrect » ne l'est pas toujours ──────────────────────
       *
       * PANNE OBSERVÉE, et elle a coûté une demi-journée. Le même employé
       * ouvre la caisse sur un terminal et se voit refusé sur l'autre : sur
       * celui qui n'est rattaché à rien, son PIN est celui de la GRAINE DE
       * DÉMONSTRATION ; sur celui qui l'est, c'est celui du back-office, où
       * il a été changé. Les deux se comportent correctement, et l'écran
       * disait la même chose dans les deux cas.
       *
       * On ne peut pas savoir lequel des deux vient d'arriver — un hachage
       * ne se compare qu'à lui-même. On peut en revanche nommer ce qui
       * distingue ce terminal-ci, et c'est tout ce qu'il faut pour arrêter de
       * chercher du côté du logiciel.
       */
      setErreur(
        estBloque(suivant)
          ? `Trop de tentatives. Réessayez dans ${secondesRestantes(suivant)} secondes.`
          : contexteCode?.appaire === false
            ? 'Code incorrect. Cette caisse n’est rattachée à aucun ' +
              'établissement : les employés et leurs codes sont ceux de la ' +
              'DÉMONSTRATION, pas ceux du back-office.'
            : contexteCode?.catalogueRecuLe
              ? 'Code incorrect. Si le code a été changé au back-office, ' +
                `vérifiez que la caisse l’a reçu — dernière mise à jour de la ` +
                `carte le ${new Date(contexteCode.catalogueRecuLe).toLocaleString('fr-FR')}.`
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
          {/*
            Dit AVANT la saisie ce que l'échec dirait après. Sur une caisse
            rattachée à rien, ces noms sont ceux de la graine — mêmes
            personnes que le back-office, codes différents. Le taire faisait
            taper le code de démonstration sur un terminal réel, et
            réciproquement.

            Sur la prise de poste seulement : une escalade affiche la même
            liste, mais le manager qui autorise une remise n'a pas besoin
            qu'on lui rappelle le mode de la caisse à ce moment-là.
          */}
          {proposerLHabitue && contexteCode?.appaire === false && (
            <p className="aide avertissement-demo">
              Caisse non rattachée : employés et codes de DÉMONSTRATION.
            </p>
          )}
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
