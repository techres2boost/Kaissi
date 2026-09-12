'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ChefHat,
  Clock,
  Contact,
  CreditCard,
  FolderTree,
  LayoutDashboard,
  Menu,
  Package,
  ReceiptText,
  Tag,
  Ticket,
  UserRound,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
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
 * une fois qu'on sait que le reçu c'est « Récapitulatif », on ne lit plus le
 * mot.
 *
 * ── Pourquoi ce ne sont plus des EMOJI ────────────────────────────────────
 *
 * Elles l'ont été, et le commentaire d'alors invoquait le poids : « une
 * police d'icônes, c'est un fichier de plus à charger, et sur une liaison
 * tunisienne moyenne ça se voit ». L'argument était juste — contre une
 * POLICE. Il ne vaut pas contre `lucide-react`, qui n'en est pas une : chaque
 * icône est un composant React rendant un `<svg>` en ligne, et l'élagage du
 * build ne garde que les dix-sept utilisées ici. Rien à télécharger en plus,
 * rien à attendre avant le premier rendu.
 *
 * MESURÉ, pas supposé — la bibliothèque entière pèse plusieurs centaines de
 * kio, et c'était bien la question à trancher : les paquets JavaScript du
 * back-office passent de 880 à 890 Kio, soit **+9 Kio** pour dix-sept
 * icônes. Sur une liaison tunisienne moyenne, ça ne se voit pas.
 *
 * Ce que les emoji coûtaient, en revanche, se voyait : ils sont rendus par la
 * POLICE DU SYSTÈME. Le même 🗂️ est plat sur Windows, en relief sur macOS,
 * et absent d'un poste Linux mal doté — où il tombait en carré vide. Ils
 * n'ont pas tous la même chasse, d'où la largeur fixe qu'il fallait leur
 * imposer, et surtout ils ne prennent pas la couleur du texte : impossible de
 * les faire passer en orange sur le lien actif, comme le fait le reste de la
 * charte. Un trait uniforme, qui hérite de `currentColor`, fait tout cela.
 *
 * C'est aussi ce que fait Digital Fidelity, dont ce back-office reprend
 * l'habillage.
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
      { chemin: 'tableau-bord', libelle: 'Tableau de bord', icone: LayoutDashboard, gestionnaire: true },
      { chemin: 'preparation', libelle: 'Préparation', icone: ChefHat, gestionnaire: false },
      { chemin: 'journee', libelle: 'Journée', icone: CalendarDays, gestionnaire: false },
    ],
  },
  {
    /*
     * Les rapports portent EXACTEMENT les noms de Loyverse.
     *
     * Ce n'est pas de l'imitation : c'est le vocabulaire que le marché
     * connaît déjà. Un restaurateur qui vient de Loyverse cherche
     * « Récapitulatif des ventes » ; l'appeler « Ventes » l'oblige à
     * apprendre notre mot pour sa propre question.
     */
    titre: 'Rapports',
    onglets: [
      { chemin: 'ventes', libelle: 'Récapitulatif des ventes', icone: ReceiptText, gestionnaire: true },
      { chemin: 'articles', libelle: 'Ventes par article', icone: UtensilsCrossed, gestionnaire: true },
      { chemin: 'ventes-par-categorie', libelle: 'Ventes par catégorie', icone: FolderTree, gestionnaire: true },
      { chemin: 'ventes-par-employe', libelle: 'Ventes par employé', icone: UserRound, gestionnaire: true },
      { chemin: 'ventes-par-paiement', libelle: 'Ventes par mode de paiement', icone: CreditCard, gestionnaire: true },
      { chemin: 'recus', libelle: 'Reçus', icone: Ticket, gestionnaire: true },
      { chemin: 'reductions', libelle: 'Réductions', icone: Tag, gestionnaire: true },
      { chemin: 'periodes', libelle: 'Périodes de travail', icone: Clock, gestionnaire: true },
    ],
  },
  {
    // « Articles » et non « Menu » : c'est là qu'on gère la carte, ses
    // catégories et ses réductions. Le mot « Menu » désignait à la fois la
    // carte et la barre de navigation — deux choses dans un même mot.
    titre: 'Articles',
    onglets: [
      { chemin: 'catalogue', libelle: 'Liste d’articles', icone: BookOpen, gestionnaire: true },
      { chemin: 'categories', libelle: 'Catégories', icone: Boxes, gestionnaire: true },
      { chemin: 'stock', libelle: 'Stock', icone: Package, gestionnaire: true },
      /*
       * Le RÉFÉRENTIEL des réductions, pas leur rapport.
       *
       * Les deux portent le même mot et vivent volontairement à deux endroits
       * différents : ici on règle ce que la caisse propose, dans « Rapports »
       * on lit ce que cela a coûté. Un seul écran mélangerait un réglage et
       * une mesure — et on ne consulte pas les deux au même moment.
       */
      { chemin: 'reductions/gestion', libelle: 'Réductions', icone: Tag, gestionnaire: true },
    ],
  },
  {
    titre: 'Configuration',
    onglets: [
      { chemin: 'employes', libelle: 'Employés', icone: Users, gestionnaire: true },
      // « Clients » juste sous « Employés », comme dans Loyverse : ce sont
      // les deux carnets de personnes, et on les cherche au même endroit.
      { chemin: 'clients', libelle: 'Clients', icone: Contact, gestionnaire: true },
    ],
  },
] as const

type Onglet = (typeof GROUPES)[number]['onglets'][number]

/*
 * Le contrat que chaque entrée doit tenir. `as const` fige les CHEMINS (voir
 * plus haut, c'est ce qui fait vérifier les routes par TypeScript) ; cette
 * ligne-ci vérifie l'autre moitié : que `icone` est bien un composant
 * d'icône, et non une chaîne oubliée depuis les emoji.
 */
const _verifieLesIcones: readonly LucideIcon[] = GROUPES.flatMap((g) =>
  g.onglets.map((o) => o.icone),
)
void _verifieLesIcones

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
        <Menu size={17} strokeWidth={1.75} aria-hidden="true" />
        Menu
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
                      {/*
                        `strokeWidth={1.75}` et non le 2 par défaut : à 17 px,
                        un trait de 2 px empâte les icônes denses (le reçu, le
                        dossier) au point qu'on ne distingue plus leur forme.
                        C'est la valeur que retient DF.

                        `aria-hidden` sur l'enveloppe : l'icône REDIT le
                        libellé qui la suit. Annoncée, un lecteur d'écran
                        lirait « graphique, Tableau de bord ».
                      */}
                      <span className="laterale-icone" aria-hidden="true">
                        <onglet.icone size={17} strokeWidth={1.75} />
                      </span>
                      {onglet.libelle}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {/*
          « Administration » n'est PAS dans les groupes ci-dessus, et ce n'est
          pas un oubli : son adresse ne commence pas par l'établissement. Elle
          ne parle d'aucun établissement en particulier — c'est là qu'on en
          ouvre un autre.

          Elle n'apparaît qu'au rôle `administrateur`. Le gérant, lui, ne doit
          même pas apprendre que l'écran existe : la page répond « introuvable »
          pour lui, pas « accès refusé ».
        */}
        {etablissement.administrateur && !etablissement.preparation && (
          <nav className="laterale-groupe">
            <span className="laterale-titre">Administration</span>
            <Link
              href="/administration"
              aria-current={cheminActuel === '/administration' ? 'page' : undefined}
              onClick={() => setOuvert(false)}
            >
              <span className="laterale-icone" aria-hidden="true">
                <Building2 size={17} strokeWidth={1.75} />
              </span>
              Établissements
            </Link>
          </nav>
        )}

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
