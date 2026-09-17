/**
 * Les formules d'abonnement — et ce qu'elles ont le droit de fermer.
 *
 * ── Pourquoi c'est une RÈGLE, donc ici ────────────────────────────────────
 *
 * « Cette formule ouvre-t-elle l'inventaire avancé ? », « combien de jours
 * d'historique ? », « l'essai est-il fini ? » : ce sont des décisions, pas des
 * sommes. Les écrire dans le back-office les mettrait à un endroit où personne
 * ne les relit ensemble, et elles dériveraient — le bandeau dirait « il vous
 * reste 3 jours » pendant que la garde, elle, aurait déjà fermé.
 *
 * ── ⚠ LA FRONTIÈRE, et elle n'est pas négociable ──────────────────────────
 *
 * **Un abonnement ne ferme QUE des écrans de gestion. Jamais un geste de
 * caisse.**
 *
 * Le cahier des charges demandait que la formule gratuite « n'ait pas la
 * partie offline qui fonctionne ». C'est infaisable ici, et le dire vaut
 * mieux que le contourner :
 *
 *   • le POS est EMPAQUETÉ dans l'APK. Il n'a pas de mode « connecté » dont
 *     on pourrait le priver : sa base est locale, ses ventes sont un journal
 *     local, et il encaisse avant même d'avoir vu un serveur. « Désactiver
 *     l'offline » voudrait dire écrire du code qui EMPÊCHE la caisse de
 *     fonctionner sans réseau — démonter exprès la seule chose que ce produit
 *     promet ;
 *
 *   • et une caisse qui refuserait d'encaisser parce qu'un essai a expiré
 *     s'arrêterait un vendredi soir, en plein service, devant des clients qui
 *     attendent. Aucune ligne de revenu ne justifie cela.
 *
 * Ce module ne connaît donc AUCUN module de caisse. Les seuls verrous qu'il
 * sait poser portent sur des rapports longs et des écrans d'inventaire — des
 * choses dont l'absence fait râler un gérant le lundi matin, jamais échouer
 * une vente le samedi soir.
 */

/** Les formules, telles que la contrainte `check` de la migration 0040 les liste. */
export const PLANS = ['essai', 'gratuit', 'pro'] as const
export type Plan = (typeof PLANS)[number]

/**
 * Les modules de GESTION qu'une formule peut ouvrir ou fermer.
 *
 * Volontairement court. Chaque entrée ajoutée ici est une chose de plus qu'un
 * client peut perdre du jour au lendemain : on n'en ajoute pas « au cas où ».
 */
/*
 * ⚑ Un seul, et pas deux.
 *
 * « historique_illimite » a figuré ici, et personne ne l'a jamais consulté :
 * la profondeur d'historique vient de `joursHistorique`, qui est la vraie
 * règle. Deux représentations de la même décision ne restent d'accord que
 * tant qu'on y pense — le jour où l'une change, l'écran annonce une chose et
 * la garde en applique une autre, sans que rien n'échoue.
 *
 * Quand une formule doit ouvrir quelque chose de mesurable en jours, cela
 * s'écrit dans `Formule`. `MODULES` ne sert qu'à ce qui s'ouvre ou se ferme
 * entièrement.
 */
export const MODULES = ['inventaire_avance'] as const
export type ModulePayant = (typeof MODULES)[number]

export interface Formule {
  readonly plan: Plan
  readonly nom: string
  readonly modules: readonly ModulePayant[]
  /**
   * Profondeur d'historique consultable dans les rapports, en jours.
   *
   * `null` = sans limite. Ce n'est PAS une purge : les ventes restent en base
   * et remontent intégralement le jour où l'on repasse au payant. Une formule
   * qui effacerait des écritures comptables serait bien autre chose qu'une
   * formule.
   */
  readonly joursHistorique: number | null
}

export const FORMULES: Readonly<Record<Plan, Formule>> = {
  essai: {
    plan: 'essai',
    nom: 'Essai',
    // L'essai ouvre TOUT : c'est ce qu'on essaie.
    modules: MODULES,
    joursHistorique: null,
  },
  gratuit: {
    plan: 'gratuit',
    nom: 'Gratuit',
    modules: [],
    /*
     * Deux mois d'historique.
     *
     * Assez pour tenir une comptabilité courante et comparer deux mois ; pas
     * assez pour suivre une saison. C'est la limite qui se remarque quand on
     * en a besoin, et pas avant — l'inverse d'un verrou qui gêne tous les
     * jours pour rien.
     */
    joursHistorique: 62,
  },
  pro: {
    plan: 'pro',
    nom: 'Pro',
    modules: MODULES,
    joursHistorique: null,
  },
}

/** Durée de l'essai offert à l'ouverture d'un compte depuis la caisse. */
export const JOURS_ESSAI = 14

export interface AbonnementBrut {
  readonly plan: string | null
  readonly finEssai: string | Date | null
}

export interface EtatAbonnement {
  readonly plan: Plan
  readonly nom: string
  /** L'essai court-il ENCORE ? Faux pour toute autre formule. */
  readonly enEssai: boolean
  /** Jours entiers restants, zéro si l'essai est fini. Nul hors essai. */
  readonly joursRestants: number | null
  /** L'essai est-il arrivé à échéance ? C'est ce qui fait retomber au gratuit. */
  readonly essaiExpire: boolean
  readonly modules: readonly ModulePayant[]
  readonly joursHistorique: number | null
}

/**
 * L'état d'un abonnement à un instant donné.
 *
 * ── Un essai expiré RETOMBE au gratuit, il ne coupe pas ───────────────────
 *
 * C'est la différence entre « vous ne pouvez plus rien faire » et « vous avez
 * de nouveau la formule gratuite ». La seconde laisse le restaurant
 * fonctionner ; la première le prend en otage. Et comme la caisse n'est de
 * toute façon jamais concernée, il n'y a rien à couper d'autre.
 *
 * ── Une formule inconnue vaut `gratuit`, jamais `pro` ─────────────────────
 *
 * Si la base contenait un jour une valeur qu'on ne connaît pas — une
 * migration à moitié appliquée, une formule retirée — ouvrir tous les modules
 * serait offrir le payant à qui ne l'a pas. On retombe sur la plus petite.
 */
export function etatAbonnement(
  brut: AbonnementBrut | null,
  maintenant: Date = new Date(),
): EtatAbonnement {
  const plan: Plan = estPlan(brut?.plan) ? brut.plan : 'gratuit'
  const fin = versDate(brut?.finEssai ?? null)

  const essaiExpire = plan === 'essai' && fin !== null && fin.getTime() <= maintenant.getTime()
  const enEssai = plan === 'essai' && !essaiExpire

  /*
   * La formule EFFECTIVE : un essai fini donne les droits du gratuit.
   *
   * Sans cette bascule, il faudrait se souvenir partout d'écrire
   * « plan === 'essai' && !expiré », et un seul oubli laisserait l'inventaire
   * avancé ouvert indéfiniment.
   */
  const effective = FORMULES[essaiExpire ? 'gratuit' : plan]

  return {
    plan,
    nom: FORMULES[plan].nom,
    enEssai,
    /*
     * Arrondi au SUPÉRIEUR : à onze heures de la fin, il reste « 1 jour », pas
     * zéro. Annoncer zéro à quelqu'un qui peut encore travailler aujourd'hui
     * le ferait renoncer une journée trop tôt.
     */
    joursRestants:
      plan === 'essai' && fin !== null
        ? Math.max(0, Math.ceil((fin.getTime() - maintenant.getTime()) / 86_400_000))
        : null,
    essaiExpire,
    modules: effective.modules,
    joursHistorique: effective.joursHistorique,
  }
}

/** Ce module est-il ouvert ? La seule question que les écrans posent. */
export function moduleOuvert(etat: EtatAbonnement, module: ModulePayant): boolean {
  return etat.modules.includes(module)
}

/**
 * La date la plus ANCIENNE qu'un rapport peut atteindre.
 *
 * `null` = sans limite. Rendue plutôt que comparée sur place : un écran qui
 * calculerait lui-même « aujourd'hui moins soixante-deux jours » finirait par
 * le faire différemment de son voisin, et deux rapports afficheraient deux
 * profondeurs pour la même formule.
 */
export function debutHistorique(etat: EtatAbonnement, maintenant: Date = new Date()): Date | null {
  if (etat.joursHistorique === null) return null
  return new Date(maintenant.getTime() - etat.joursHistorique * 86_400_000)
}

/**
 * La fin d'un essai qui commencerait maintenant.
 *
 * `jours` existe pour le geste commercial — « encore deux semaines, il
 * installe son deuxième restaurant ». Sans lui, prolonger un essai obligerait
 * à écrire la date à la main en SQL, donc à se tromper de mois un jour.
 */
export function finEssaiDepuis(debut: Date = new Date(), jours: number = JOURS_ESSAI): Date {
  return new Date(debut.getTime() + jours * 86_400_000)
}

function estPlan(valeur: unknown): valeur is Plan {
  return typeof valeur === 'string' && (PLANS as readonly string[]).includes(valeur)
}

function versDate(valeur: string | Date | null): Date | null {
  if (valeur === null) return null
  const d = valeur instanceof Date ? valeur : new Date(valeur)
  return Number.isNaN(d.getTime()) ? null : d
}
