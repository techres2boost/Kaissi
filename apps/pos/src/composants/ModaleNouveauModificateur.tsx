/**
 * Créer un GROUPE D'OPTIONS (modificateurs) depuis la caisse.
 *
 * Trois choses dans un seul geste, et c'est voulu : le groupe, ses choix, et
 * les articles auxquels il s'applique. Les séparer produirait l'état le plus
 * inutile du système — un groupe sans choix, ou un groupe rattaché à rien,
 * qui n'apparaît NULLE PART en caisse. C'est pourquoi la validation refuse un
 * groupe sans choix.
 *
 * Le rattachement est ADDITIF : deux caisses qui rattachent chacune un groupe
 * au même article donnent un article à deux groupes, sans conflit — comme
 * deux articles ajoutés à la même table.
 */

import { useState } from 'react'
import {
  depuisDecimal,
  peutModifierCatalogue,
  uuidV7,
  validerMutationCatalogue,
  type ChoixModificateur,
  type Employe,
  type MutationCatalogue,
} from '@kaissi/domain'
import type { ProduitLocal } from '@kaissi/db-local'
import { Modale } from './Modale.js'
import { useApp } from '../etat/contexte.js'
import { t, tm } from '../i18n.js'

interface Props {
  readonly employe: Employe
  readonly produits: readonly ProduitLocal[]
  readonly onFerme: () => void
  readonly onCree: (nom: string) => void | Promise<void>
}

/** Une ligne de saisie : le nom du choix et son supplément, en texte. */
interface LigneChoix {
  readonly id: string
  nom: string
  prix: string
}

export function ModaleNouveauModificateur({ employe, produits, onFerme, onCree }: Props) {
  const { app, identite, rafraichir } = useApp()
  const [nom, setNom] = useState('')
  const [minSelect, setMinSelect] = useState('0')
  const [maxSelect, setMaxSelect] = useState('1')
  const [choix, setChoix] = useState<LigneChoix[]>([
    { id: uuidV7(), nom: '', prix: '0' },
    { id: uuidV7(), nom: '', prix: '0' },
  ])
  const [rattaches, setRattaches] = useState<Set<string>>(new Set())
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const majChoix = (id: string, champ: 'nom' | 'prix', v: string) =>
    setChoix((liste) => liste.map((c) => (c.id === id ? { ...c, [champ]: v } : c)))

  const basculer = (produitId: string) =>
    setRattaches((actuel) => {
      const suivant = new Set(actuel)
      if (suivant.has(produitId)) suivant.delete(produitId)
      else suivant.add(produitId)
      return suivant
    })

  const enregistrer = async () => {
    setErreur(null)

    // Les lignes vides sont ignorées : on en affiche deux d'emblée pour que
    // le geste soit évident, et personne ne doit les remplir toutes.
    const remplies = choix.filter((c) => c.nom.trim() !== '')
    const convertis: ChoixModificateur[] = []
    for (const c of remplies) {
      let delta
      try {
        // Un supplément NÉGATIF est légitime : la petite portion coûte moins.
        delta = depuisDecimal(c.prix.trim() === '' ? '0' : c.prix.trim())
      } catch {
        setErreur(t('Le prix de « {nom} » n’est pas lisible. Exemple : 1,500', { nom: c.nom.trim() }))
        return
      }
      convertis.push({ id: c.id, nom: c.nom, prixDeltaMillimes: delta })
    }

    const mutation: MutationCatalogue = {
      mutationId: uuidV7(),
      type: 'catalogue.modificateur.cree',
      organizationId: identite.organizationId,
      restaurantId: identite.restaurantId,
      deviceId: identite.deviceId,
      parEmployeId: employe.id,
      // RÈGLE 2 : l'identifiant vient de l'APPAREIL.
      groupeId: uuidV7(),
      nom,
      minSelect: Number(minSelect) || 0,
      maxSelect: Number(maxSelect) || 0,
      choix: convertis,
      produitIds: [...rattaches],
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
      await onCree(nom.trim())
      onFerme()
    } catch (e) {
      setErreur(e instanceof Error ? tm(e.message) : String(e))
    } finally {
      setEnCours(false)
    }
  }

  if (!peutModifierCatalogue(employe.role)) {
    return (
      <Modale titre={t('Nouveau groupe d’options')} onFermer={onFerme}>
        <p className="aide">{t('Seul un gérant ou un administrateur tient la carte.')}</p>
      </Modale>
    )
  }

  return (
    <Modale
      titre={t('Nouveau groupe d’options')}
      onFermer={onFerme}
      large
      pied={
        <button
          type="button"
          className="principal"
          disabled={enCours || nom.trim() === ''}
          onClick={() => void enregistrer()}
        >
          {enCours ? t('Enregistrement…') : t('Créer le groupe')}
        </button>
      }
    >
      <label htmlFor="mod-nom">{t('Nom du groupe')}</label>
      <input
        id="mod-nom"
        type="text"
        value={nom}
        autoFocus
        maxLength={100}
        placeholder={t('Cuisson')}
        onChange={(e) => setNom(e.target.value)}
      />

      <div className="champs deux">
        <div>
          <label htmlFor="mod-min">{t('Choix obligatoires (min)')}</label>
          <input
            id="mod-min"
            inputMode="numeric"
            maxLength={2}
            value={minSelect}
            onChange={(e) => setMinSelect(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label htmlFor="mod-max">{t('Au plus (max)')}</label>
          <input
            id="mod-max"
            inputMode="numeric"
            maxLength={2}
            value={maxSelect}
            onChange={(e) => setMaxSelect(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>
      <p className="aide">
        <strong>{t('min')}</strong>{' '}{t(': combien de choix le caissier DOIT faire (0 = facultatif).')}{' '}<strong>{t('max')}</strong>{' '}{t(': combien il PEUT en faire au plus (0 = autant qu’il veut).')}</p>

      <label>{t('Les choix proposés')}</label>
      {choix.map((c) => (
        <div key={c.id} className="champs deux">
          <input
            type="text"
            value={c.nom}
            maxLength={100}
            placeholder={t('Saignant')}
            aria-label={t('Nom du choix')}
            onChange={(e) => majChoix(c.id, 'nom', e.target.value)}
          />
          <input
            type="text"
            inputMode="decimal"
            value={c.prix}
            aria-label={t('Supplément en dinars')}
            onChange={(e) => majChoix(c.id, 'prix', e.target.value)}
          />
        </div>
      ))}
      <button
        type="button"
        className="secondaire"
        onClick={() => setChoix((l) => [...l, { id: uuidV7(), nom: '', prix: '0' }])}
      >{t('+ Ajouter un choix')}</button>
      <p className="aide">{t('Le supplément s’ajoute au prix de la ligne. Il peut être')}{' '}
        <strong>{t('négatif')}</strong>{' '}{t('(« −1,500 » pour une petite portion). Les lignes laissées vides sont ignorées.')}</p>

      <label>{t('S’applique à')}</label>
      {produits.length === 0 ? (
        <p className="aide">{t('Aucun article dans la carte pour l’instant.')}</p>
      ) : (
        <div className="options">
          {produits.map((p) => (
            <button
              key={p.id}
              type="button"
              className={rattaches.has(p.id) ? 'actif' : ''}
              aria-pressed={rattaches.has(p.id)}
              onClick={() => basculer(p.id)}
            >
              {p.nom}
            </button>
          ))}
        </div>
      )}
      <p className="aide">{t('Un groupe rattaché à')}{' '}<strong>{t('aucun')}</strong>{' '}{t('article n’apparaît nulle part en caisse. On peut l’y rattacher plus tard au back-office.')}</p>

      {erreur && <p className="erreur">{erreur}</p>}
    </Modale>
  )
}
