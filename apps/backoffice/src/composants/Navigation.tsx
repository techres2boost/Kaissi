'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { seDeconnecter } from '../app/connexion/actions.js'
import type { Etablissement, SessionBackoffice } from '../serveur/session.js'

/**
 * La navigation — une COLONNE à gauche, pas une rangée en haut.
 *
 * ── Pourquoi la colonne ───────────────────────────────────────────────────
 *
 * Une rangée d'onglets marche à cinq entrées. À neuf, elle passe à la ligne,
 * la page saute d'une hauteur d'onglet selon le rôle, et l'ordre visuel ne
 * dit plus rien : « Employés » se retrouve à côté de « Ventes » sans qu'ils
 * aient le moindre rapport.
 *
 * Une colonne accepte des entrées sans se déformer, et surtout elle accepte
 * des GROUPES. C'est ce qui manquait : un back-office de restaurant a trois
 * métiers distincts — on regarde des chiffres, on tient le service, on règle
 * la configuration — et les mélanger oblige à relire toute la barre à chaque
 * fois. Regroupés, on va droit au bon tiers.
 *
 * Les icônes sont là pour la reconnaissance latérale, pas pour la décoration :
 * une fois qu'on sait que le panier c'est « Ventes », on ne lit plus le mot.
 * Ce sont des emoji plutôt qu'une police d'icônes — une police, c'est un
 * fichier de plus à charger, et sur une liaison tunisienne moyenne ça se voit.
 *
 * ── Ce qui n'est PAS ici ──────────────────────────────────────────────────
 *
 * Le cloisonnement. Masquer un lien n'interdit rien : c'est `ecranReserve()`,
 * côté serveur, qui refuse l'écran à qui n'y a rien à faire. Ce fichier évite
 * seulement de proposer des portes fermées.
 */

/*
 * `as const`, et SURTOUT pas une annotation `readonly Groupe[]`.
 *
 * L'annotation élargit `chemin` en `string`, et le gabarit
 * `/${id}/${chemin}` devient alors `/${string}/${string}` — que les routes
 * typées de Next.js refusent, à raison : ce type-là recouvre n'importe
 * quelle adresse, y compris une page qui n'existe pas. Avec `as const`, un
 * onglet qui pointerait vers un écran supprimé casse la COMPILATION au lieu
 * de rendre un 404 en production.
 */
const GROUPES = [
  {
    // Sans titre : ce sont les écrans du quotidien, ceux qu'on ouvre en
    // arrivant. Leur mettre un en-tête ajouterait un mot à lire avant le
    // premier clic de la journée.
    titre: null,
    onglets: [
      { chemin: 'tableau-bord', libelle: 'Tableau de bord', icone: '📊', gestionnaire: true },
      { chemin: 'preparation', libelle: 'Préparation', icone: '🍳', gestionnaire: false },
      { chemin: 'journee', libelle: 'Journée', icone: '📅', gestionnaire: false },
    ],
  },
  {
    titre: 'Rapports',
    onglets: [
      { chemin: 'ventes', libelle: 'Ventes', icone: '🧾', gestionnaire: true },
      { chemin: 'articles', libelle: 'Par article', icone: '🍽️', gestionnaire: true },
      { chemin: 'tickets', libelle: 'Tickets', icone: '🎫', gestionnaire: true },
      { chemin: 'periodes', libelle: 'Périodes de travail', icone: '🕐', gestionnaire: true },
    ],
  },
  {
    titre: 'Configuration',
    onglets: [
      { chemin: 'catalogue', libelle: 'Menu', icone: '📖', gestionnaire: true },
      { chemin: 'stock', libelle: 'Stock', icone: '📦', gestionnaire: true },
      { chemin: 'employes', libelle: 'Employés', icone: '👥', gestionnaire: true },
    ],
  },
] as const

type Onglet = (typeof GROUPES)[number]['onglets'][number]

export function Navigation({
  session,
  etablissement,
}: {
  session: SessionBackoffice
  etablissement: Etablissement
}) {
  const cheminActuel = usePathname()
  /*
   * Sur un téléphone, la colonne se replie derrière un bouton.
   *
   * Elle ne DISPARAÎT pas : elle se superpose au contenu. Un menu qui pousse
   * la page décale ce qu'on était en train de lire, et on perd sa place à
   * chaque ouverture.
   */
  const [ouvert, setOuvert] = useState(false)

  const visible = (o: Onglet) =>
    etablissement.preparation
      ? o.chemin === 'preparation'
      : !o.gestionnaire || etablissement.gestionnaire

  return (
    <>
      <button
        type="button"
        className="bouton-menu"
        aria-expanded={ouvert}
        aria-controls="navigation-laterale"
        onClick={() => setOuvert((o) => !o)}
      >
        ☰ Menu
      </button>

      <aside
        id="navigation-laterale"
        className={`laterale ${ouvert ? 'ouverte' : ''}`}
        // La colonne est un point de repère permanent : on la nomme, pour
        // qu'un lecteur d'écran ne l'annonce pas comme « navigation » parmi
        // trois autres.
        aria-label="Navigation principale"
      >
        <div className="laterale-entete">
          <span className="marque">Kaissi</span>
          {session.etablissements.length > 1 && !etablissement.preparation ? (
            <Link href="/" className="laterale-etablissement">
              {etablissement.nom}
              <span className="detail"> changer</span>
            </Link>
          ) : (
            <span className="laterale-etablissement">{etablissement.nom}</span>
          )}
        </div>

        <nav>
          {GROUPES.map((groupe) => {
            const onglets = groupe.onglets.filter(visible)
            // Un groupe vide ne laisse pas son titre orphelin : un en-tête
            // « Rapports » suivi de rien laisse croire à une page cassée.
            if (onglets.length === 0) return null
            return (
              <div key={groupe.titre ?? 'principal'} className="laterale-groupe">
                {groupe.titre && <span className="laterale-titre">{groupe.titre}</span>}
                {onglets.map((onglet) => {
                  // Le gabarit est écrit dans le JSX plutôt que stocké dans un
                  // `const` : TypeScript conserve alors son type littéral, et
                  // les routes typées détectent un onglet qui pointerait vers
                  // une page inexistante.
                  const href = `/${etablissement.id}/${onglet.chemin}` as const
                  return (
                    <Link
                      key={onglet.chemin}
                      href={href}
                      aria-current={cheminActuel === href ? 'page' : undefined}
                      onClick={() => setOuvert(false)}
                    >
                      <span className="laterale-icone" aria-hidden="true">
                        {onglet.icone}
                      </span>
                      {onglet.libelle}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </nav>

        <div className="laterale-pied">
          <span className="laterale-qui">{session.nom}</span>
          <span className="etiquette">{etablissement.role}</span>
          <form action={seDeconnecter}>
            <button type="submit" className="discret">
              Se déconnecter
            </button>
          </form>
        </div>
      </aside>

      {/*
        Le voile ferme le menu d'un clic à côté — le geste qu'on fait
        naturellement sur un téléphone. Sans lui, il faut viser le bouton.
      */}
      {ouvert && (
        <button
          type="button"
          className="voile"
          aria-label="Fermer le menu"
          onClick={() => setOuvert(false)}
        />
      )}
    </>
  )
}
