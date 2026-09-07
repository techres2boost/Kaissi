/**
 * L'arithmétique de calendrier, sans React.
 *
 * Elle vit à part parce qu'elle est la seule partie qu'on peut se tromper en
 * silence : une grille de mois fausse d'un jour affiche un lundi sous la
 * colonne « D », et personne ne le remarque avant d'avoir comparé un rapport
 * hebdomadaire à sa caisse.
 */

export const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
export const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** « AAAA-MM-JJ » → « JJ/MM/AAAA ». Aucune dépendance au fuseau. */
export function enFrancais(journee: string): string {
  const [a, m, j] = journee.split('-')
  return `${j}/${m}/${a}`
}

/**
 * Toute l'arithmétique se fait en UTC sur des « AAAA-MM-JJ ».
 *
 * Utiliser l'heure locale ferait sauter un jour dans les fuseaux à l'ouest de
 * Greenwich, et la veille deviendrait l'avant-veille — une seule fois sur
 * deux, ce qui est le pire des bogues.
 */
export function versDate(journee: string): Date {
  const [a, m, j] = journee.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1, j!))
}

export function versJournee(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Le lundi de la semaine d'une date — la semaine commence le lundi ici. */
export function lundiDe(d: Date): Date {
  const decalage = (d.getUTCDay() + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - decalage))
}

/**
 * La grille d'un mois : des semaines PLEINES, et pas une de plus.
 *
 * Cinq ou six lignes selon le mois, jamais un rectangle fixe de six. Un
 * février qui commence un lundi remplirait sa dernière ligne de sept jours
 * grisés du mois suivant — une rangée entière qui ne sert à rien et qu'on
 * essaie de cliquer.
 */
export function grilleDuMois(annee: number, mois: number): string[] {
  const depart = lundiDe(new Date(Date.UTC(annee, mois, 1)))
  const finDuMois = new Date(Date.UTC(annee, mois + 1, 0))
  const jours =
    Math.round((finDuMois.getTime() - depart.getTime()) / 86_400_000) + 1
  const cases = Math.ceil(jours / 7) * 7
  return Array.from({ length: cases }, (_, i) =>
    versJournee(
      new Date(Date.UTC(depart.getUTCFullYear(), depart.getUTCMonth(), depart.getUTCDate() + i)),
    ),
  )
}

