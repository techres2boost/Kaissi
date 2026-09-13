/**
 * Créer un article sans quitter la caisse.
 *
 * ── Ce que cet écran N'EST PAS ────────────────────────────────────────────
 *
 * Ce n'est pas une fiche produit. Pas de variantes, pas de modificateurs, pas
 * de coût, pas de photo, pas de suivi de stock — tout cela se règle au
 * back-office, posément, sur un vrai clavier.
 *
 * Il répond à un seul besoin, et il a lieu en plein service : « on fait une
 * ojja ce soir, elle n'est pas dans la carte ». Trois champs, et on encaisse.
 * Chaque champ ajouté ici est un champ qu'un caissier devra remplir pendant
 * qu'un client attend.
 *
 * ── Le prix, et le piège du dinar ─────────────────────────────────────────
 *
 * La saisie est décimale — c'est ce que le gérant a en tête — et la
 * conversion passe EXCLUSIVEMENT par `depuisDecimal`. Le dinar a TROIS
 * décimales : « 14,5 » vaut 14 500 millimes, pas 1 450. Une multiplication
 * par cent écrite à la main ici produirait une erreur d'arrondi qui ne se
 * verrait qu'au bout de plusieurs mois.
 */

import { useState } from 'react'
import {
  depuisDecimal,
  formaterTND,
  peutModifierCatalogue,
  uuidV7,
  validerMutationCatalogue,
  type Employe,
  type MutationCatalogue,
} from '@kaissi/domain'
import type { CategorieLocale, TauxTaxeLocal } from '@kaissi/db-local'
import { Modale } from './Modale.js'
import { useApp } from '../etat/contexte.js'

interface Props {
  readonly employe: Employe
  readonly categories: readonly CategorieLocale[]
  readonly categorieActive: string | null
  readonly onFerme: () => void
  readonly onCree: (nom: string) => void | Promise<void>
}

export function ModaleNouvelArticle({
  employe,
  categories,
  categorieActive,
  onFerme,
  onCree,
}: Props) {
  const { app, identite, rafraichir } = useApp()
  const [nom, setNom] = useState('')
  const [prix, setPrix] = useState('')
  const [categorieId, setCategorieId] = useState<string | null>(categorieActive)
  const [tauxId, setTauxId] = useState<string | null>(null)
  const [taux, setTaux] = useState<TauxTaxeLocal[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  if (taux === null) {
    void app.catalogue.tauxTaxes().then((t) => {
      setTaux(t)
      // Le taux PAR DÉFAUT de l'établissement, s'il en a un. Sans lui, le
      // gérant doit choisir un taux de TVA en plein service — c'est
      // exactement la question qu'il ne veut pas se poser maintenant.
      setTauxId((actuel) => actuel ?? t.find((x) => x.parDefaut)?.id ?? t[0]?.id ?? null)
    })
  }

  const millimesSaisis = (() => {
    try {
      return depuisDecimal(prix)
    } catch {
      return null
    }
  })()

  async function creer() {
    setErreur(null)
    if (!tauxId) {
      setErreur('Aucun taux de TVA n’est défini pour cet établissement.')
      return
    }
    if (millimesSaisis === null) {
      setErreur('Le prix n’est pas un montant lisible. Exemple : 14,500')
      return
    }

    const mutation: MutationCatalogue = {
      mutationId: uuidV7(),
      type: 'catalogue.produit.cree',
      organizationId: identite.organizationId,
      restaurantId: identite.restaurantId,
      deviceId: identite.deviceId,
      parEmployeId: employe.id,
      // RÈGLE 2 : l'identifiant vient de l'APPAREIL. L'article se vend avant
      // d'avoir vu le réseau.
      produitId: uuidV7(),
      nom,
      categorieId,
      tauxTvaId: tauxId,
      prixBaseMillimes: millimesSaisis,
      clientTs: new Date().toISOString(),
      protocolVersion: 1,
    }

    // LA MÊME validation que le serveur exécutera. Refuser ici évite un rejet
    // qui reviendrait une heure plus tard, sur un article déjà vendu.
    const verdict = validerMutationCatalogue(mutation)
    if (!verdict.valide) {
      setErreur(verdict.motif ?? 'Saisie invalide.')
      return
    }

    setEnCours(true)
    try {
      await app.catalogue.creerProduitLocal(mutation)
      rafraichir()
      await onCree(mutation.nom.trim())
      onFerme()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEnCours(false)
    }
  }

  /*
   * La garde d'INTERFACE, et elle ne protège rien.
   *
   * Un PIN à quatre chiffres trace, il ne protège pas : masquer le bouton
   * évite une erreur, pas une malveillance. Ce qui refuse vraiment est côté
   * serveur, où le rôle est relu en base. Les deux existent, et aucune ne
   * remplace l'autre.
   */
  if (!peutModifierCatalogue(employe.role)) {
    return (
      <Modale titre="Nouvel article" onFermer={onFerme}>
        <p className="vide">
          Seul un gérant ou un administrateur peut ajouter un article à la carte.
        </p>
      </Modale>
    )
  }

  return (
    <Modale
      titre="Nouvel article"
      sousTitre="Il sera vendable immédiatement, et remontera au back-office dès que la caisse aura du réseau."
      onFermer={onFerme}
      pied={
        <>
          <button type="button" onClick={onFerme}>
            Annuler
          </button>
          <button
            type="button"
            className="principal"
            disabled={enCours || nom.trim() === '' || millimesSaisis === null}
            onClick={() => void creer()}
          >
            Ajouter à la carte
          </button>
        </>
      }
    >
      <div className="formulaire-article">
        <label>
          <span>Nom</span>
          <input
            type="text"
            value={nom}
            maxLength={200}
            autoFocus
            placeholder="Ojja merguez"
            onChange={(e) => setNom(e.target.value)}
          />
        </label>

        <label>
          <span>Prix (TND)</span>
          <input
            // `inputMode="decimal"` et non `type="number"` : sur Android, le
            // second refuse la virgule dans certaines locales — et la virgule
            // est ce que le gérant tape.
            type="text"
            inputMode="decimal"
            value={prix}
            placeholder="14,500"
            onChange={(e) => setPrix(e.target.value)}
          />
          <small>
            {millimesSaisis === null
              ? 'Montant illisible'
              : `soit ${formaterTND(millimesSaisis)}`}
          </small>
        </label>

        <label>
          <span>Catégorie</span>
          <select
            value={categorieId ?? ''}
            onChange={(e) => setCategorieId(e.target.value || null)}
          >
            <option value="">— sans catégorie —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
          {/*
            Le POSTE de préparation vient de la CATÉGORIE (migration 0025).
            Un article sans catégorie n'apparaît donc sur AUCUN écran de
            préparation — et cela ne se voit qu'en plein service.
          */}
          {categorieId === null && (
            <small className="avertissement">
              Sans catégorie, il n’apparaîtra sur aucun écran de cuisine ni de bar.
            </small>
          )}
        </label>

        <label>
          <span>TVA</span>
          <select value={tauxId ?? ''} onChange={(e) => setTauxId(e.target.value || null)}>
            {(taux ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom}
              </option>
            ))}
          </select>
        </label>

        {erreur && (
          <p className="erreur" role="alert">
            {erreur}
          </p>
        )}
      </div>
    </Modale>
  )
}
