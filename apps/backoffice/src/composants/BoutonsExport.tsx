/**
 * Les liens d'export d'un écran.
 *
 * ── Pourquoi un LIEN et non un bouton qui appelle une action ──────────────
 *
 * Un téléchargement déclenché depuis JavaScript oblige à recevoir tout le
 * fichier en mémoire, à fabriquer un `blob:` et à simuler un clic. Un lien
 * `<a download>` vers une route qui répond en `text/csv` laisse le navigateur
 * faire ce qu'il sait faire : afficher sa barre de progression, reprendre en
 * cas de coupure, et écrire directement sur le disque. C'est aussi le seul
 * chemin qui fonctionne quand le fichier est gros.
 *
 * Les paramètres de PÉRIODE sont recopiés dans l'URL : sans eux, le gérant
 * regarde le mois de septembre à l'écran et télécharge la semaine en cours
 * sans que rien ne le signale. C'est le genre d'écart qu'on ne découvre que
 * chez le comptable.
 */

import Link from 'next/link'
import { destinationSure } from '../serveur/redirection.js'

export interface Export {
  /** Sujet de la route `/[restaurant]/export/[quoi]`. */
  readonly quoi: string
  readonly libelle: string
}

export function BoutonsExport({
  restaurantId,
  exports,
  du,
  au,
}: {
  restaurantId: string
  exports: readonly Export[]
  /** Bornes affichées à l'écran, recopiées telles quelles dans le lien. */
  du?: string
  au?: string
}) {
  const parametres = new URLSearchParams()
  if (du) parametres.set('du', du)
  if (au) parametres.set('au', au)
  const suffixe = parametres.toString() ? `?${parametres.toString()}` : ''

  return (
    <div className="actions-export">
      <span className="detail">Exporter :</span>
      {exports.map((e) => (
        <Link
          key={e.quoi}
          href={destinationSure(`/${restaurantId}/export/${e.quoi}${suffixe}`)}
          // `download` et non un simple lien : sans lui, le navigateur peut
          // afficher le CSV dans l'onglet au lieu de l'enregistrer.
          download
          className="discret"
          prefetch={false}
        >
          {e.libelle}
        </Link>
      ))}
      <span className="detail">
        Format CSV — s’ouvre dans Excel, LibreOffice et Google Sheets.
      </span>
    </div>
  )
}
