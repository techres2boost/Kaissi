/**
 * Un indicateur de supervision dans le temps — UNE série, UN axe.
 *
 * Composant SERVEUR, rendu en SVG sans une ligne de JavaScript côté
 * navigateur : l'écran se rafraîchit toutes les trente secondes, et un
 * graphique qui s'hydrate à chaque fois ferait clignoter un écran qu'on
 * laisse ouvert sur un second moniteur.
 *
 * Choix de lecture, vérifiés contre la méthode de visualisation du dépôt :
 *
 *   - une série par graphique, nommée par son titre — jamais deux échelles
 *     sur un même axe (des requêtes et des millisecondes n'ont rien à
 *     partager) : ce sont des PETITS MULTIPLES, alignés sur le même temps ;
 *   - COLONNES pour un compte (rien n'existe entre deux périodes), LIGNE
 *     pour une jauge relevée (le processeur a une valeur à chaque instant) ;
 *   - une période SANS mesure reste un trou, pas un zéro : le service était
 *     arrêté, ou la migration absente. Tracer zéro ferait croire à un calme ;
 *   - le survol de chaque période donne l'heure et la valeur (`<title>`
 *     natif, sans script), et un seuil éventuel se dessine en pointillé.
 */

export interface PointCourbe {
  /** L'étiquette du survol : l'heure déjà formatée. */
  readonly libelle: string
  readonly valeur: number | null
}

const LARGEUR = 600
const HAUTEUR = 120

export function CourbeSupervision({
  titre,
  points,
  forme,
  formater,
  seuil,
  aide,
  libelleMax,
}: {
  titre: string
  /** « max {valeur} », déjà traduit par la page. */
  libelleMax: (valeur: string) => string
  points: readonly PointCourbe[]
  forme: 'colonnes' | 'ligne'
  formater: (n: number) => string
  /** Une ligne pointillée : là où le service lève une alerte. */
  seuil?: number
  aide?: string
}) {
  const valeurs = points.map((p) => p.valeur).filter((v): v is number => v !== null)
  const max = Math.max(1, seuil ?? 0, ...valeurs)
  const dernier = [...points].reverse().find((p) => p.valeur !== null)?.valeur ?? null
  const pic = valeurs.length > 0 ? Math.max(...valeurs) : null
  const n = Math.max(1, points.length)
  const pas = LARGEUR / n
  const y = (v: number) => HAUTEUR - (v / max) * (HAUTEUR - 4)

  // La ligne se coupe à chaque trou : relier deux mesures par-dessus un
  // arrêt du service dessinerait une continuité qui n'a pas existé.
  const segments: string[] = []
  if (forme === 'ligne') {
    let courant = ''
    points.forEach((p, i) => {
      if (p.valeur === null) {
        if (courant) segments.push(courant)
        courant = ''
        return
      }
      const x = i * pas + pas / 2
      courant += `${courant ? 'L' : 'M'}${x.toFixed(1)},${y(p.valeur).toFixed(1)}`
    })
    if (courant) segments.push(courant)
  }

  return (
    <figure className="courbe-supervision">
      <figcaption>
        <span className="courbe-titre">{titre}</span>
        <span className="courbe-valeur">{dernier === null ? '—' : formater(dernier)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        preserveAspectRatio="none"
        className="trace courbe-trace"
        role="img"
        aria-label={titre}
      >
        <line x1="0" x2={LARGEUR} y1={HAUTEUR} y2={HAUTEUR} className="grille" />
        <line x1="0" x2={LARGEUR} y1={y(max)} y2={y(max)} className="grille" />
        {seuil !== undefined && (
          <line x1="0" x2={LARGEUR} y1={y(seuil)} y2={y(seuil)} className="seuil" />
        )}
        {forme === 'colonnes' &&
          points.map((p, i) =>
            p.valeur === null || p.valeur === 0 ? null : (
              <rect
                key={i}
                className="barre"
                x={i * pas + Math.min(1, pas * 0.1)}
                width={Math.max(0.5, pas - Math.min(2, pas * 0.2))}
                y={y(p.valeur)}
                height={HAUTEUR - y(p.valeur)}
              />
            ),
          )}
        {segments.map((d, i) => (
          <path key={i} d={d} className="ligne" />
        ))}
        {points.map((p, i) => (
          <rect key={`s${i}`} x={i * pas} width={pas} y="0" height={HAUTEUR} fill="transparent">
            <title>{`${p.libelle} — ${p.valeur === null ? '—' : formater(p.valeur)}`}</title>
          </rect>
        ))}
      </svg>
      <div className="courbe-pied">
        <span>{points[0]?.libelle ?? ''}</span>
        <span>{pic === null ? '' : libelleMax(formater(pic))}</span>
        <span>{points[points.length - 1]?.libelle ?? ''}</span>
      </div>
      {aide && <p className="kpi-aide">{aide}</p>}
    </figure>
  )
}
