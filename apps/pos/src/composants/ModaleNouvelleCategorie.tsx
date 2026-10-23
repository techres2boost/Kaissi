/**
 * Créer une CATÉGORIE depuis la caisse.
 *
 * Le champ qui compte le plus n'est pas le nom : c'est le POSTE. Depuis la
 * migration 0025, `categories.station_id` décide où sort le bon de
 * préparation ; une catégorie sans poste n'apparaît sur AUCUN écran de
 * préparation, et cela ne se voit qu'en plein service. L'écran le dit donc au
 * moment du choix, et pas après.
 */

import { useEffect, useState } from 'react'
import {
  peutModifierCatalogue,
  uuidV7,
  validerMutationCatalogue,
  type Employe,
  type MutationCatalogue,
} from '@kaissi/domain'
import { Modale } from './Modale.js'
import { useApp } from '../etat/contexte.js'
import { t, tm } from '../i18n.js'

interface Props {
  readonly employe: Employe
  readonly onFerme: () => void
  /** `id` : la catégorie créée, pour l'ouvrir aussitôt dans la carte. */
  readonly onCree: (nom: string, id: string) => void | Promise<void>
}

export function ModaleNouvelleCategorie({ employe, onFerme, onCree }: Props) {
  const { app, identite, rafraichir } = useApp()
  const [nom, setNom] = useState('')
  const [stationId, setStationId] = useState<string | null>(null)
  const [stations, setStations] = useState<{ id: string; nom: string }[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    let vivant = true
    // `app.stations.toutes()`, et non un SELECT recopié ici : le jour où les
    // postes archivés se filtrent autrement, les deux listes diffèreraient.
    void app.stations.toutes().then((s) => {
      if (vivant) setStations(s.map((x) => ({ id: x.id, nom: x.nom })))
    })
    return () => {
      vivant = false
    }
  }, [app])

  const enregistrer = async () => {
    setErreur(null)
    const mutation: MutationCatalogue = {
      mutationId: uuidV7(),
      type: 'catalogue.categorie.cree',
      organizationId: identite.organizationId,
      restaurantId: identite.restaurantId,
      deviceId: identite.deviceId,
      parEmployeId: employe.id,
      // RÈGLE 2 : l'identifiant vient de l'APPAREIL.
      categorieId: uuidV7(),
      nom,
      // La couleur se règle au back-office : un sélecteur de teinte sur une
      // tablette en plein service est un réglage dont personne n'a besoin.
      couleur: null,
      stationId,
      clientTs: new Date().toISOString(),
      protocolVersion: 1,
    }

    // LA MÊME validation que le serveur exécutera.
    const verdict = validerMutationCatalogue(mutation)
    if (!verdict.valide) {
      setErreur(verdict.motif ? tm(verdict.motif) : t('Saisie invalide.'))
      return
    }

    setEnCours(true)
    try {
      await app.catalogue.creerCatalogueLocal(mutation)
      rafraichir()
      await onCree(nom.trim(), mutation.categorieId)
      onFerme()
    } catch (e) {
      setErreur(e instanceof Error ? tm(e.message) : String(e))
    } finally {
      setEnCours(false)
    }
  }

  if (!peutModifierCatalogue(employe.role)) {
    return (
      <Modale titre={t('Nouvelle catégorie')} onFermer={onFerme}>
        <p className="aide">{t('Seul un gérant ou un administrateur tient la carte.')}</p>
      </Modale>
    )
  }

  return (
    <Modale
      titre={t('Nouvelle catégorie')}
      onFermer={onFerme}
      pied={
        <button
          type="button"
          className="principal"
          disabled={enCours || nom.trim() === ''}
          onClick={() => void enregistrer()}
        >
          {enCours ? t('Enregistrement…') : t('Créer la catégorie')}
        </button>
      }
    >
      <label htmlFor="cat-nom">{t('Nom')}</label>
      <input
        id="cat-nom"
        type="text"
        value={nom}
        autoFocus
        maxLength={100}
        placeholder={t('Entrées')}
        onChange={(e) => setNom(e.target.value)}
      />

      <label htmlFor="cat-poste">{t('Poste de préparation')}</label>
      <select
        id="cat-poste"
        value={stationId ?? ''}
        onChange={(e) => setStationId(e.target.value || null)}
      >
        <option value="">{t('Aucun — ne part dans aucune cuisine')}</option>
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nom}
          </option>
        ))}
      </select>
      <p className="aide">{t('C’est le poste qui décide où part le bon de préparation. Sans poste, les articles de cette catégorie n’apparaissent sur')}{' '}<strong>{t('aucun')}</strong>{' '}{t('écran de préparation — et cela ne se voit qu’en plein service.')}</p>

      {erreur && <p className="erreur">{erreur}</p>}
    </Modale>
  )
}
