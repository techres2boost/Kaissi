/**
 * Créer une RÉDUCTION de la maison depuis la caisse.
 *
 * Une réduction déclarée ne crée AUCUN droit : le plafond reste celui du rôle,
 * et une remise de 50 % demandera toujours l'autorisation d'un responsable.
 * Elle NOMME la décision — et c'est ce nom qui manquait au rapport, où tout
 * finissait « Sans motif ».
 *
 * Le pourcentage est saisi en clair (« 10 », « 12,5 ») et converti en POINTS
 * DE BASE entiers (RÈGLE 1) : 10 % = 1000. Un flottant `0.1` traînerait
 * ensuite dans tous les calculs.
 */

import { useState } from 'react'
import {
  depuisDecimal,
  peutModifierCatalogue,
  uuidV7,
  validerMutationCatalogue,
  type Employe,
  type Millimes,
  type MutationCatalogue,
} from '@kaissi/domain'
import { Modale } from './Modale.js'
import { useApp } from '../etat/contexte.js'

interface Props {
  readonly employe: Employe
  readonly onFerme: () => void
  readonly onCree: (nom: string) => void | Promise<void>
}

export function ModaleNouvelleReduction({ employe, onFerme, onCree }: Props) {
  const { app, identite, rafraichir } = useApp()
  const [nom, setNom] = useState('')
  const [type, setType] = useState<'pourcentage' | 'montant'>('pourcentage')
  const [valeur, setValeur] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  /** « 12,5 » → 1250 points de base. Rend `null` si ce n'est pas lisible. */
  const pourcentageEnBp = (brut: string): number | null => {
    const n = Number(brut.trim().replace(',', '.'))
    if (!Number.isFinite(n)) return null
    return Math.round(n * 100)
  }

  /** « 2,000 » → 2000 millimes. Le dinar a TROIS décimales (RÈGLE 1). */
  const montantEnMillimes = (brut: string): Millimes | null => {
    try {
      return depuisDecimal(brut.trim())
    } catch {
      return null
    }
  }

  const enregistrer = async () => {
    setErreur(null)
    const bp = type === 'pourcentage' ? pourcentageEnBp(valeur) : null
    const montant = type === 'montant' ? montantEnMillimes(valeur) : null
    if (type === 'pourcentage' && bp === null) {
      setErreur('Le pourcentage n’est pas lisible. Exemple : 10 ou 12,5')
      return
    }
    if (type === 'montant' && montant === null) {
      setErreur('Le montant n’est pas lisible. Exemple : 2,000')
      return
    }

    const mutation: MutationCatalogue = {
      mutationId: uuidV7(),
      type: 'catalogue.reduction.cree',
      organizationId: identite.organizationId,
      restaurantId: identite.restaurantId,
      deviceId: identite.deviceId,
      parEmployeId: employe.id,
      // RÈGLE 2 : l'identifiant vient de l'APPAREIL.
      reductionId: uuidV7(),
      nom,
      kind: type,
      valeurBp: bp as never,
      montantMillimes: montant,
      clientTs: new Date().toISOString(),
      protocolVersion: 1,
    }

    // LA MÊME validation que le serveur exécutera.
    const verdict = validerMutationCatalogue(mutation)
    if (!verdict.valide) {
      setErreur(verdict.motif ?? 'Saisie invalide.')
      return
    }

    setEnCours(true)
    try {
      await app.catalogue.creerCatalogueLocal(mutation)
      rafraichir()
      await onCree(nom.trim())
      onFerme()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEnCours(false)
    }
  }

  if (!peutModifierCatalogue(employe.role)) {
    return (
      <Modale titre="Nouvelle réduction" onFermer={onFerme}>
        <p className="aide">Seul un gérant ou un administrateur tient la carte.</p>
      </Modale>
    )
  }

  return (
    <Modale
      titre="Nouvelle réduction"
      onFermer={onFerme}
      pied={
        <button
          type="button"
          className="principal"
          disabled={enCours || nom.trim() === '' || valeur.trim() === ''}
          onClick={() => void enregistrer()}
        >
          {enCours ? 'Enregistrement…' : 'Créer la réduction'}
        </button>
      }
    >
      <label htmlFor="red-nom">Nom</label>
      <input
        id="red-nom"
        type="text"
        value={nom}
        autoFocus
        maxLength={60}
        placeholder="Happy hour"
        onChange={(e) => setNom(e.target.value)}
      />

      <label htmlFor="red-type">Type</label>
      <select
        id="red-type"
        value={type}
        onChange={(e) => {
          setType(e.target.value as 'pourcentage' | 'montant')
          setValeur('')
        }}
      >
        <option value="pourcentage">Pourcentage</option>
        <option value="montant">Montant fixe</option>
      </select>

      <label htmlFor="red-valeur">
        {type === 'pourcentage' ? 'Pourcentage' : 'Montant en dinars'}
      </label>
      <input
        id="red-valeur"
        type="text"
        inputMode="decimal"
        value={valeur}
        placeholder={type === 'pourcentage' ? '10' : '2,000'}
        onChange={(e) => setValeur(e.target.value)}
      />
      <p className="aide">
        {type === 'pourcentage'
          ? 'En pour-cent, sans le signe. « 12,5 » est accepté.'
          : 'Le dinar a trois décimales : « 2,000 » vaut deux dinars.'}
      </p>

      {erreur && <p className="erreur">{erreur}</p>}
    </Modale>
  )
}
