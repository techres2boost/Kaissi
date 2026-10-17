'use client'

/**
 * Les modificateurs — « + Fromage 1,500 », « Bien cuit », « Sans oignon ».
 *
 * ── Ce qu'ils changent ────────────────────────────────────────────────────
 *
 * Le PRIX DE LA LIGNE : `prixBase + Σ modificateurs`, l'étape 1 de l'ordre
 * figé de `packages/domain/src/totaux.ts`. Ni le taux de taxe — celui de
 * l'article s'applique au tout — ni le stock : un supplément n'est pas un
 * article vendu.
 *
 * ── La forme de l'écran, et pourquoi elle est en deux temps ───────────────
 *
 * Un groupe, ses choix, puis les articles qui le portent. C'est l'ordre dans
 * lequel on y pense : on invente « Cuisson », on liste « Saignant / À point /
 * Bien cuit », et seulement ensuite on dit à quels plats ça s'applique.
 *
 * Le rattachement est DANS le groupe, pas dans la fiche article : on rattache
 * un groupe à douze plats d'un coup, alors qu'on ouvrirait douze fiches pour
 * faire l'inverse.
 */

import { useActionState, useMemo, useState, useTransition } from 'react'
import { formaterTND, millimes } from '@kaissi/domain'
import { Check, Plus, TriangleAlert, UtensilsCrossed } from 'lucide-react'
import {
  archiverGroupe,
  archiverModificateur,
  creerGroupe,
  creerModificateur,
  modifierGroupe,
  modifierModificateur,
  rattacherGroupe,
  type Resultat,
} from '../app/[restaurant]/modificateurs/actions.js'
import { useT } from '../i18n/client.js'
import type { Traduction } from '../i18n/commun.js'

export interface ChoixModificateur {
  id: string
  nom: string
  deltaMillimes: number
  archive: boolean
}

export interface GroupeModificateurs {
  id: string
  nom: string
  minSelect: number
  maxSelect: number
  archive: boolean
  choix: ChoixModificateur[]
  /** Identifiants des articles qui portent ce groupe. */
  produits: string[]
}

export interface ArticleSimple {
  id: string
  nom: string
  categorieNom: string
}

/** « 0 » veut dire « sans limite » côté base ; on le dit en toutes lettres. */
function reglesDuGroupe(t: Traduction, g: GroupeModificateurs): string {
  const min =
    g.minSelect === 0
      ? t('facultatif')
      : g.minSelect === 1
        ? t('un choix obligatoire')
        : t('{n} choix obligatoires', { n: g.minSelect })
  const max = g.maxSelect === 0 ? t('sans maximum') : t('{n} au plus', { n: g.maxSelect })
  return t('{min}, {max}', { min, max })
}

/** Le montant tel qu'un champ de saisie doit l'afficher : « 1.500 », « -0.500 ». */
function pourChampPrix(m: number): string {
  const signe = m < 0 ? '-' : ''
  const a = Math.abs(m)
  return `${signe}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`
}

function LigneChoix({
  restaurantId,
  choix,
  modifiable,
}: {
  restaurantId: string
  choix: ChoixModificateur
  modifiable: boolean
}) {
  const t = useT()
  const [resultat, action] = useActionState(
    modifierModificateur.bind(null, restaurantId, choix.id),
    null as Resultat | null,
  )
  const [enCours, demarrer] = useTransition()
  const [retour, setRetour] = useState<Resultat | null>(null)

  return (
    <li className={choix.archive ? 'archive' : ''}>
      <form action={action} className="ligne-paiement">
        <input
          name="nom"
          defaultValue={choix.nom}
          aria-label={t('Nom du choix')}
          maxLength={100}
          disabled={choix.archive || !modifiable}
        />
        <span className="champ-taux">
          <input
            name="prix"
            defaultValue={pourChampPrix(choix.deltaMillimes)}
            aria-label={t('Supplément de {nom}', { nom: choix.nom })}
            inputMode="decimal"
            disabled={choix.archive || !modifiable}
          />
          <span className="detail">TND</span>
        </span>
        {modifiable && (
          <button type="submit" className="discret" disabled={choix.archive}>{t('Enregistrer')}</button>
        )}
        {modifiable && (
          <button
            type="button"
            className="discret"
            disabled={enCours}
            onClick={() =>
              demarrer(() => {
                void archiverModificateur(restaurantId, choix.id, !choix.archive).then(
                  setRetour,
                )
              })
            }
          >
            {choix.archive ? t('Remettre') : t('Archiver')}
          </button>
        )}
      </form>
      {resultat?.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
      {resultat?.succes && <p className="message succes">{t.m(resultat.succes)}</p>}
      {retour?.erreur && <p className="message erreur">{t.m(retour.erreur)}</p>}
    </li>
  )
}

/**
 * Le rattachement aux articles.
 *
 * Une liste de cases, filtrable — et non une liste déroulante à choix
 * multiple : sur quarante plats, il faut VOIR ce qui est coché sans dérouler,
 * parce que la question posée est « lesquels », pas « lequel ».
 */
function Rattachement({
  restaurantId,
  groupe,
  articles,
  modifiable,
}: {
  restaurantId: string
  groupe: GroupeModificateurs
  articles: ArticleSimple[]
  modifiable: boolean
}) {
  const t = useT()
  const [filtre, setFiltre] = useState('')
  const [enCours, demarrer] = useTransition()
  const [retour, setRetour] = useState<Resultat | null>(null)
  const rattaches = useMemo(() => new Set(groupe.produits), [groupe.produits])

  const visibles = useMemo(() => {
    const q = filtre.trim().toLowerCase()
    if (q === '') return articles
    return articles.filter(
      (a) =>
        a.nom.toLowerCase().includes(q) || a.categorieNom.toLowerCase().includes(q),
    )
  }, [articles, filtre])

  return (
    <details className="rattachement" open={groupe.produits.length === 0}>
      <summary>
        <UtensilsCrossed size={15} strokeWidth={1.9} aria-hidden="true" />{' '}
        {groupe.produits.length === 0 ? (
          <strong>{t('Aucun article — ce groupe ne s’affichera nulle part')}</strong>
        ) : (
          <>
            {groupe.produits.length}{' '}{t('article(s) rattaché(s)')}</>
        )}
      </summary>

      {articles.length > 8 && (
        <input
          className="filtre-articles"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder={t('Filtrer par nom ou catégorie…')}
          aria-label={t('Filtrer les articles')}
        />
      )}

      <ul className="cases-articles">
        {visibles.map((a) => {
          const coche = rattaches.has(a.id)
          return (
            <li key={a.id}>
              <label className="case">
                <input
                  type="checkbox"
                  checked={coche}
                  disabled={enCours || !modifiable}
                  onChange={() =>
                    demarrer(() => {
                      void rattacherGroupe(restaurantId, groupe.id, a.id, !coche).then(
                        setRetour,
                      )
                    })
                  }
                />
                <span>
                  {a.nom} <span className="detail">· {a.categorieNom}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {visibles.length === 0 && (
        <p className="indication">{t('Aucun article ne correspond à ce filtre.')}</p>
      )}
      {retour?.erreur && <p className="message erreur">{t.m(retour.erreur)}</p>}
    </details>
  )
}

function CarteGroupe({
  restaurantId,
  groupe,
  articles,
  modifiable,
}: {
  restaurantId: string
  groupe: GroupeModificateurs
  articles: ArticleSimple[]
  modifiable: boolean
}) {
  const t = useT()
  const [resultatGroupe, actionGroupe] = useActionState(
    modifierGroupe.bind(null, restaurantId, groupe.id),
    null as Resultat | null,
  )
  const [resultatChoix, actionChoix] = useActionState(
    creerModificateur.bind(null, restaurantId, groupe.id),
    null as Resultat | null,
  )
  const [enCours, demarrer] = useTransition()
  const [retour, setRetour] = useState<Resultat | null>(null)

  const actifs = groupe.choix.filter((c) => !c.archive)

  return (
    <section className={`carte carte-groupe ${groupe.archive ? 'archive' : ''}`}>
      <form action={actionGroupe} className="ligne-imprimante">
        <input
          name="nom"
          defaultValue={groupe.nom}
          aria-label={t('Nom du groupe')}
          maxLength={100}
          disabled={groupe.archive || !modifiable}
        />
        <span className="champ-taux">
          <span className="detail">{t('min')}</span>
          <input
            name="min"
            defaultValue={String(groupe.minSelect)}
            aria-label={t('Minimum de {nom}', { nom: groupe.nom })}
            inputMode="numeric"
            maxLength={2}
            disabled={groupe.archive || !modifiable}
          />
        </span>
        <span className="champ-taux">
          <span className="detail">{t('max')}</span>
          <input
            name="max"
            defaultValue={String(groupe.maxSelect)}
            aria-label={t('Maximum de {nom}', { nom: groupe.nom })}
            inputMode="numeric"
            maxLength={2}
            disabled={groupe.archive || !modifiable}
          />
        </span>
        {modifiable && (
          <button type="submit" className="discret" disabled={groupe.archive}>{t('Enregistrer')}</button>
        )}
        {modifiable && (
          <button
            type="button"
            className="discret"
            disabled={enCours}
            onClick={() =>
              demarrer(() => {
                void archiverGroupe(restaurantId, groupe.id, !groupe.archive).then(setRetour)
              })
            }
          >
            {groupe.archive ? t('Remettre en service') : t('Archiver')}
          </button>
        )}
      </form>
      <p className="indication">
        {reglesDuGroupe(t, groupe)}. <strong>{t('min')}</strong>{' '}{t(': combien de choix le caissier DOIT faire (0 = facultatif).')}{' '}<strong>{t('max')}</strong>{' '}{t(': combien il PEUT en faire au plus (0 = autant qu’il veut).')}</p>
      {resultatGroupe?.erreur && <p className="message erreur">{t.m(resultatGroupe.erreur)}</p>}
      {resultatGroupe?.succes && <p className="message succes">{t.m(resultatGroupe.succes)}</p>}
      {retour?.erreur && <p className="message erreur">{t.m(retour.erreur)}</p>}
      {retour?.succes && <p className="message succes">{t.m(retour.succes)}</p>}

      {actifs.length === 0 && (
        <p className="message avertissement">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />{' '}
          <strong>{t('Aucun choix.')}</strong>{' '}{t('Un groupe vide n’apparaît pas en caisse — il n’y aurait rien à proposer.')}</p>
      )}

      <ul className="liste-taux">
        {groupe.choix.map((c) => (
          <LigneChoix key={c.id} restaurantId={restaurantId} choix={c} modifiable={modifiable} />
        ))}
      </ul>

      {modifiable && !groupe.archive && (
        <form action={actionChoix} className="ligne-imprimante ajout-choix">
          <input
            name="nom"
            placeholder={t('Nom du choix')}
            maxLength={100}
            aria-label={t('Nom du choix à ajouter à {nom}', { nom: groupe.nom })}
          />
          <span className="champ-taux">
            <input
              name="prix"
              placeholder="0.000"
              inputMode="decimal"
              aria-label={t('Supplément')}
            />
            <span className="detail">TND</span>
          </span>
          <button type="submit" className="discret">
            <Plus size={15} strokeWidth={2.2} aria-hidden="true" />{' '}{t('Ajouter le choix')}</button>
          {resultatChoix?.erreur && <p className="message erreur">{t.m(resultatChoix.erreur)}</p>}
        </form>
      )}

      <Rattachement
        restaurantId={restaurantId}
        groupe={groupe}
        articles={articles}
        modifiable={modifiable && !groupe.archive}
      />
    </section>
  )
}

export function GestionModificateurs({
  restaurantId,
  modifiable,
  groupes,
  articles,
}: {
  restaurantId: string
  modifiable: boolean
  groupes: GroupeModificateurs[]
  articles: ArticleSimple[]
}) {
  const t = useT()
  const [resultat, action] = useActionState(
    creerGroupe.bind(null, restaurantId),
    null as Resultat | null,
  )

  return (
    <>
      {groupes.length === 0 && (
        <div className="message info">
          <strong>{t('Aucun groupe de modificateurs.')}</strong>{' '}{t('Un groupe rassemble des choix qui vont ensemble — « Cuisson » avec saignant, à point, bien cuit ; « Suppléments » avec fromage, œuf, harissa. La caisse les propose quand on touche un article qui les porte.')}</div>
      )}

      {groupes.map((g) => (
        <CarteGroupe
          key={g.id}
          restaurantId={restaurantId}
          groupe={g}
          articles={articles}
          modifiable={modifiable}
        />
      ))}

      {modifiable && (
        <form action={action} className="carte formulaire-taux">
          <h2>{t('Nouveau groupe')}</h2>
          <label htmlFor="grp-nom">{t('Nom')}</label>
          <input id="grp-nom" name="nom" maxLength={100} placeholder={t('Cuisson')} />

          <label htmlFor="grp-min">{t('Choix obligatoires (0 = facultatif)')}</label>
          <input id="grp-min" name="min" defaultValue="0" inputMode="numeric" maxLength={2} />

          <label htmlFor="grp-max">{t('Choix au maximum (0 = sans limite)')}</label>
          <input id="grp-max" name="max" defaultValue="0" inputMode="numeric" maxLength={2} />

          <p className="indication">
            <Check size={14} strokeWidth={2.2} aria-hidden="true" />{' '}{t('« Cuisson » se règle sur 1 et 1 : un choix, un seul. « Suppléments » sur 0 et 0 : autant qu’on veut, ou aucun.')}</p>

          <button type="submit" className="principal">{t('Créer le groupe')}</button>
          {resultat?.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
          {resultat?.succes && <p className="message succes">{t.m(resultat.succes)}</p>}
        </form>
      )}

      {/* Le rappel qui évite un ticket de support. */}
      <div className="carte note-imprimantes">
        <h2>{t('Ce qu’un modificateur fait au prix')}</h2>
        <p>{t('Il s’ajoute au prix de la ligne :')}{' '}
          <strong>{t('prix de l’article + somme des choix')}</strong>{t(', puis la quantité. Un choix peut être')}{' '}<strong>{t('négatif')}</strong>{' '}{t('(« sans fromage −')}{formaterTND(millimes(500))}{' '}{t('») ou à zéro (« Bien cuit », qui ne coûte rien mais doit figurer sur le bon de cuisine).')}</p>
        <p>{t('Le')}{' '}<strong>{t('taux de taxe reste celui de l’article')}</strong>{' '}{t(': un supplément n’a pas de taxe à lui. Et il ne touche pas au')}{' '}
          <strong>{t('stock')}</strong>{' '}{t('— un supplément n’est pas un article vendu.')}</p>
      </div>
    </>
  )
}
