/**
 * Paramètres → Aide.
 *
 * ── Ce que cet écran fait, et ce qu'il NE REFAIT PAS ──────────────────────
 *
 * Il ne refait pas la foire aux questions : elle vit sur `/support`, qui est
 * PUBLIQUE — Apple la visite pendant la revue, et un client qui n'arrive plus
 * à se connecter doit pouvoir l'ouvrir. Recopier ses sept réponses ici en
 * ferait deux versions, et la seconde cesserait d'être vraie sans que
 * personne ne le remarque : celui qui lit la mauvaise réponse ne signale pas
 * qu'elle est périmée, il abandonne.
 *
 * Ce qu'il apporte, et qui n'a pas sa place sur une page publique : l'ordre
 * dans lequel REGARDER quand quelque chose ne va pas, avec les liens directs
 * vers les écrans de CE restaurant. « Ouvrez Journée » est une phrase inutile
 * sur une page publique et exactement la bonne ici.
 */

import Link from 'next/link'
import {
  CalendarDays,
  LifeBuoy,
  Mail,
  MessageSquareOff,
  Stethoscope,
  RefreshCw,
} from 'lucide-react'
import { DELAI_PAR_DEFAUT, EDITEUR } from '../../../editeur.js'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'

export const dynamic = 'force-dynamic'

export default async function PageAide({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')

  return (
    <>
      <h1>Aide</h1>
      <p className="sous-titre">
        Par où commencer quand quelque chose ne va pas, et comment nous
        joindre.
      </p>

      <section className="bloc-fonctionnalites">
        <h2>Les trois écrans à regarder, dans cet ordre</h2>
        <p className="sous-titre">
          Ils répondent à la quasi-totalité des questions qu’on nous pose, et
          plus vite qu’un e-mail.
        </p>

        <ul className="liste-fonctionnalites">
          <li className="etat-active">
            <div className="fonctionnalite-entete">
              <span className="fonctionnalite-nom">
                <Stethoscope size={18} strokeWidth={1.9} aria-hidden="true" />
                1. Diagnostic — sur la tablette
              </span>
            </div>
            <p className="fonctionnalite-quoi">
              Dans le menu de la caisse. Il dit en quatre phrases ce que la
              tablette a en mémoire : sa version, son dernier échange avec le
              serveur, et le nombre de ventes en attente d’envoi.
            </p>
            <p className="indication">
              C’est l’écran à ouvrir <strong>avant</strong> de nous écrire, et
              le premier que nous demanderons. Il est volontairement
              accessible à tout le monde, caissiers compris : il ne montre
              aucun montant, et c’est exactement la page qu’il faut ouvrir
              quand une caisse ne synchronise plus à 20 h, sans le gérant sur
              place.
            </p>
          </li>

          <li className="etat-active">
            <div className="fonctionnalite-entete">
              <span className="fonctionnalite-nom">
                <RefreshCw size={18} strokeWidth={1.9} aria-hidden="true" />
                2. Synchronisation — sur la tablette
              </span>
            </div>
            <p className="fonctionnalite-quoi">
              Combien de ventes attendent, et laquelle a été <em>refusée</em>.
            </p>
            <p className="indication">
              Une vente en attente finit toujours par partir — c’est le
              fonctionnement normal hors ligne, et rien n’est perdu. Une vente
              <strong> refusée</strong>, en revanche, ne se réessaie JAMAIS
              toute seule : c’est une décision qui remonte au gérant, et c’est
              le seul cas où il faut agir.
            </p>
          </li>

          <li className="etat-active">
            <div className="fonctionnalite-entete">
              <span className="fonctionnalite-nom">
                <CalendarDays size={18} strokeWidth={1.9} aria-hidden="true" />
                3. Journée — ici, au back-office
              </span>
            </div>
            <p className="fonctionnalite-quoi">
              Ce que le serveur a réellement reçu aujourd’hui, pour tout
              l’établissement.
            </p>
            <p className="indication">
              Si une vente figure sur la tablette et pas ici, c’est qu’elle
              n’est pas encore remontée — revenez à l’écran 2. Si elle figure
              ici, elle est en sécurité : les ventes vivent sur le serveur,
              pas seulement sur la tablette.
            </p>
            <p className="fonctionnalite-lien">
              <Link href={{ pathname: `/${restaurant}/journee` }}>
                Ouvrir Journée
              </Link>
            </p>
          </li>
        </ul>
      </section>

      <section className="bloc-fonctionnalites">
        <h2>Nous joindre</h2>
        <div className="carte note-imprimantes">
          <p>
            <Mail size={16} strokeWidth={2} aria-hidden="true" /> Par e-mail :{' '}
            <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>
            {EDITEUR.telephone ? (
              <>
                {' · '}par téléphone :{' '}
                <a href={`tel:${EDITEUR.telephone.replace(/\s/g, '')}`}>
                  {EDITEUR.telephone}
                </a>
              </>
            ) : null}
          </p>
          <p className="indication">{EDITEUR.horaires || DELAI_PAR_DEFAUT}</p>
          <p className="indication">
            Pour aller plus vite : le nom de votre établissement (
            <strong>{etablissement.nom}</strong>), l’écran concerné, et — si la
            caisse est en cause — ce qu’affiche son écran <em>Diagnostic</em>.
          </p>
        </div>

        {/*
          ⚠ La mention qui évite une attente. Le chat en direct figure dans les
          formules payantes envisagées ; il n'existe pas. Laisser la page muette
          laisserait chercher un bouton de discussion qui n'est nulle part.
        */}
        <div className="message info">
          <MessageSquareOff size={16} strokeWidth={2} aria-hidden="true" />{' '}
          <strong>Pas de chat en direct pour l’instant.</strong> Il est prévu
          avec les formules d’abonnement, qui ne sont pas encore en place — et
          tant qu’elles ne le sont pas, annoncer un bouton de discussion
          ferait attendre devant un écran où il n’y en a pas. L’e-mail
          ci-dessus est lu par la même équipe.
        </div>
      </section>

      <section className="bloc-fonctionnalites">
        <h2>Questions fréquentes</h2>
        <div className="carte note-imprimantes">
          <p>
            <LifeBuoy size={16} strokeWidth={2} aria-hidden="true" /> Les
            réponses aux pannes qui reviennent — bandeau de synchronisation
            rouge, code PIN refusé, produit qui n’apparaît pas sur la caisse —
            sont sur la{' '}
            <a href="/support" target="_blank" rel="noreferrer">
              page d’assistance
            </a>
            .
          </p>
          <p className="indication">
            Elle est <strong>publique</strong>, et c’est voulu : elle s’ouvre
            depuis n’importe quel téléphone, y compris quand personne n’arrive
            plus à se connecter au back-office — c’est-à-dire précisément le
            jour où l’on en a besoin.
          </p>
        </div>
      </section>
    </>
  )
}
