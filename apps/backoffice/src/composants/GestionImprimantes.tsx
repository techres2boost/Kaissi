'use client'

/**
 * L'adresse réseau de chaque poste de préparation.
 *
 * Un poste, une imprimante. Le rattachement de ce qu'il PRÉPARE se fait dans
 * « Catégories » (migration 0025 : `categories.station_id` est la source de
 * vérité, `products.station_id` n'est plus qu'un repli) — cet écran-ci ne
 * répond qu'à « où sort le papier ».
 */

import { useActionState } from 'react'
import Link from 'next/link'
import { Printer, PrinterCheck, TriangleAlert } from 'lucide-react'
import { definirImprimante, type Resultat } from '../app/[restaurant]/imprimantes/actions.js'
import { PORT_PAR_DEFAUT } from '../app/[restaurant]/imprimantes/port.js'

export interface PosteImprimante {
  id: string
  nom: string
  hote: string | null
  port: number
  /** Catégories rattachées, plus les produits qui s'y rattachent en repli. */
  rattachements: number
  /**
   * Ce poste est-il celui qui imprimera le TICKET CLIENT ?
   *
   * Voir la note de l'écran : la caisse envoie le ticket au premier poste
   * qui porte une adresse, et non à un poste « caisse » désigné. Le dire à la
   * ligne près évite de chercher pourquoi le ticket sort en cuisine.
   */
  ticketClient: boolean
}

function LignePoste({
  restaurantId,
  poste,
  modifiable,
}: {
  restaurantId: string
  poste: PosteImprimante
  modifiable: boolean
}) {
  const [resultat, action] = useActionState(
    definirImprimante.bind(null, restaurantId, poste.id),
    null as Resultat | null,
  )
  const Icone = poste.hote ? PrinterCheck : Printer

  return (
    <li>
      <form action={action} className="ligne-imprimante">
        <span className="poste-nom">
          <Icone size={18} strokeWidth={1.9} aria-hidden="true" />
          {poste.nom}
        </span>

        <input
          name="hote"
          defaultValue={poste.hote ?? ''}
          aria-label={`Adresse de l’imprimante de ${poste.nom}`}
          placeholder="aucune — ex. 192.168.1.50"
          maxLength={253}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          disabled={!modifiable}
        />

        <span className="champ-taux">
          <span className="detail">port</span>
          <input
            name="port"
            defaultValue={String(poste.port || PORT_PAR_DEFAUT)}
            aria-label={`Port de l’imprimante de ${poste.nom}`}
            inputMode="numeric"
            maxLength={5}
            disabled={!modifiable}
          />
        </span>

        {modifiable && (
          <button type="submit" className="discret">
            Enregistrer
          </button>
        )}
      </form>

      <p className="indication">
        {poste.rattachements === 0 ? (
          <>
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" /> Aucune
            catégorie ne prépare ici : ce poste ne recevra jamais rien, avec ou
            sans imprimante.{' '}
            <Link href={{ pathname: `/${restaurantId}/categories` }}>
              Lui rattacher une catégorie
            </Link>
            .
          </>
        ) : poste.hote === null ? (
          <>
            {poste.rattachements} rattachement(s), aucune imprimante : les bons
            de ce poste se lisent à l’écran de{' '}
            <Link href={{ pathname: `/${restaurantId}/preparation` }}>
              préparation
            </Link>
            .
          </>
        ) : (
          <>
            {poste.rattachements} rattachement(s).
            {poste.ticketClient &&
              ' C’est aussi cette imprimante qui sortira le TICKET CLIENT — voir la note ci-dessous.'}
          </>
        )}
      </p>

      {resultat?.erreur && <p className="message erreur">{resultat.erreur}</p>}
      {resultat?.succes && <p className="message succes">{resultat.succes}</p>}
    </li>
  )
}

export function GestionImprimantes({
  restaurantId,
  modifiable,
  postes,
}: {
  restaurantId: string
  modifiable: boolean
  postes: PosteImprimante[]
}) {
  if (postes.length === 0) {
    return (
      <div className="message avertissement">
        <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />{' '}
        <strong>Aucun poste de préparation.</strong> Une imprimante se règle SUR
        un poste — créez-en un dans{' '}
        <Link href={{ pathname: `/${restaurantId}/categories` }}>Catégories</Link>,
        puis revenez ici.
      </div>
    )
  }

  const avecTicket = postes.find((p) => p.ticketClient)

  return (
    <>
      <ul className="liste-taux">
        {postes.map((p) => (
          <LignePoste
            key={p.id}
            restaurantId={restaurantId}
            poste={p}
            modifiable={modifiable}
          />
        ))}
      </ul>

      {/*
        La règle la moins devinable de cet écran, et celle qui fait chercher
        au mauvais endroit : le ticket CLIENT n'a pas de poste à lui. La
        caisse l'envoie au premier poste qui porte une adresse, dans l'ordre
        d'affichage ci-dessus (`EcranPaiement.tsx`). Sans cette note, un
        gérant qui règle d'abord la cuisine voit ses tickets clients sortir en
        cuisine et cherche un réglage qui n'existe pas.
      */}
      <div className="carte note-imprimantes">
        <h2>Le ticket client n’a pas de poste à lui</h2>
        <p>
          La caisse l’envoie au <strong>premier poste de cette liste qui porte
          une adresse</strong>
          {avecTicket ? (
            <>
              {' '}— aujourd’hui <strong>{avecTicket.nom}</strong>
            </>
          ) : (
            <> — aujourd’hui aucun, puisqu’aucun poste n’en porte</>
          )}
          . Pour qu’il sorte au comptoir, créez un poste « Caisse » et
          donnez-lui une adresse avant les autres.
        </p>
        <p className="indication">
          L’ordre est celui des postes dans{' '}
          <Link href={{ pathname: `/${restaurantId}/categories` }}>Catégories</Link>.
        </p>
      </div>
    </>
  )
}
