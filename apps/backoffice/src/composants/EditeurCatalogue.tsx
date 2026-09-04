'use client'

import { useActionState, useState } from 'react'
import {
  archiverCategorie,
  archiverProduit,
  basculerDisponibilite,
  creerCategorie,
  deplacerCategorie,
  deplacerProduit,
  desarchiverCategorie,
  desarchiverProduit,
  enregistrerProduit,
  modifierCategorie,
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
  /** Poste de préparation de TOUS ses produits — `null` : non réglé. */
  stationId: string | null
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

/**
 * Une ligne de catégorie modifiable : son nom et son POSTE.
 *
 * Un formulaire par ligne plutôt qu'un écran d'édition séparé : régler le
 * poste de six catégories doit prendre six clics, pas six allers-retours.
 * Le formulaire s'enregistre au changement du menu déroulant — le geste le
 * plus fréquent — et le nom au moment où on quitte le champ.
 */
function LigneCategorie({
  restaurantId,
  categorie,
  stations,
}: {
  restaurantId: string
  categorie: Categorie
  stations: Station[]
}) {
  const [resultat, action] = useActionState(
    modifierCategorie.bind(
      null,
      restaurantId,
      categorie.id,
      stations.map((s) => s.id),
    ),
    null as Resultat | null,
  )

  return (
    <form action={action} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <input
        name="nom"
        defaultValue={categorie.nom}
        aria-label={`Nom de la catégorie ${categorie.nom}`}
        style={{ maxWidth: '12rem' }}
      />
      <select
        name="station"
        defaultValue={categorie.stationId ?? ''}
        aria-label={`Poste de ${categorie.nom}`}
        // Le changement VAUT validation : sans cela, un gérant choisit « Bar »,
        // change de page, et le réglage n'a jamais été enregistré — sans que
        // rien ne le lui dise.
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">— non réglé —</option>
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nom}
          </option>
        ))}
      </select>
      <button type="submit" className="discret">
        Enregistrer
      </button>
      {resultat?.erreur && <span className="ecart negatif">{resultat.erreur}</span>}
    </form>
  )
}

export function EditeurCatalogue({
  restaurantId,
  modifiable,
  categories,
  stations,
  taux,
  produits,
  archivees,
  produitsArchives,
}: {
  restaurantId: string
  modifiable: boolean
  categories: Categorie[]
  stations: Station[]
  taux: Taux[]
  produits: Produit[]
  /** Ce qui a été archivé, pour pouvoir le remettre. */
  archivees: Categorie[]
  produitsArchives: Produit[]
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

  /**
   * Où se place un NOUVEAU produit : à la fin.
   *
   * `max + 1` et non `produits.length` : après quelques archivages, la
   * longueur de la liste retombe sous la plus grande position existante, et
   * deux produits se retrouveraient sur le même nombre.
   */
  const positionSuivante = produits.reduce((max, p) => Math.max(max, p.position), 0) + 1

  /** Les produits de la même catégorie, dans l'ordre affiché. */
  const memeCategorie = (produit: Produit) =>
    produits.filter((p) => p.categorieId === produit.categorieId)
  const rangDansCategorie = (produit: Produit) =>
    memeCategorie(produit).findIndex((p) => p.id === produit.id)
  const tailleCategorie = (produit: Produit) => memeCategorie(produit).length

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
              {/*
                Un SEUL taux dans l'établissement : on ne pose pas la question.
                Un menu déroulant à une entrée n'est pas un choix, c'est une
                étape de plus à chaque produit — et une occasion de se tromper
                le jour où un second taux apparaîtra sans qu'on y prenne garde.
                Le taux part quand même, en champ caché : le serveur le valide
                comme avant, rien n'est relâché.
              */}
              {taux.length <= 1 ? (
                <input
                  type="hidden"
                  name="taux"
                  value={cible?.tauxId ?? taux.find((t) => t.defaut)?.id ?? taux[0]?.id ?? ''}
                />
              ) : (
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
              )}
            </div>

            {/*
              Ni POSTE ni POSITION ici — et c'est le fond du changement.

              Le poste appartient à la CATÉGORIE (migration 0025) : le
              demander produit par produit, c'est demander à un gérant de s'en
              souvenir à chaque création, et il ne s'en souviendra pas. Un
              produit sans poste n'apparaît sur AUCUN écran de préparation, et
              cela ne se voit qu'en plein service. Réglé une fois pour
              « Boissons », il vaut pour tout ce qu'on y mettra ensuite.

              La position se règle avec les flèches de la liste. Un champ
              numérique obligeait à deviner quel entier est libre et à
              renuméroter le reste à la main — et deux produits finissaient
              régulièrement sur le même nombre, où l'ordre devenait celui du
              hasard. La position d'un produit existant est conservée telle
              quelle ; un nouveau se place à la fin.
            */}
            <input
              type="hidden"
              name="position"
              value={String(cible?.position ?? positionSuivante)}
            />

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
              <label htmlFor="disponible">Disponible à la vente</label>
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
                      {/*
                        L'ordre se règle ici, d'un cran à la fois, DANS la
                        catégorie du produit. Les flèches sont grisées aux
                        extrémités de sa propre catégorie, pas de la liste
                        entière : un produit ne se mélange pas à une autre
                        grille.
                      */}
                      <button
                        type="button"
                        className="discret"
                        disabled={rangDansCategorie(produit) === 0}
                        title="Monter"
                        onClick={() => void deplacerProduit(restaurantId, produit.id, 'haut')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="discret"
                        disabled={rangDansCategorie(produit) === tailleCategorie(produit) - 1}
                        title="Descendre"
                        onClick={() => void deplacerProduit(restaurantId, produit.id, 'bas')}
                      >
                        ↓
                      </button>
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
        <p className="indication">
          Le <strong>poste de préparation</strong> se règle ici, pas produit par
          produit : tout ce que contient « Boissons » part au bar, y compris ce
          que vous y ajouterez dans six mois. Une catégorie sans poste
          n’apparaît sur aucun écran de préparation.
        </p>
        {categories.length === 0 ? (
          <p className="vide">Aucune catégorie — les produits apparaîtront tous ensemble.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Catégorie</th>
                <th>Poste de préparation</th>
                <th className="nombre">Produits</th>
                {modifiable && <th />}
              </tr>
            </thead>
            <tbody>
              {categories.map((categorie, rang) => (
                <tr key={categorie.id}>
                  <td>
                    {modifiable ? (
                      <LigneCategorie
                        restaurantId={restaurantId}
                        categorie={categorie}
                        stations={stations}
                      />
                    ) : (
                      categorie.nom
                    )}
                  </td>
                  <td>
                    {categorie.stationId === null ? (
                      <span className="etiquette inactif">non réglé</span>
                    ) : (
                      (stations.find((s) => s.id === categorie.stationId)?.nom ?? '—')
                    )}
                  </td>
                  <td className="nombre">
                    {produits.filter((p) => p.categorieId === categorie.id).length}
                  </td>
                  {modifiable && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="discret"
                        disabled={rang === 0}
                        title="Monter"
                        onClick={() => void deplacerCategorie(restaurantId, categorie.id, 'haut')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="discret"
                        disabled={rang === categories.length - 1}
                        title="Descendre"
                        onClick={() => void deplacerCategorie(restaurantId, categorie.id, 'bas')}
                      >
                        ↓
                      </button>
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
            <div className="champ">
              <label htmlFor="nom-categorie">Nouvelle catégorie</label>
              <input id="nom-categorie" name="nom" placeholder="Desserts" required />
              <p className="indication">
                Elle se place à la fin ; les flèches la déplacent ensuite. Son
                poste de préparation se choisit sur sa ligne.
              </p>
            </div>
            {/* La position ne se saisit plus : elle se règle avec les flèches. */}
            <input
              type="hidden"
              name="position"
              value={String(categories.reduce((m, c) => Math.max(m, c.position), 0) + 1)}
            />
            <button type="submit" disabled={categorieEnCours}>
              {categorieEnCours ? 'Création…' : 'Créer la catégorie'}
            </button>
          </form>
        )}
      </section>

      {modifiable && (archivees.length > 0 || produitsArchives.length > 0) && (
        <section className="carte">
          <h2>Archive</h2>
          {/*
            Archiver n'est pas supprimer — l'historique des ventes garde la
            référence — mais c'était jusqu'ici SANS RETOUR. Une catégorie
            archivée par erreur ne pouvait plus être remise : il fallait la
            recréer, avec un nouvel identifiant, donc en coupant l'historique
            en deux. Et rien ne montrait ce qui avait été archivé.
          */}
          <p className="indication">
            Rien n’est supprimé : les commandes déjà passées mentionnent
            toujours ces lignes. Un produit remis revient <strong>hors
            vente</strong> — le remettre à la carte est une seconde décision.
          </p>

          {archivees.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Catégorie archivée</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {archivees.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nom}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="discret"
                        onClick={() => void desarchiverCategorie(restaurantId, c.id)}
                      >
                        Remettre
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {produitsArchives.length > 0 && (
            <table style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>Produit archivé</th>
                  <th className="nombre">Prix</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {produitsArchives.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nom}</td>
                    <td className="nombre">{p.prixAffiche}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="discret"
                        onClick={() => void desarchiverProduit(restaurantId, p.id)}
                      >
                        Remettre
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
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
