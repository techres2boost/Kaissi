'use client'

/**
 * Les CATÉGORIES et les POSTES de préparation.
 *
 * ── Pourquoi un écran séparé de la liste d'articles ───────────────────────
 *
 * Les deux vivaient sur la même page, et la page faisait deux mètres de
 * long : on descendait chercher une catégorie sous quarante produits. Ce
 * sont pourtant deux gestes distincts — on range la carte une fois par
 * saison, on modifie un prix toutes les semaines.
 *
 * Postes et catégories restent ENSEMBLE, eux : le poste de préparation se
 * règle SUR la catégorie (migration 0025), et créer « Bar » pour y rattacher
 * « Boissons » dans la foulée doit tenir en un écran.
 */

import { useActionState } from 'react'
import {
  archiverCategorie,
  archiverPoste,
  creerCategorie,
  creerPoste,
  deplacerCategorie,
  desarchiverCategorie,
  modifierCategorie,
  renommerPoste,
  type Resultat,
} from '../app/[restaurant]/catalogue/actions.js'
import type { Categorie, Produit, Station } from './EditeurCatalogue.js'
import { Message } from './EditeurCatalogue.js'
import { useT } from '../i18n/client.js'

function LigneCategorie({
  restaurantId,
  categorie,
  stations,
}: {
  restaurantId: string
  categorie: Categorie
  stations: Station[]
}) {
  const t = useT()
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
        aria-label={t('Nom de la catégorie {nom}', { nom: categorie.nom })}
        style={{ maxWidth: '12rem' }}
      />
      <select
        name="station"
        defaultValue={categorie.stationId ?? ''}
        aria-label={t('Poste de {nom}', { nom: categorie.nom })}
        // Le changement VAUT validation : sans cela, un gérant choisit « Bar »,
        // change de page, et le réglage n'a jamais été enregistré — sans que
        // rien ne le lui dise.
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">{t('— non réglé —')}</option>
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nom}
          </option>
        ))}
      </select>
      <button type="submit" className="discret">{t('Enregistrer')}</button>
      {resultat?.erreur && <span className="ecart negatif">{t.m(resultat.erreur)}</span>}
    </form>
  )
}

/** Une ligne de poste : on le renomme sur place. */
function LignePoste({
  restaurantId,
  poste,
}: {
  restaurantId: string
  poste: Station
}) {
  const t = useT()
  const [resultat, action] = useActionState(
    renommerPoste.bind(null, restaurantId, poste.id),
    null as Resultat | null,
  )
  return (
    <form action={action} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <input
        name="nom"
        defaultValue={poste.nom}
        aria-label={t('Nom du poste {nom}', { nom: poste.nom })}
        style={{ maxWidth: '12rem' }}
      />
      <button type="submit" className="discret">{t('Renommer')}</button>
      {resultat?.erreur && <span className="ecart negatif">{t.m(resultat.erreur)}</span>}
    </form>
  )
}

/**
 * Les POSTES de préparation — cuisine, bar, pizzeria.
 *
 * Ils n'étaient créables nulle part : un restaurant qui voulait un troisième
 * poste devait passer par la base. Or sans poste, la catégorie n'a rien à
 * choisir, et ses lignes n'apparaissent sur AUCUN écran de préparation — ce
 * qui ne se voit qu'en plein service.
 *
 * La section est ici, juste au-dessus des catégories, parce que c'est le même
 * geste : on crée « Bar », puis on y rattache « Boissons », sans changer de
 * page.
 */
function PostesPreparation({
  restaurantId,
  modifiable,
  stations,
  categories,
}: {
  restaurantId: string
  modifiable: boolean
  stations: Station[]
  categories: Categorie[]
}) {
  const t = useT()
  const [resultat, action, enCours] = useActionState(
    creerPoste.bind(null, restaurantId),
    null as Resultat | null,
  )

  return (
    <section className="carte">
      <Message resultat={resultat} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
        <h2 style={{ marginBottom: 0 }}>{t('Postes de préparation')}</h2>
        <span className="etiquette">{stations.length}</span>
      </div>
      <p className="indication">{t('Un poste, c’est un écran : la cuisine voit le sien, le bar le sien. Un employé de rôle « cuisine » ou « bar » est rattaché à un poste dans')}<strong>{' '}{t('Employés')}</strong>{t(', et n’ouvre que celui-là.')}</p>

      {stations.length === 0 ? (
        <p className="vide">{t('Aucun poste. Tant qu’il n’y en a pas, aucune catégorie ne peut être rattachée, et rien n’apparaît sur les écrans de préparation.')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('Poste')}</th>
              <th className="nombre">{t('Catégories')}</th>
              {modifiable && <th />}
            </tr>
          </thead>
          <tbody>
            {stations.map((poste) => {
              const rattachees = categories.filter((c) => c.stationId === poste.id)
              return (
                <tr key={poste.id}>
                  <td>
                    {modifiable ? (
                      <LignePoste restaurantId={restaurantId} poste={poste} />
                    ) : (
                      poste.nom
                    )}
                  </td>
                  <td className="nombre">
                    {rattachees.length === 0 ? (
                      <span className="etiquette inactif">{t('aucune')}</span>
                    ) : (
                      rattachees.length
                    )}
                  </td>
                  {modifiable && (
                    <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="discret danger"
                        onClick={() => {
                          if (confirm(t('Archiver le poste « {nom} » ?', { nom: poste.nom }))) {
                            void archiverPoste(restaurantId, poste.id)
                          }
                        }}
                      >{t('Archiver')}</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {modifiable && (
        <form action={action} style={{ marginTop: '1rem' }}>
          <div className="champ">
            <label htmlFor="nom-poste">{t('Nouveau poste')}</label>
            <input id="nom-poste" name="nom" placeholder={t('Pizzeria')} required maxLength={60} />
            <p className="indication">{t('Le nom est libre et se change à tout moment : le rattachement des employés et des catégories se fait par identifiant, jamais par le nom. Renommer « Bar » en « Comptoir » ne vide donc aucun écran.')}</p>
          </div>
          {/*
            `max + 1`, et non `length + 1` : après un archivage, la longueur
            de la liste retombe sous la plus grande position existante et deux
            postes se retrouveraient sur le même rang.
          */}
          <input
            type="hidden"
            name="position"
            value={String(stations.reduce((m, s) => Math.max(m, s.position ?? 0), 0) + 1)}
          />
          <button type="submit" disabled={enCours}>
            {enCours ? t('Création…') : t('Créer le poste')}
          </button>
        </form>
      )}
    </section>
  )
}

export function GestionCategories({
  restaurantId,
  modifiable,
  categories,
  stations,
  produits,
  archivees,
}: {
  restaurantId: string
  modifiable: boolean
  categories: Categorie[]
  stations: Station[]
  produits: Produit[]
  archivees: Categorie[]
}) {
  const t = useT()
  const [resultatCategorie, actionCategorie, categorieEnCours] = useActionState(
    creerCategorie.bind(null, restaurantId),
    null as Resultat | null,
  )

  return (
    <>
      <Message resultat={resultatCategorie} />

      <PostesPreparation
        restaurantId={restaurantId}
        modifiable={modifiable}
        stations={stations}
        categories={categories}
      />

      <section className="carte">
        <h2>{t('Catégories')}</h2>
        <p className="indication">{t('Le')}{' '}<strong>{t('poste de préparation')}</strong>{' '}{t('se règle ici, pas produit par produit : tout ce que contient « Boissons » part au bar, y compris ce que vous y ajouterez dans six mois. Une catégorie sans poste n’apparaît sur aucun écran de préparation.')}</p>
        {categories.length === 0 ? (
          <p className="vide">{t('Aucune catégorie — les produits apparaîtront tous ensemble.')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('Catégorie')}</th>
                <th>{t('Poste de préparation')}</th>
                <th className="nombre">{t('Produits')}</th>
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
                      <span className="etiquette inactif">{t('non réglé')}</span>
                    ) : (
                      (stations.find((s) => s.id === categorie.stationId)?.nom ?? '—')
                    )}
                  </td>
                  <td className="nombre">
                    {produits.filter((p) => p.categorieId === categorie.id).length}
                  </td>
                  {modifiable && (
                    <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="discret"
                        disabled={rang === 0}
                        title={t('Monter')}
                        onClick={() => void deplacerCategorie(restaurantId, categorie.id, 'haut')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="discret"
                        disabled={rang === categories.length - 1}
                        title={t('Descendre')}
                        onClick={() => void deplacerCategorie(restaurantId, categorie.id, 'bas')}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="discret danger"
                        onClick={() => {
                          if (confirm(t('Archiver la catégorie « {nom} » ?', { nom: categorie.nom }))) {
                            void archiverCategorie(restaurantId, categorie.id)
                          }
                        }}
                      >{t('Archiver')}</button>
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
              <label htmlFor="nom-categorie">{t('Nouvelle catégorie')}</label>
              <input id="nom-categorie" name="nom" placeholder={t('Desserts')} required />
              <p className="indication">{t('Elle se place à la fin ; les flèches la déplacent ensuite. Son poste de préparation se choisit sur sa ligne.')}</p>
            </div>
            {/* La position ne se saisit plus : elle se règle avec les flèches. */}
            <input
              type="hidden"
              name="position"
              value={String(categories.reduce((m, c) => Math.max(m, c.position), 0) + 1)}
            />
            <button type="submit" disabled={categorieEnCours}>
              {categorieEnCours ? t('Création…') : t('Créer la catégorie')}
            </button>
          </form>
        )}
      </section>


      {modifiable && archivees.length > 0 && (
        <section className="carte">
          <h2>{t('Catégories archivées')}</h2>
          <p className="indication">{t('Archiver n’est pas supprimer : l’historique des ventes garde la référence. Remettre une catégorie la replace en fin de liste.')}</p>
          <table>
            <tbody>
              {archivees.map((categorie) => (
                <tr key={categorie.id}>
                  <td>{categorie.nom}</td>
                  <td style={{ textAlign: 'end' }}>
                    <button
                      type="button"
                      className="discret"
                      onClick={() => void desarchiverCategorie(restaurantId, categorie.id)}
                    >{t('Remettre')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
