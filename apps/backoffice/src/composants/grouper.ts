/**
 * Ranger des lignes SOUS leur catégorie.
 *
 * ── Pourquoi cette fonction existe ────────────────────────────────────────
 *
 * Quarante produits à la file se lisent ligne à ligne. Les mêmes, rangés
 * sous « Boissons », « Pizzas », « Plats », se parcourent d'un coup d'œil —
 * et surtout, on voit ce qui manque : une catégorie vide saute aux yeux, un
 * produit isolé au milieu d'une autre aussi.
 *
 * L'ordre des GROUPES suit celui des catégories, réglé au Menu par les
 * flèches. Trier les groupes par nom l'ignorerait, et le gérant qui vient
 * de monter « Boissons » en tête ne verrait rien changer ici.
 *
 * Les produits sans catégorie ferment la marche, jamais l'inverse : ce sont
 * ceux qu'on a oublié de ranger, et les mettre en tête punirait toute la
 * liste pour cet oubli.
 */

export interface Groupe<T> {
  readonly cle: string
  readonly titre: string
  readonly lignes: readonly T[]
}

export function grouperParCategorie<T>(
  lignes: readonly T[],
  categorieDe: (ligne: T) => string | null,
  /** Les catégories, DANS L'ORDRE d'affichage. */
  categories: readonly { id: string; nom: string }[],
  libelleSansCategorie = 'Sans catégorie',
): Groupe<T>[] {
  const parCle = new Map<string, T[]>()
  for (const ligne of lignes) {
    const cle = categorieDe(ligne) ?? ''
    const liste = parCle.get(cle)
    if (liste) liste.push(ligne)
    else parCle.set(cle, [ligne])
  }

  const groupes: Groupe<T>[] = []
  for (const categorie of categories) {
    const lignesDuGroupe = parCle.get(categorie.id)
    // Une catégorie sans produit ne fait pas de titre orphelin : un en-tête
    // suivi de rien laisse croire à une liste tronquée.
    if (lignesDuGroupe?.length) {
      groupes.push({ cle: categorie.id, titre: categorie.nom, lignes: lignesDuGroupe })
    }
  }

  /*
   * Ce qui reste : des lignes dont la catégorie n'est PAS dans la liste
   * reçue — parce qu'elle vient d'être archivée, typiquement.
   *
   * Les laisser tomber serait le pire choix : le produit disparaîtrait de
   * l'écran où l'on va justement pour le reclasser, et rien ne dirait qu'il
   * existe encore. On les rassemble donc, sous un titre qui explique.
   */
  const connues = new Set(categories.map((c) => c.id))
  const egarees: T[] = []
  for (const [cle, lignesDuGroupe] of parCle) {
    if (cle !== '' && !connues.has(cle)) egarees.push(...lignesDuGroupe)
  }
  if (egarees.length > 0) {
    groupes.push({ cle: '__egarees', titre: 'Catégorie archivée', lignes: egarees })
  }

  const orphelins = parCle.get('')
  if (orphelins?.length) {
    groupes.push({ cle: '', titre: libelleSansCategorie, lignes: orphelins })
  }
  return groupes
}
