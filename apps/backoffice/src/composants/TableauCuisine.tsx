'use client'

/**
 * Le tableau de la cuisine.
 *
 * Trois exigences qui viennent du poste, pas de l'écran :
 *
 *  1. **Gros.** On le lit à un mètre cinquante, les mains occupées.
 *  2. **L'attente est la seule information urgente.** Une commande de trois
 *     minutes et une de vingt se ressemblent si l'on n'affiche que l'heure
 *     d'envoi. On affiche donc les minutes écoulées, et on les colore.
 *  3. **Ce qui est prêt ne disparaît pas tout de suite.** Un plateau annoncé
 *     par erreur doit pouvoir être repris ; il reste visible, grisé, jusqu'à
 *     ce que la caisse encaisse la commande et la fasse sortir de la liste.
 */

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { destinationSure } from '../serveur/redirection.js'
import { marquerPrete, retirerPrete } from '../app/[restaurant]/cuisine/actions.js'

export interface CommandeCuisine {
  id: string
  numero: string | null
  table: string | null
  type: string
  couverts: number | null
  envoyeeA: string
  preteA: string | null
  lignes: {
    id: string
    designation: string
    quantite: number
    options: string[]
    note: string | null
  }[]
}

/** Rafraîchissement automatique. Assez court pour être vivant, assez long
 *  pour ne pas marteler la base pendant tout un service. */
const PERIODE_MS = 15_000

const LIBELLE_TYPE: Record<string, string> = {
  dine_in: 'Sur place',
  takeaway: 'À emporter',
  delivery: 'Livraison',
}

function minutesDepuis(iso: string, maintenant: number): number {
  const debut = new Date(iso).getTime()
  if (Number.isNaN(debut)) return 0
  return Math.max(0, Math.floor((maintenant - debut) / 60_000))
}

export function TableauCuisine({
  restaurantId,
  commandes,
  plafond,
  postes,
  posteActif,
}: {
  restaurantId: string
  commandes: CommandeCuisine[]
  plafond: number
  /** Postes de préparation de l'établissement — Cuisine, Bar… */
  postes: { id: string; nom: string }[]
  posteActif: string | null
}) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)
  /**
   * Horloge locale, rafraîchie chaque minute.
   *
   * Elle n'est PAS initialisée à `Date.now()` : le serveur et le navigateur
   * rendraient alors deux minutages différents, et React signalerait une
   * divergence d'hydratation. On part de `null` et on n'affiche l'attente
   * qu'une fois côté client.
   */
  const [maintenant, setMaintenant] = useState<number | null>(null)

  useEffect(() => {
    setMaintenant(Date.now())
    const horloge = setInterval(() => setMaintenant(Date.now()), 30_000)
    return () => clearInterval(horloge)
  }, [])

  // Rafraîchissement des DONNÉES, distinct de l'horloge : `router.refresh()`
  // rejoue le composant serveur sans recharger la page, donc sans perdre le
  // défilement de la cuisine.
  useEffect(() => {
    const minuteur = setInterval(() => router.refresh(), PERIODE_MS)
    return () => clearInterval(minuteur)
  }, [router])

  const agir = (action: () => Promise<{ erreur?: string }>) => {
    setErreur(null)
    demarrer(async () => {
      const resultat = await action()
      if (resultat.erreur) setErreur(resultat.erreur)
      else router.refresh()
    })
  }

  const enAttente = commandes.filter((c) => !c.preteA)

  return (
    <section className="cuisine">
      <header className="cuisine-entete">
        <h1>
          Cuisine <span className="compteur">{enAttente.length}</span>
        </h1>
        <p className="note">
          Mise à jour automatique toutes les {PERIODE_MS / 1000} secondes. Une
          commande sort de cet écran quand la caisse l'encaisse ou l'annule.
        </p>

        {/*
          La caisse émet DÉJÀ un bon par poste (Cuisine, Bar). Ce filtre rend
          la même séparation à l'écran : le barman ne trie plus les pizzas à
          l'œil pour trouver ses cafés. « Tous les postes » reste le défaut —
          dans un snack à un seul écran, c'est ce qu'on veut.
        */}
        {postes.length > 1 && (
          <nav className="onglets-postes" aria-label="Poste de préparation">
            <Link
              href={destinationSure(`/${restaurantId}/cuisine`)}
              className={posteActif === null ? 'actif' : ''}
            >
              Tous les postes
            </Link>
            {postes.map((p) => (
              <Link
                key={p.id}
                href={destinationSure(`/${restaurantId}/cuisine?poste=${p.id}`)}
                className={posteActif === p.id ? 'actif' : ''}
              >
                {p.nom}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {erreur && <p className="message erreur">{erreur}</p>}

      {commandes.length === 0 ? (
        <p className="vide">
          Rien à préparer. Les commandes apparaissent ici dès qu'un serveur
          les envoie en cuisine depuis la caisse.
        </p>
      ) : (
        <div className="cuisine-grille">
          {commandes.map((commande) => {
            const attente = maintenant ? minutesDepuis(commande.envoyeeA, maintenant) : null
            const urgence =
              attente === null ? '' : attente >= 20 ? 'tres-tard' : attente >= 10 ? 'tard' : ''
            return (
              <article
                key={commande.id}
                className={`bon ${commande.preteA ? 'prete' : ''} ${urgence}`}
              >
                <header>
                  <span className="place">
                    {commande.table ? `Table ${commande.table}` : LIBELLE_TYPE[commande.type] ?? commande.type}
                  </span>
                  <span className="attente">
                    {attente === null ? '—' : `${attente} min`}
                  </span>
                </header>

                <p className="reference">
                  {commande.numero ?? '—'}
                  {commande.couverts ? ` · ${commande.couverts} couverts` : ''}
                </p>

                <ul className="plats">
                  {commande.lignes.map((ligne) => (
                    <li key={ligne.id}>
                      <span className="quantite">{ligne.quantite}×</span>
                      <span className="designation">
                        {ligne.designation}
                        {ligne.options.length > 0 && (
                          <small className="options">{ligne.options.join(' · ')}</small>
                        )}
                        {ligne.note && <small className="note-plat">« {ligne.note} »</small>}
                      </span>
                    </li>
                  ))}
                  {commande.lignes.length === 0 && (
                    <li className="note">Aucune ligne active — commande vidée en salle.</li>
                  )}
                </ul>

                {commande.preteA ? (
                  <button
                    type="button"
                    className="discret"
                    disabled={enCours}
                    onClick={() => agir(() => retirerPrete(restaurantId, commande.id))}
                  >
                    Annuler « prêt »
                  </button>
                ) : (
                  <button
                    type="button"
                    className="principal"
                    disabled={enCours}
                    onClick={() => agir(() => marquerPrete(restaurantId, commande.id))}
                  >
                    Prêt
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}

      {commandes.length >= plafond && (
        <p className="note">
          Seules les {plafond} plus anciennes commandes sont affichées. Au-delà,
          ce n'est plus un écran de cuisine mais un rapport — voir « Journée ».
        </p>
      )}
    </section>
  )
}
