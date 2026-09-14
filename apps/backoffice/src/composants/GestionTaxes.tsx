'use client'

/**
 * Les taux de taxe de l'établissement.
 *
 * ── Ce que l'écran affirme, et ce qu'il refuse d'affirmer ─────────────────
 *
 * Il affirme la MÉCANIQUE : un taux en points de base entiers, incluse ou
 * ajoutée, un seul taux par défaut, l'archivage plutôt que la suppression.
 *
 * Il n'affirme AUCUNE valeur. Ni « 19 % », ni qu'un taux s'applique à la
 * restauration, ni le traitement du droit de timbre — ce sont des paramètres
 * réglementaires qui évoluent, et se tromper expose commercialement. Le
 * bandeau le dit au gérant plutôt que de le laisser croire que le logiciel
 * sait.
 */

import { useActionState, useState, useTransition } from 'react'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import {
  archiverTaux,
  creerTaux,
  definirParDefaut,
  modifierTaux,
  type Resultat,
} from '../app/[restaurant]/taxes/actions.js'

export interface TauxTaxe {
  id: string
  nom: string
  tauxBp: number
  incluse: boolean
  parDefaut: boolean
  archive: boolean
}

/**
 * Points de base → pourcentage lisible. 1900 → « 19 », 1350 → « 13,5 ».
 *
 * Pas de `toFixed(2)` : « 19,00 % » sur un écran de réglage donne à croire
 * qu'on attend des centièmes, et invite à en taper.
 */
function enPourcent(bp: number): string {
  return String(bp / 100).replace('.', ',')
}

function LigneTaux({ restaurantId, taux }: { restaurantId: string; taux: TauxTaxe }) {
  const [resultat, action] = useActionState(
    modifierTaux.bind(null, restaurantId, taux.id),
    null as Resultat | null,
  )
  const [enCours, demarrer] = useTransition()
  const [retour, setRetour] = useState<Resultat | null>(null)

  const agir = (travail: () => Promise<Resultat>) =>
    demarrer(() => {
      void travail().then(setRetour)
    })

  return (
    <li className={taux.archive ? 'archive' : ''}>
      <form action={action} className="ligne-taux">
        <input
          name="nom"
          defaultValue={taux.nom}
          aria-label="Nom du taux"
          maxLength={60}
          disabled={taux.archive}
        />
        <span className="champ-taux">
          <input
            name="taux"
            defaultValue={enPourcent(taux.tauxBp)}
            aria-label="Taux en pourcent"
            inputMode="decimal"
            disabled={taux.archive}
          />
          <span aria-hidden="true">%</span>
        </span>
        <label className="case">
          <input
            type="checkbox"
            name="incluse"
            value="oui"
            defaultChecked={taux.incluse}
            disabled={taux.archive}
          />
          {/*
            « Incluse » n'est pas une préférence d'affichage : elle change le
            CALCUL. Incluse, la taxe est extraite du prix affiché ; ajoutée,
            elle s'y additionne. Le dire ici évite de le découvrir au premier
            ticket.
          */}
          <span title="Incluse dans le prix affiché (au lieu d’être ajoutée au total)">
            incluse dans le prix
          </span>
        </label>
        <button type="submit" className="discret" disabled={taux.archive}>
          Enregistrer
        </button>
      </form>

      <div className="actions-taux">
        {taux.parDefaut ? (
          <span className="etiquette actif">
            <CheckCircle2 size={13} strokeWidth={2.2} aria-hidden="true" /> par défaut
          </span>
        ) : (
          !taux.archive && (
            <button
              type="button"
              className="discret"
              disabled={enCours}
              onClick={() => agir(() => definirParDefaut(restaurantId, taux.id))}
            >
              Mettre par défaut
            </button>
          )
        )}
        <button
          type="button"
          className="discret"
          disabled={enCours}
          onClick={() => agir(() => archiverTaux(restaurantId, taux.id, !taux.archive))}
        >
          {taux.archive ? 'Remettre en service' : 'Archiver'}
        </button>
      </div>

      {resultat?.erreur && <p className="message erreur">{resultat.erreur}</p>}
      {resultat?.succes && <p className="message succes">{resultat.succes}</p>}
      {retour?.erreur && <p className="message erreur">{retour.erreur}</p>}
      {retour?.succes && <p className="message succes">{retour.succes}</p>}
    </li>
  )
}

export function GestionTaxes({
  restaurantId,
  modifiable,
  taux,
}: {
  restaurantId: string
  modifiable: boolean
  taux: TauxTaxe[]
}) {
  const [resultat, action] = useActionState(
    creerTaux.bind(null, restaurantId),
    null as Resultat | null,
  )

  const actifs = taux.filter((t) => !t.archive)
  const sansDefaut = actifs.length > 0 && !actifs.some((t) => t.parDefaut)
  const aZero = actifs.filter((t) => t.tauxBp === 0)

  return (
    <>
      {/*
        ⚠ L'avertissement est en HAUT et il n'est pas discret : le gérant est
        responsable de ses taux, et une interface qui les présente comme un
        réglage anodin lui laisse croire que le logiciel sait.
      */}
      <div className="message avertissement">
        <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />{' '}
        <strong>Kaissi ne connaît aucun taux de taxe.</strong> Les valeurs
        ci-dessous sont celles que vous saisissez, et rien d’autre. Le taux
        applicable à la restauration, le droit de timbre et les règles de
        facturation relèvent de votre comptable — vérifiez-les avec lui avant
        d’encaisser.
      </div>

      {aZero.length > 0 && (
        <div className="message avertissement">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />{' '}
          {aZero.length === 1
            ? `Le taux « ${aZero[0]!.nom} » est à 0 %.`
            : `${aZero.length} taux sont à 0 %.`}{' '}
          Un restaurant ouvert depuis la caisse en reçoit un, exprès, pour que
          la caisse puisse fonctionner sans que Kaissi invente une règle
          fiscale. Corrigez-le ici.
        </div>
      )}

      {sansDefaut && (
        <div className="message avertissement">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" /> Aucun
          taux par défaut : un nouvel article n’en recevra aucun, et la caisse
          ne saura pas calculer sa taxe.
        </div>
      )}

      <ul className="liste-taux">
        {taux.map((t) => (
          <LigneTaux key={t.id} restaurantId={restaurantId} taux={t} />
        ))}
        {taux.length === 0 && (
          <li className="vide">Aucun taux. La caisse ne peut rien encaisser.</li>
        )}
      </ul>

      {modifiable && (
        <form action={action} className="carte formulaire-taux">
          <h2>Ajouter un taux</h2>
          <label htmlFor="taux-nom">Nom</label>
          <input id="taux-nom" name="nom" maxLength={60} placeholder="TVA restauration" />

          <label htmlFor="taux-valeur">Taux (%)</label>
          <input id="taux-valeur" name="taux" inputMode="decimal" placeholder="19" />

          <label className="case">
            <input type="checkbox" name="incluse" value="oui" defaultChecked />
            <span>incluse dans le prix affiché</span>
          </label>

          <button type="submit" className="principal">
            Ajouter
          </button>
          {resultat?.erreur && <p className="message erreur">{resultat.erreur}</p>}
          {resultat?.succes && <p className="message succes">{resultat.succes}</p>}
        </form>
      )}
    </>
  )
}
