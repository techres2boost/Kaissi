/**
 * Ce qui s'affiche PENDANT que la page se calcule côté serveur.
 *
 * Sans ce fichier, un clic sur un onglet ne changeait rien à l'écran tant
 * que la page entière n'était pas rendue : on recliquait, persuadé que le
 * premier clic n'avait pas pris. Avec lui, Next.js remplace aussitôt le
 * contenu par cette silhouette — la navigation, elle, reste en place (elle
 * vit dans le layout) — et peut même la PRÉCHARGER au survol des liens.
 *
 * Aucune donnée ici, à dessein : rien à attendre, donc rien à rater.
 */
export default function Chargement() {
  return (
    <div className="chargement-page" role="status" aria-live="polite">
      <span className="visuellement-cache">Chargement…</span>
      <div className="chargement-titre" />
      <div className="chargement-cartes">
        <div />
        <div />
        <div />
      </div>
      <div className="chargement-bloc" />
    </div>
  )
}
