/**
 * Limitation de débit — sur les identifiants, JAMAIS sur la caisse.
 *
 * ── Ce qu'on protège, et de quoi ──────────────────────────────────────────
 *
 * `POST /appairage` accepte un e-mail et un mot de passe, sans
 * authentification préalable : c'est, par construction, le seul endroit du
 * produit où l'on peut essayer un mot de passe. Sans limite, deux attaques
 * sont ouvertes :
 *
 *   • le BOURRAGE D'IDENTIFIANTS — une liste d'e-mails et de mots de passe
 *     volés ailleurs, rejouée jusqu'à ce que l'un passe ;
 *   • pire, et c'est le point que l'on manque : chacune de nos tentatives
 *     appelle GoTrue. Le quota de Supabase est PAR PROJET, et c'est notre
 *     serveur qu'il voit. Un attaquant n'a donc pas besoin de trouver un mot
 *     de passe : il lui suffit d'épuiser le quota pour que les VRAIS gérants
 *     ne puissent plus appairer. Sans limite chez nous, l'endpoint est un
 *     amplificateur de déni de service.
 *
 * ── Ce qu'on ne limite PAS, et pourquoi c'est délibéré ────────────────────
 *
 * `/sync/*`. Jamais. Une caisse qui rattrape trois semaines hors ligne envoie
 * des dizaines de lots à la suite ; la freiner retarderait des encaissements
 * déjà faits. Et le jeton d'appareil n'est pas devinable — 32 octets
 * aléatoires — donc il n'y a rien à protéger contre la force brute.
 *
 * **L'encaissement ne doit jamais s'arrêter** vaut aussi contre nos propres
 * garde-fous.
 *
 * ── Ce que cette implémentation NE fait pas ───────────────────────────────
 *
 * Elle compte en MÉMOIRE, donc par processus. Avec plusieurs instances, un
 * attaquant obtient N fois le quota. C'est un choix assumé au stade actuel —
 * une instance — et la limite est documentée : le jour où le service passe à
 * l'échelle horizontale, le compteur doit descendre dans Postgres ou Redis.
 * Un limiteur en mémoire qu'on croit distribué est pire que pas de limiteur,
 * parce qu'on cesse de regarder.
 */

/** Une fenêtre glissante : combien de coups, sur quelle durée. */
export interface Quota {
  /** Nombre de tentatives autorisées dans la fenêtre. */
  readonly coups: number
  /** Longueur de la fenêtre, en millisecondes. */
  readonly fenetreMs: number
}

export interface Verdict {
  readonly autorise: boolean
  /** Coups restants dans la fenêtre. */
  readonly restants: number
  /** Secondes à attendre avant de réessayer — 0 si autorisé. */
  readonly attendreSecondes: number
}

/**
 * Le nombre de clés retenues au maximum.
 *
 * SANS ce plafond, le limiteur devient lui-même la faille : il suffit
 * d'envoyer un million d'adresses différentes pour faire grossir la table
 * jusqu'à faire tomber le processus. On protégerait le mot de passe en
 * offrant l'épuisement mémoire — un échange défavorable.
 *
 * Quand le plafond est atteint, on évince les entrées les plus anciennes.
 * Une éviction peut faire perdre le compte d'un attaquant, mais il lui faut
 * pour cela remplir la table plus vite que la fenêtre ne s'écoule, ce qui
 * demande déjà beaucoup plus de trafic que le bourrage qu'on empêche.
 */
const CLES_MAX = 20_000

/**
 * On redescend NETTEMENT sous le plafond quand on compacte.
 *
 * Sans cette marge, la table oscille autour du plafond et chaque nouvelle
 * clé déclenche un balayage complet : le limiteur devient O(n log n) PAR
 * REQUÊTE, exactement sous l'attaque qu'il doit absorber. Mesuré : 8
 * secondes pour 25 000 clés. En redescendant à 75 %, le balayage n'a lieu
 * qu'une fois toutes les 5 000 clés — coût amorti constant.
 */
const CLES_APRES_COMPACTAGE = Math.floor(CLES_MAX * 0.75)

interface Compteur {
  /** Horodatages des tentatives retenues, les plus anciennes d'abord. */
  coups: number[]
  /** Dernier contact — sert à l'éviction. */
  vuA: number
}

export class Limiteur {
  private readonly table = new Map<string, Compteur>()
  private readonly quota: Quota
  private readonly maintenant: () => number

  /*
   * Champs déclarés puis affectés, et NON des propriétés de paramètre
   * (`constructor(private readonly quota: Quota)`).
   *
   * Ce n'est pas une préférence de style : la production exécute ce
   * TypeScript par le « type stripping » de Node, qui se contente d'effacer
   * les annotations sans les compiler. Une propriété de paramètre exige une
   * transformation, pas un effacement — Node refuse donc le fichier avec
   * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, et le SERVICE NE DÉMARRE PAS.
   *
   * La même règle vaut pour `enum` et `namespace`. C'est
   * `test/demarrage.test.ts` qui l'attrape, en lançant la vraie commande de
   * production plutôt qu'en important le module.
   */
  constructor(quota: Quota, maintenant: () => number = Date.now) {
    this.quota = quota
    this.maintenant = maintenant
  }

  /**
   * Enregistre une tentative et rend le verdict.
   *
   * L'appel COMPTE : appeler `verifier` deux fois pour la même requête
   * consomme deux coups. C'est volontaire — un limiteur qu'on peut consulter
   * sans conséquence finit consulté sans conséquence.
   */
  verifier(cle: string): Verdict {
    const t = this.maintenant()
    const debut = t - this.quota.fenetreMs

    const compteur = this.table.get(cle) ?? { coups: [], vuA: t }
    // On ne garde que la fenêtre courante : sans cet élagage, une clé très
    // sollicitée garderait ses coups indéfiniment.
    compteur.coups = compteur.coups.filter((h) => h > debut)
    compteur.vuA = t

    if (compteur.coups.length >= this.quota.coups) {
      this.table.set(cle, compteur)
      const plusAncien = compteur.coups[0] ?? t
      return {
        autorise: false,
        restants: 0,
        // Arrondi au SUPÉRIEUR : annoncer 0 seconde ferait réessayer tout de
        // suite, et le client conclurait que l'en-tête ment.
        attendreSecondes: Math.max(1, Math.ceil((plusAncien + this.quota.fenetreMs - t) / 1000)),
      }
    }

    compteur.coups.push(t)
    this.table.set(cle, compteur)
    this.evincer(t)
    return {
      autorise: true,
      restants: this.quota.coups - compteur.coups.length,
      attendreSecondes: 0,
    }
  }

  /**
   * Efface le compteur d'une clé.
   *
   * Appelé sur une AUTHENTIFICATION RÉUSSIE : un gérant qui s'est trompé
   * trois fois puis a retrouvé son mot de passe ne doit pas rester bloqué par
   * ses propres essais. Sans cela, la limite punit surtout les distraits.
   */
  reussite(cle: string): void {
    this.table.delete(cle)
  }

  /** Nombre de clés suivies — pour les tests et la supervision. */
  get taille(): number {
    return this.table.size
  }

  /**
   * Évince ce qui a expiré, puis, si besoin, les plus anciennes.
   *
   * Le balayage n'a lieu qu'au franchissement du plafond : le faire à chaque
   * appel coûterait un parcours complet par tentative, ce qui transformerait
   * le limiteur en goulot.
   */
  private evincer(t: number): void {
    if (this.table.size <= CLES_MAX) return

    // D'abord ce qui a expiré : c'est gratuit et souvent suffisant.
    const perimees = t - this.quota.fenetreMs
    for (const [cle, compteur] of this.table) {
      if (compteur.vuA <= perimees) this.table.delete(cle)
    }
    if (this.table.size <= CLES_APRES_COMPACTAGE) return

    /*
     * Toujours plein de clés vivantes : on sacrifie les plus anciennes,
     * jusqu'à la marge basse.
     *
     * `Map` conserve l'ordre d'INSERTION, pas l'ordre d'usage — la première
     * clé n'est donc pas forcément la moins récemment vue. C'est une
     * approximation assumée : trier serait exact et coûterait un O(n log n)
     * qu'on cherche justement à éviter. Le pire cas d'une éviction
     * imparfaite est qu'un attaquant récupère quelques coups ; celui d'un
     * tri à chaque requête est que le service tombe.
     */
    let aSupprimer = this.table.size - CLES_APRES_COMPACTAGE
    for (const cle of this.table.keys()) {
      if (aSupprimer <= 0) break
      this.table.delete(cle)
      aSupprimer -= 1
    }
  }
}

/**
 * Les quotas retenus, et le raisonnement derrière chaque chiffre.
 *
 * Ils sont volontairement GÉNÉREUX pour un humain et serrés pour une machine.
 * Un gérant qui appaire une tablette s'y reprend à deux ou trois fois ; un
 * script en essaie mille.
 */
export const QUOTA_APPAIRAGE_PAR_IP: Quota = {
  // Un restaurant appaire plusieurs tablettes de suite, depuis la même
  // connexion : 20 laisse passer une mise en service complète.
  coups: 20,
  fenetreMs: 15 * 60_000,
}

export const QUOTA_APPAIRAGE_PAR_COMPTE: Quota = {
  // Par ADRESSE, et beaucoup plus serré : c'est la dimension qui compte
  // contre le bourrage d'identifiants, où l'attaquant change d'IP mais pas
  // de cible. Cinq essais ratés sur un quart d'heure suffisent à quiconque
  // connaît son mot de passe — et une réussite remet le compteur à zéro.
  coups: 5,
  fenetreMs: 15 * 60_000,
}

export const QUOTA_ADMIN_PAR_COMPTE: Quota = {
  // Les routes d'administration sont déjà derrière un jeton de session
  // valide : la limite ne sert pas à empêcher une intrusion, mais à borner
  // les dégâts d'un jeton volé, et à éviter qu'une boucle d'interface
  // n'inonde GoTrue.
  coups: 30,
  fenetreMs: 60_000,
}

/**
 * L'adresse du client, derrière un proxy d'hébergeur.
 *
 * Railway, Vercel et Fly terminent TLS devant nous : `remoteAddress` est
 * l'adresse du proxy, la même pour tout le monde. On lit donc l'en-tête
 * qu'ils posent — en ne gardant que la PREMIÈRE adresse, celle du client.
 *
 * ⚠ Cet en-tête est falsifiable par qui parle directement au processus. Il
 *   n'est digne de confiance que parce que l'hébergeur le réécrit à
 *   l'entrée. C'est aussi pourquoi la limite par ADRESSE E-MAIL existe :
 *   elle, on ne peut pas la contourner en changeant d'en-tête.
 */
export function adresseClient(entetes: {
  get(nom: string): string | null | undefined
}): string {
  const chaine =
    entetes.get('x-forwarded-for') ??
    entetes.get('x-real-ip') ??
    entetes.get('cf-connecting-ip') ??
    ''
  const premiere = chaine.split(',')[0]?.trim()
  return premiere || 'inconnue'
}
