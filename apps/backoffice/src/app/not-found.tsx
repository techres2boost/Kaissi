/**
 * Page introuvable.
 *
 * Elle sert aussi de refus : `ecranReserve()` et l'écran d'administration
 * appellent `notFound()` plutôt que d'afficher « accès refusé ». Un
 * cuisinier n'a pas à apprendre qu'un écran de chiffre d'affaires existe —
 * lui dire qu'il lui est refusé, c'est le lui apprendre, et l'inviter à
 * demander pourquoi.
 *
 * Le texte est donc volontairement neutre : il ne distingue pas « cette page
 * n'existe pas » de « cette page ne vous est pas destinée ».
 */

import Link from 'next/link'

export default function Introuvable() {
  return (
    <main className="enveloppe">
      <section className="carte">
        <h1>Page introuvable</h1>
        <p className="sous-titre">
          Cette adresse ne correspond à aucun écran auquel vous ayez accès.
        </p>
        <p>
          <Link className="bouton" href="/">
            Retour à vos établissements
          </Link>
        </p>
      </section>
    </main>
  )
}
