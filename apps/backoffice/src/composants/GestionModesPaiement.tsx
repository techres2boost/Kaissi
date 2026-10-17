'use client'

/**
 * Les modes de paiement de l'établissement.
 *
 * Ce qu'ils décident : ce que le caissier peut choisir à l'encaissement, et
 * si le tiroir s'ouvre. Rien du MONTANT — les totaux se calculent dans
 * `packages/domain`, à un seul endroit, et un mode de paiement n'est qu'un
 * libellé posé sur une somme déjà décidée.
 */

import { useActionState, useState, useTransition } from 'react'
import { Banknote, CreditCard, Globe, TriangleAlert, Wallet } from 'lucide-react'
import {
  archiverModePaiement,
  creerModePaiement,
  modifierModePaiement,
  type Resultat,
} from '../app/[restaurant]/paiements/actions.js'
import { TYPES_PAIEMENT } from '../app/[restaurant]/paiements/types-paiement.js'
import { useT } from '../i18n/client.js'
import { aTraduire } from '@kaissi/i18n'

export interface ModePaiement {
  id: string
  nom: string
  type: string
  ouvreTiroir: boolean
  archive: boolean
}

/**
 * Le type dit COMMENT on encaisse, pas sous quel nom.
 *
 * « Flouci » et « D17 » sont deux noms tunisiens pour un paiement en ligne :
 * le nom sert au caissier et au ticket, le type sert au rapport, qui regroupe.
 */
const LIBELLES: Record<string, { texte: string; icone: typeof Wallet }> = {
  cash: { texte: aTraduire('paiement|Espèces'), icone: Banknote },
  card: { texte: aTraduire('paiement|Carte'), icone: CreditCard },
  online: { texte: aTraduire('paiement|En ligne'), icone: Globe },
  other: { texte: aTraduire('paiement|Autre'), icone: Wallet },
}

function ChoixType({ defaut, id }: { defaut: string; id?: string }) {
  const t = useT()
  return (
    <select name="type" defaultValue={defaut} aria-label={t('Type de paiement')} id={id}>
      {TYPES_PAIEMENT.map((elt) => (
        <option key={elt} value={elt}>
          {t(LIBELLES[elt]?.texte ?? elt)}
        </option>
      ))}
    </select>
  )
}

function LigneMode({ restaurantId, mode }: { restaurantId: string; mode: ModePaiement }) {
  const t = useT()
  const [resultat, action] = useActionState(
    modifierModePaiement.bind(null, restaurantId, mode.id),
    null as Resultat | null,
  )
  const [enCours, demarrer] = useTransition()
  const [retour, setRetour] = useState<Resultat | null>(null)
  const Icone = LIBELLES[mode.type]?.icone ?? Wallet

  return (
    <li className={mode.archive ? 'archive' : ''}>
      <form action={action} className="ligne-paiement">
        <Icone size={18} strokeWidth={1.9} aria-hidden="true" />
        <input
          name="nom"
          defaultValue={mode.nom}
          aria-label={t('Nom du mode de paiement')}
          maxLength={60}
          disabled={mode.archive}
        />
        <ChoixType defaut={mode.type} />
        <label className="case">
          <input
            type="checkbox"
            name="tiroir"
            value="oui"
            defaultChecked={mode.ouvreTiroir}
            disabled={mode.archive}
          />
          <span title={t('Le tiroir-caisse s’ouvre à la validation de ce paiement')}>{t('ouvre le tiroir')}</span>
        </label>
        <button type="submit" className="discret" disabled={mode.archive}>{t('Enregistrer')}</button>
      </form>

      <div className="actions-taux">
        <button
          type="button"
          className="discret"
          disabled={enCours}
          onClick={() =>
            demarrer(() => {
              void archiverModePaiement(restaurantId, mode.id, !mode.archive).then(setRetour)
            })
          }
        >
          {mode.archive ? t('Remettre en service') : t('Archiver')}
        </button>
      </div>

      {resultat?.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
      {resultat?.succes && <p className="message succes">{t.m(resultat.succes)}</p>}
      {retour?.erreur && <p className="message erreur">{t.m(retour.erreur)}</p>}
      {retour?.succes && <p className="message succes">{t.m(retour.succes)}</p>}
    </li>
  )
}

export function GestionModesPaiement({
  restaurantId,
  modifiable,
  modes,
}: {
  restaurantId: string
  modifiable: boolean
  modes: ModePaiement[]
}) {
  const t = useT()
  const [resultat, action] = useActionState(
    creerModePaiement.bind(null, restaurantId),
    null as Resultat | null,
  )

  const actifs = modes.filter((m) => !m.archive)

  return (
    <>
      {actifs.length === 0 && (
        <div className="message avertissement">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />{' '}
          <strong>{t('Aucun mode de paiement actif.')}</strong>{' '}{t('La caisse ne peut plus rien encaisser tant qu’il n’y en a pas au moins un.')}</div>
      )}

      <ul className="liste-taux">
        {modes.map((m) => (
          <LigneMode key={m.id} restaurantId={restaurantId} mode={m} />
        ))}
      </ul>

      {modifiable && (
        <form action={action} className="carte formulaire-taux">
          <h2>{t('Ajouter un mode de paiement')}</h2>
          <label htmlFor="mode-nom">{t('Nom')}</label>
          <input id="mode-nom" name="nom" maxLength={60} placeholder={t('Flouci')} />

          <label htmlFor="mode-type">{t('Type')}</label>
          {/*
            Le TYPE sert au rapport, qui regroupe ; le NOM sert au caissier et
            au ticket. « Flouci » et « D17 » sont deux noms pour un même type.
          */}
          <ChoixType defaut="cash" id="mode-type" />

          <label className="case">
            <input type="checkbox" name="tiroir" value="oui" />
            <span>{t('ouvre le tiroir-caisse')}</span>
          </label>

          <button type="submit" className="principal">{t('Ajouter')}</button>
          {resultat?.erreur && <p className="message erreur">{t.m(resultat.erreur)}</p>}
          {resultat?.succes && <p className="message succes">{t.m(resultat.succes)}</p>}
        </form>
      )}
    </>
  )
}
