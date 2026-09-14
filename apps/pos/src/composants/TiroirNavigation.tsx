/**
 * Tiroir de navigation — la barre d'écrans passe du bandeau à la GAUCHE.
 *
 * ── Pourquoi déplacer ce qui marchait ─────────────────────────────────────
 *
 * Le bandeau portait sept boutons sur une rangée. Sur une tablette en salle
 * c'était lisible ; sur un téléphone, la rangée débordait et devait glisser
 * pour elle-même — donc la moitié des écrans n'existait qu'après un geste
 * qui ne s'annonce pas. Et cette rangée mangeait la hauteur de la grille de
 * produits, qui est la raison d'être de l'écran.
 *
 * Un tiroir règle les deux d'un coup : la liste est VERTICALE, donc elle ne
 * déborde jamais en largeur quel que soit le nombre d'entrées, et elle ne
 * coûte rien tant qu'elle est fermée. C'est le même geste qu'au back-office,
 * et le même que celui de Loyverse, que le gérant connaît déjà.
 *
 * ── Ce qui RESTE dans le bandeau, et pourquoi ─────────────────────────────
 *
 * Tout ce qui est un ÉTAT, jamais une destination : le badge de
 * synchronisation, l'employé en poste, l'indicateur de réseau. Un état caché
 * derrière un bouton n'est plus un état — « ⚠ À appairer » enfermé dans un
 * tiroir ne serait jamais vu, et c'est précisément le message qui explique
 * pourquoi les ventes n'arrivent pas au back-office.
 */

import { useEffect, useRef } from 'react'
import {
  ClipboardList,
  Clock,
  ExternalLink,
  Lock,
  ReceiptText,
  RefreshCw,
  Store,
  Stethoscope,
  X,
} from 'lucide-react'
import type { Vue } from '../navigation.js'

export interface EntreeTiroir {
  readonly cle: string
  /**
   * Les écrans que cette entrée COUVRE — vide pour ce qui sort de Kaissi.
   *
   * Plusieurs, et pas un seul : « Ventes » couvre la salle, la commande et
   * l'encaissement. Avec un écran unique, ouvrir le tiroir depuis une
   * commande en cours ne marquait RIEN — et un menu où rien n'est marqué
   * laisse croire qu'on est nulle part.
   */
  readonly vues?: readonly Vue['nom'][]
  readonly libelle: string
  readonly icone: typeof Store
  readonly action: () => void
  /** Affichée à part, sous un filet : elle quitte l'application. */
  readonly sortante?: boolean
}

export function TiroirNavigation({
  ouvert,
  vue,
  entrees,
  employe,
  etablissement,
  onFermer,
  onVerrouiller,
}: {
  ouvert: boolean
  vue: Vue['nom']
  entrees: readonly EntreeTiroir[]
  employe: string | null
  etablissement: string
  onFermer: () => void
  onVerrouiller: () => void
}) {
  const panneau = useRef<HTMLDivElement>(null)

  /*
   * Échap ferme. Sur une tablette il n'y a pas de clavier — mais il y en a un
   * sur le poste du gérant, et un tiroir qui ne se ferme qu'à la souris est
   * un piège au clavier.
   */
  useEffect(() => {
    if (!ouvert) return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer()
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [ouvert, onFermer])

  /* Le focus entre dans le tiroir à l'ouverture, sinon la tabulation continue
     derrière le voile, sur des boutons qu'on ne voit plus. */
  useEffect(() => {
    if (ouvert) panneau.current?.querySelector('button')?.focus()
  }, [ouvert])

  if (!ouvert) return null

  const courantes = entrees.filter((e) => !e.sortante)
  const sortantes = entrees.filter((e) => e.sortante)

  const rendre = (e: EntreeTiroir) => {
    const Icone = e.icone
    return (
      <button
        key={e.cle}
        type="button"
        className="tiroir-lien"
        data-actif={e.vues?.includes(vue) ?? false}
        onClick={() => {
          /*
           * Fermer AVANT d'agir. L'inverse laissait le tiroir ouvert par-dessus
           * l'écran qu'on venait de demander, et le geste suivant retombait
           * sur le voile.
           */
          onFermer()
          e.action()
        }}
      >
        <Icone size={18} strokeWidth={1.9} aria-hidden="true" />
        <span>{e.libelle}</span>
      </button>
    )
  }

  return (
    <>
      {/*
        Le voile n'est pas qu'un assombrissement : c'est la zone de fermeture.
        Sans lui, refermer le tiroir exigerait de viser une croix de 24 px,
        pouce en l'air, au-dessus d'un client qui attend.
      */}
      <div className="tiroir-voile" onClick={onFermer} aria-hidden="true" />

      <nav
        className="tiroir"
        aria-label="Navigation"
        ref={panneau}
      >
        <div className="tiroir-entete">
          <div className="tiroir-identite">
            <span className="tiroir-employe">{employe ?? '—'}</span>
            <span className="tiroir-etablissement">{etablissement}</span>
          </div>
          <button
            type="button"
            className="tiroir-fermer"
            onClick={onFermer}
            aria-label="Fermer le menu"
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="tiroir-liste">{courantes.map(rendre)}</div>

        {sortantes.length > 0 && (
          <div className="tiroir-liste tiroir-sortantes">{sortantes.map(rendre)}</div>
        )}

        {/*
          Verrouiller en BAS, et séparé : c'est le geste qui rend la caisse à
          la personne suivante, pas une destination. Le mettre dans la liste
          des écrans le ferait toucher par erreur en visant « Reçus ».
        */}
        <button
          type="button"
          className="tiroir-verrouiller"
          onClick={() => {
            onFermer()
            onVerrouiller()
          }}
        >
          <Lock size={17} strokeWidth={1.9} aria-hidden="true" />
          <span>Verrouiller la caisse</span>
        </button>
      </nav>
    </>
  )
}

/** Les icônes, réexportées : la coque compose ses entrées, pas ce fichier. */
export const ICONES_TIROIR = {
  salle: Store,
  recus: ReceiptText,
  periodes: Clock,
  sync: RefreshCw,
  diagnostic: Stethoscope,
  cloture: ClipboardList,
  backOffice: ExternalLink,
} as const
