/**
 * Les filtres communs à tous les rapports : période, tranche horaire, employé.
 *
 * ── Pourquoi ils vivent dans l'URL ────────────────────────────────────────
 *
 * `?du=…&au=…&h=12-15&employe=…`. Un rapport se partage par copier-coller,
 * se met en favori, et survit à un rechargement. C'est aussi ce qui permet
 * aux composants serveur de les lire sans qu'aucune donnée ne transite par
 * le navigateur.
 *
 * ── La tranche horaire répond à une vraie question ────────────────────────
 *
 * « Combien fait le service du midi ? » ne se lit pas sur un total du jour.
 * Elle est exprimée en HEURES LOCALES de l'établissement — à Tunis, l'écart
 * avec UTC suffirait à faire basculer un service de midi dans la tranche du
 * matin.
 *
 * La borne haute est INCLUSE : « 12–15 » retient tout ce qui a été encaissé
 * jusqu'à 15 h 59. C'est la lecture naturelle d'un service, et celle de
 * Loyverse.
 */

export interface FiltresRapport {
  /** Heure locale de début, 0–23. */
  readonly heureDebut: number
  /** Heure locale de fin, INCLUSE, 0–23. */
  readonly heureFin: number
  /** `null` = tous les employés. */
  readonly employeId: string | null
}

export const FILTRES_PAR_DEFAUT: FiltresRapport = {
  heureDebut: 0,
  heureFin: 23,
  employeId: null,
}

/** Vrai quand rien n'est filtré — utile pour ne pas afficher un bandeau vide. */
export function filtresNeutres(filtres: FiltresRapport): boolean {
  return filtres.heureDebut === 0 && filtres.heureFin === 23 && filtres.employeId === null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lit les filtres depuis les paramètres d'URL.
 *
 * Tolérant par construction : une valeur absurde retombe sur le défaut au
 * lieu de faire tomber la page. Une URL se tape à la main, se tronque en la
 * copiant, et se transmet par messagerie qui coupe les liens longs.
 */
export function resoudreFiltres(params: Record<string, string | undefined>): FiltresRapport {
  const heures = /^(\d{1,2})-(\d{1,2})$/.exec(params['h'] ?? '')
  let heureDebut = FILTRES_PAR_DEFAUT.heureDebut
  let heureFin = FILTRES_PAR_DEFAUT.heureFin
  if (heures) {
    const debut = Number(heures[1])
    const fin = Number(heures[2])
    if (debut >= 0 && debut <= 23 && fin >= 0 && fin <= 23 && debut <= fin) {
      heureDebut = debut
      heureFin = fin
    }
  }
  const employe = params['employe']
  return {
    heureDebut,
    heureFin,
    employeId: employe && UUID.test(employe) ? employe : null,
  }
}

/** Réécrit les filtres en paramètres d'URL, en omettant les valeurs neutres. */
export function versParametres(filtres: FiltresRapport): Record<string, string> {
  const params: Record<string, string> = {}
  if (filtres.heureDebut !== 0 || filtres.heureFin !== 23) {
    params['h'] = `${filtres.heureDebut}-${filtres.heureFin}`
  }
  if (filtres.employeId) params['employe'] = filtres.employeId
  return params
}
