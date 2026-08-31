'use client'

import { useActionState, useState } from 'react'
import {
  archiverCategorie,
  archiverProduit,
  basculerDisponibilite,
  creerCategorie,
  enregistrerProduit,
  type Resultat,
} from '../app/[restaurant]/catalogue/actions.js'
import { pourChampMontant } from '../serveur/formulaire.js'
import { formaterPourcentage, formaterTND, margeProduit, millimes } from '@kaissi/domain'

/**
 * La marge d'un produit, telle qu'elle s'affiche au catalogue.
 *
 * Calculée par `@kaissi/domain` — le même module que les rapports et la
 * caisse. Un burger à 15 dinars acheté 10 affiche « 5,000 TND · 33,33 % ».
 */
function margeAffichee(produit: Produit) {
  if (produit.coutUnitaire === null) return <span className="detail">—</span>
  const marge = margeProduit(millimes(produit.prixMillimes), produit.coutUnitaire)
  return (
    <span className={marge.margeMillimes < 0 ? 'ecart negatif' : ''}>
      {formaterTND(marge.margeMillimes)}
      {marge.margeBp !== null && (
        <small className="detail"> {formaterPourcentage(marge.margeBp)} %</small>
      )}
    </span>
  )
}

export interface Categorie {
  id: string
  nom: string
  position: number
}
export interface Station {
  id: string
  nom: string
}
export interface Taux {
  id: string
  nom: string
  libelle: string
  defaut: boolean
}
export interface Produit {
  id: string
  nom: string
  description: string
  categorieId: string
  stationId: string
  tauxId: string
  prixMillimes: number
  prixAffiche: string
  /** Coût d'achat unitaire en millimes fractionnaires, ou `null` si non saisi. */
  coutUnitaire: number | null
  position: number
  disponible: boolean
}

export function EditeurCatalogue({
  restaurantId,
  modifiable,
  categories,
  stations,
  taux,
  produits,
}: {
  restaurantId: string
  modifiable: boolean
  categories: Categorie[]
  stations: Station[]
  taux: Taux[]
  produits: Produit[]
}) {
  const [enEdition, setEnEdition] = useState<Produit | null>(null)
  const [nouveau, setNouveau] = useState(false)

  const idsCategories = categories.map((c) => c.id)
  const idsStations = stations.map((s) => s.id)
  const idsTaux = taux.map((t) => t.id)

  const [resultatProduit, actionProduit, produitEnCours] = useActionState(
    enregistrerProduit.bind(null, restaurantId, idsCategories, idsStations, idsTaux),
    null as Resultat | null,
  )
  const [resultatCategorie, actionCategorie, categorieEnCours] = useActionState(
    creerCategorie.bind(null, restaurantId),
    null as Resultat | null,
  )

  const formulaireOuvert = nouveau || enEdition !== null
  const cible = enEdition

  return (
    <>
      <Message resultat={resultatProduit} />
      <Message resultat={resultatCategorie} />

      <section className="carte">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
          <h2 style={{ marginBottom: 0 }}>Produits</h2>
          <span className="etiquette">{produits.length}</span>
          {modifiable && !formulaireOuvert && taux.length > 0 && (
            <button
              type="button"
              className="principal"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                setEnEdition(null)
                setNouveau(true)
              }}
            >
              Ajouter un produit
            </button>
          )}
        </div>

        {formulaireOuvert && (
          <form
            action={actionProduit}
            className="carte"
            style={{ marginTop: '1rem', background: 'var(--panneau-clair)' }}
            key={cible?.id ?? 'nouveau'}
          >
            <h2>{cible ? `Modifier « ${cible.nom} »` : 'Nouveau produit'}</h2>
            {cible && <input type="hidden" name="id" value={cible.id} />}

            <div className="champs deux">
              <div className="champ">
                <label htmlFor="nom">Nom</label>
                <input id="nom" name="nom" defaultValue={cible?.nom ?? ''} required autoFocus />
              </div>
              <div className="champ">
                <label htmlFor="prix">Prix de vente</label>
                <input
                  id="prix"
                  name="prix"
                  inputMode="decimal"
                  defaultValue={cible ? pourChampMontant(cible.prixMillimes) : ''}
                  placeholder="24.500"
                  required
                />
                <p className="indication">
                  En dinars, avec <strong>trois</strong> décimales. « 24,5 » et « 24.500 »
                  donnent le même prix.
                </p>
              </div>

              <div className="champ">
                <label htmlFor="cout">Coût d’achat (facultatif)</label>
                <input
                  id="cout"
                  name="cout"
                  inputMode="decimal"
                  defaultValue={
                    cible?.coutUnitaire === null || cible?.coutUnitaire === undefined
                      ? ''
                      : String(cible.coutUnitaire / 1000)
                  }
                  placeholder="10"
                />
                <p className="indication">
                  Ce que le produit vous COÛTE, en dinars. C’est lui qui donne la
                  marge dans les rapports. Laissé vide, le produit est compté
                  sans coût — et les rapports le signalent, plutôt que d’afficher
                  une marge de 100 % qui paraîtrait juste.
                </p>
              </div>
            </div>

            <div className="champs deux">
              <div className="champ">
                <label htmlFor="categorie">Catégorie</label>
                <select id="categorie" name="categorie" defaultValue={cible?.categorieId ?? ''}>
                  <option value="">— aucune —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label htmlFor="taux">Taux de TVA</label>
                <select
                  id="taux"
                  name="taux"
                  defaultValue={cible?.tauxId ?? taux.find((t) => t.defaut)?.id ?? ''}
                  required
                >
                  {taux.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.libelle}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="champs deux">
              <div className="champ">
                <label htmlFor="station">Station de préparation</label>
                <select id="station" name="station" defaultValue={cible?.stationId ?? ''}>
                  <option value="">— aucune, pas de bon de cuisine —</option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom}
                    </option>
                  ))}
                </select>
                <p className="indication">
                  Décide sur quelle imprimante part le bon. Sans station, le produit ne
                  génère aucun bon — ce qui est correct pour une boisson servie au bar.
                </p>
              </div>
              <div className="champ">
                <label htmlFor="position">Position dans la grille</label>
                <input
                  id="position"
                  name="position"
                  inputMode="numeric"
                  defaultValue={String(cible?.position ?? 0)}
                />
              </div>
            </div>

            <div className="champ">
              <label htmlFor="description">Description</label>
              <input id="description" name="description" defaultValue={cible?.description ?? ''} />
            </div>

            <div className="case" style={{ marginBottom: '1rem' }}>
              <input
                id="disponible"
                name="disponible"
                type="checkbox"
                defaultChecked={cible ? cible.disponible : true}
              />
              <label htmlFor="disponible">En vente</label>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="principal" disabled={produitEnCours}>
                {produitEnCours ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEnEdition(null)
                  setNouveau(false)
                }}
              >
                Annuler
              </button>
            </div>
          </form>
        )}

        {produits.length === 0 ? (
          <p className="vide">Aucun produit. La carte est vide.</p>
        ) : (
          <table style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th className="nombre">Prix</th>
                <th className="nombre">Coût</th>
                <th className="nombre">Marge</th>
                <th>État</th>
                {modifiable && <th />}
              </tr>
            </thead>
            <tbody>
              {produits.map((produit) => (
                <tr key={produit.id}>
                  <td>
                    {produit.nom}
                    {produit.description && (
                      <div className="indication">{produit.description}</div>
                    )}
                  </td>
                  <td>{categories.find((c) => c.id === produit.categorieId)?.nom ?? '—'}</td>
                  <td className="nombre">{produit.prixAffiche}</td>
                  <td className="nombre">
                    {produit.coutUnitaire === null ? (
                      <span className="detail">—</span>
                    ) : (
                      formaterTND(millimes(Math.round(produit.coutUnitaire)))
                    )}
                  </td>
                  <td className="nombre">{margeAffichee(produit)}</td>
                  <td>
                    <span className={`etiquette ${produit.disponible ? 'actif' : 'inactif'}`}>
                      {produit.disponible ? 'en vente' : 'retiré'}
                    </span>
                  </td>
                  {modifiable && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="discret"
                        onClick={() => {
                          setNouveau(false)
                          setEnEdition(produit)
                        }}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="discret"
                        onClick={() =>
                          void basculerDisponibilite(
                            restaurantId,
                            produit.id,
                            !produit.disponible,
                          )
                        }
                      >
                        {produit.disponible ? 'Retirer' : 'Remettre'}
                      </button>
                      <button
                        type="button"
                        className="discret danger"
                        onClick={() => {
                          if (
                            confirm(
                              `Archiver « ${produit.nom} » ?\n\n` +
                                'Il disparaît de la carte mais reste visible dans les commandes ' +
                                'déjà passées.',
                            )
                          ) {
                            void archiverProduit(restaurantId, produit.id)
                          }
                        }}
                      >
                        Archiver
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="carte">
        <h2>Catégories</h2>
        {categories.length === 0 ? (
          <p className="vide">Aucune catégorie — les produits apparaîtront tous ensemble.</p>
        ) : (
          <table>
            <tbody>
              {categories.map((categorie) => (
                <tr key={categorie.id}>
                  <td>{categorie.nom}</td>
                  <td className="nombre">
                    {produits.filter((p) => p.categorieId === categorie.id).length} produit(s)
                  </td>
                  {modifiable && (
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="discret danger"
                        onClick={() => {
                          if (confirm(`Archiver la catégorie « ${categorie.nom} » ?`)) {
                            void archiverCategorie(restaurantId, categorie.id)
                          }
                        }}
                      >
                        Archiver
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {modifiable && (
          <form action={actionCategorie} style={{ marginTop: '1rem' }}>
            <div className="champs deux">
              <div className="champ">
                <label htmlFor="nom-categorie">Nouvelle catégorie</label>
                <input id="nom-categorie" name="nom" placeholder="Desserts" required />
              </div>
              <div className="champ">
                <label htmlFor="position-categorie">Position</label>
                <input id="position-categorie" name="position" inputMode="numeric" defaultValue="0" />
              </div>
            </div>
            <button type="submit" disabled={categorieEnCours}>
              {categorieEnCours ? 'Création…' : 'Créer la catégorie'}
            </button>
          </form>
        )}
      </section>
    </>
  )
}

function Message({ resultat }: { resultat: Resultat | null }) {
  if (!resultat) return null
  if (resultat.erreur) {
    return (
      <p className="message erreur" role="alert">
        {resultat.erreur}
      </p>
    )
  }
  return <p className="message succes">{resultat.succes}</p>
}
