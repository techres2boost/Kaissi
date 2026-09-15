/**
 * Les lignes de l'aperçu « Options de restauration », et la règle qui fait
 * que la colonne TOMBE sur le total.
 *
 * ── Pourquoi c'est une fonction, et pas du JSX en ligne ───────────────────
 *
 * Parce que c'est une règle, et qu'une règle se teste. Elle l'était en JSX,
 * et elle était FAUSSE : l'aperçu listait « Taxe sur le service » entre le
 * service et le timbre, alors qu'un taux INCLUS est extrait du service et ne
 * s'y ajoute pas. La colonne affichait 19,500 + 1,950 + 0,311 + 0,600 pour un
 * total de 22,050 — et un gérant qui additionne quatre lignes et trouve autre
 * chose que le total conclut, à raison, que le logiciel compte faux.
 *
 * Aucun test de largeur ni de rendu ne voyait cela : les chiffres étaient là,
 * bien alignés, dans le bon ordre. Seule leur SOMME était fausse.
 */

import type { TotauxCommande } from '@kaissi/domain'

export interface LigneApercu {
  readonly libelle: string
  readonly montantMillimes: number
  /**
   * Une ligne « dont » DÉTAILLE la précédente : elle n'est pas un terme de
   * l'addition. C'est le cas d'une taxe COMPRISE, déjà incluse dans le
   * montant du dessus.
   */
  readonly dont: boolean
}

/**
 * Construit les lignes de l'aperçu depuis des totaux déjà calculés par
 * `@kaissi/domain`. Ne décide d'aucun montant — seulement de ce qui s'affiche
 * et de ce qui s'additionne.
 */
export function lignesApercu(
  totaux: TotauxCommande,
  service: { taxeComprise: boolean; nomTaux: string | null },
): LigneApercu[] {
  const lignes: LigneApercu[] = [
    {
      libelle: 'Articles',
      montantMillimes: totaux.baseApresRemisesMillimes,
      dont: false,
    },
  ]

  /*
   * La taxe EXCLUSIVE des articles, quand il y en a une.
   *
   * `baseApresRemisesMillimes` est la base après remises : elle contient déjà
   * les taxes INCLUSES, et pas les exclusives. L'omettre ferait manquer à la
   * colonne exactement ce montant — sur un restaurant qui facture hors taxe,
   * l'aperçu ne tomberait jamais juste.
   */
  const taxeArticles = totaux.taxeExclusiveMillimes - taxeServiceAjoutee(totaux, service)
  if (taxeArticles > 0) {
    lignes.push({ libelle: 'Taxes', montantMillimes: taxeArticles, dont: false })
  }

  if (totaux.serviceMillimes > 0) {
    lignes.push({ libelle: 'Service', montantMillimes: totaux.serviceMillimes, dont: false })

    if (totaux.taxeServiceMillimes > 0) {
      const nom = service.nomTaux ?? 'Taxe'
      lignes.push(
        service.taxeComprise
          ? {
              libelle: `dont ${nom} sur le service`,
              montantMillimes: totaux.taxeServiceMillimes,
              dont: true,
            }
          : {
              libelle: `${nom} sur le service`,
              montantMillimes: totaux.taxeServiceMillimes,
              dont: false,
            },
      )
    }
  }

  if (totaux.timbreFiscalMillimes > 0) {
    lignes.push({
      libelle: 'Timbre',
      montantMillimes: totaux.timbreFiscalMillimes,
      dont: false,
    })
  }

  return lignes
}

/** La part de `taxeExclusiveMillimes` qui vient du SERVICE, et non des lignes. */
function taxeServiceAjoutee(
  totaux: TotauxCommande,
  service: { taxeComprise: boolean },
): number {
  if (totaux.taxeServiceMillimes === 0) return 0
  return service.taxeComprise ? 0 : totaux.taxeServiceMillimes
}

/** La somme des lignes qui S'ADDITIONNENT — celles qui ne sont pas des « dont ». */
export function sommeApercu(lignes: readonly LigneApercu[]): number {
  return lignes.reduce((t, l) => (l.dont ? t : t + l.montantMillimes), 0)
}
