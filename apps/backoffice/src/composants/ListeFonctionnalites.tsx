/**
 * Paramètres → Fonctionnalités : la carte du produit, et rien d'inventé.
 *
 * ── Pourquoi cet écran n'a AUCUN interrupteur ─────────────────────────────
 *
 * Chez Loyverse, cette page est une liste de bascules. On aurait pu la copier
 * telle quelle : une colonne de commutateurs fait bien plus « fini » qu'une
 * liste de constats.
 *
 * Mais Kaissi n'a pas de table de drapeaux par établissement, et en poser une
 * pour la remplir de bascules qui n'éteignent rien serait précisément ce que
 * ce dépôt refuse ailleurs — l'écran Imprimantes le dit déjà : « un réglage
 * qui ne fait rien sans le dire envoie chercher la panne partout sauf ici ».
 * Un interrupteur qu'on actionne et qui ne change rien est pire qu'un
 * interrupteur absent : il fait perdre une heure à chercher pourquoi.
 *
 * Ce que cet écran fait à la place, et qui n'existait nulle part : il dit, en
 * une page, CE QUE CE LOGICIEL FAIT AUJOURD'HUI — ce qui est actif, ce qui
 * n'est pas débrayable et pourquoi, ce qui est éteint dans cette version, et
 * ce qui n'est pas construit. Avec, pour chaque ligne active, la porte où le
 * régler.
 */

import Link from 'next/link'
import {
  BookOpen,
  CircleCheck,
  CircleSlash,
  Contact,
  CreditCard,
  HandPlatter,
  Lock,
  Package,
  Percent,
  Printer,
  Tag,
  Ticket,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

/**
 * Les quatre états possibles. Pas de cinquième « bientôt » : une date qu'on
 * ne tient pas vaut moins qu'un « pas construit » assumé.
 */
export type EtatFonctionnalite = 'active' | 'structurelle' | 'eteinte' | 'absente'

export interface Fonctionnalite {
  readonly cle: string
  readonly nom: string
  readonly icone: LucideIcon
  readonly etat: EtatFonctionnalite
  /** Ce que la fonctionnalité fait, en une phrase. */
  readonly quoi: string
  /** Pourquoi elle est dans cet état-là. Obligatoire : c'est tout le sujet. */
  readonly pourquoi: string
  /** Où la régler, quand il y a un où. */
  readonly chemin?: string
  readonly lien?: string
  /** Ce que la donnée dit aujourd'hui — « 3 postes, 1 imprimante réglée ». */
  readonly constat?: string
}

const LIBELLES: Record<EtatFonctionnalite, { texte: string; icone: LucideIcon; classe: string }> = {
  active: { texte: 'Active', icone: CircleCheck, classe: 'etat-active' },
  structurelle: { texte: 'Toujours active', icone: Lock, classe: 'etat-structurelle' },
  eteinte: { texte: 'Éteinte dans cette version', icone: CircleSlash, classe: 'etat-eteinte' },
  absente: { texte: 'Pas construite', icone: CircleSlash, classe: 'etat-absente' },
}

export function ListeFonctionnalites({
  restaurantId,
  fonctionnalites,
}: {
  restaurantId: string
  fonctionnalites: Fonctionnalite[]
}) {
  const groupes: { titre: string; etats: EtatFonctionnalite[]; intro: string }[] = [
    {
      titre: 'Ce qui fonctionne aujourd’hui',
      etats: ['active', 'structurelle'],
      intro:
        'Chaque ligne renvoie à l’écran où la régler. « Toujours active » veut dire ' +
        'que la fonctionnalité n’est pas débrayable — la raison est dite à côté.',
    },
    {
      titre: 'Ce qui n’est pas là',
      etats: ['eteinte', 'absente'],
      intro:
        'Dit tel quel plutôt que masqué. Une fonctionnalité annoncée et absente ' +
        'coûte plus cher qu’une fonctionnalité absente et annoncée comme telle.',
    },
  ]

  return (
    <>
      {groupes.map((groupe) => {
        const lignes = fonctionnalites.filter((f) => groupe.etats.includes(f.etat))
        if (lignes.length === 0) return null
        return (
          <section key={groupe.titre} className="bloc-fonctionnalites">
            <h2>{groupe.titre}</h2>
            <p className="sous-titre">{groupe.intro}</p>
            <ul className="liste-fonctionnalites">
              {lignes.map((f) => {
                const etat = LIBELLES[f.etat]
                const Icone = f.icone
                const IconeEtat = etat.icone
                return (
                  <li key={f.cle} className={etat.classe}>
                    <div className="fonctionnalite-entete">
                      <span className="fonctionnalite-nom">
                        <Icone size={18} strokeWidth={1.9} aria-hidden="true" />
                        {f.nom}
                      </span>
                      <span className={`etiquette ${etat.classe}`}>
                        <IconeEtat size={13} strokeWidth={2.2} aria-hidden="true" />{' '}
                        {etat.texte}
                      </span>
                    </div>
                    <p className="fonctionnalite-quoi">{f.quoi}</p>
                    <p className="indication">{f.pourquoi}</p>
                    {f.constat && <p className="fonctionnalite-constat">{f.constat}</p>}
                    {f.chemin && f.lien && (
                      <p className="fonctionnalite-lien">
                        <Link href={{ pathname: `/${restaurantId}/${f.chemin}` }}>
                          {f.lien}
                        </Link>
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </>
  )
}

/** Les icônes réexportées, pour que la page n'en importe pas une seconde liste. */
export const ICONES = {
  BookOpen,
  Contact,
  CreditCard,
  HandPlatter,
  Package,
  Percent,
  Printer,
  Tag,
  Ticket,
  Users,
  UtensilsCrossed,
}
