/**
 * @kaissi/i18n — les langues de Kaissi : français et arabe.
 *
 * ── Le français EST la clé ────────────────────────────────────────────────
 *
 * On écrit `t('Encaisser')`, pas `t('commande.bouton.encaisser')`. Le code
 * reste lisible en français — c'est la règle n° 8 du dépôt — et le
 * dictionnaire arabe associe chaque phrase française à sa traduction. C'est
 * le modèle de gettext, celui d'Odoo et de WordPress : il a fait ses
 * preuves sur des applications bien plus grandes que celle-ci.
 *
 * Une phrase absente du dictionnaire s'affiche EN FRANÇAIS plutôt que de
 * disparaître : un écran à moitié traduit reste utilisable, un écran avec
 * des trous ne l'est pas. Mais ce repli n'est pas un état normal — le test
 * de couverture (`couverture.test.ts`) exige que TOUTE phrase passée à `t()`
 * dans la caisse et le back-office ait sa traduction.
 *
 * ── Une seule source, comme les totaux ────────────────────────────────────
 *
 * La caisse et le back-office importent ce paquet à l'identique. Deux
 * dictionaires finiraient par traduire « Encaissée » de deux façons, et le
 * gérant lirait un mot sur la tablette et un autre au bureau.
 *
 * ── Ce qui ne se traduit PAS ──────────────────────────────────────────────
 *
 *  • Les DONNÉES : le nom d'un plat, d'une catégorie, d'un employé, d'un
 *    taux de TVA — c'est le restaurateur qui les écrit, dans la langue de
 *    son choix.
 *  • Le TICKET imprimé : l'imprimante thermique encode en CP858, qui ne
 *    contient aucun caractère arabe ; et ses mentions fiscales sont à
 *    valider par un expert-comptable. Il reste en français.
 *  • Les montants : `formaterTND` reste la seule écriture d'un montant
 *    (RÈGLE 1). Les chiffres restent occidentaux, comme en Tunisie.
 */

export { AR } from './ar.js'
import { AR } from './ar.js'

export type Langue = 'fr' | 'ar'

export const LANGUES: readonly Langue[] = ['fr', 'ar']
export const LANGUE_PAR_DEFAUT: Langue = 'fr'

/** Le nom de chaque langue, écrit DANS cette langue : on la reconnaît sans la lire. */
export const NOM_LANGUE: Readonly<Record<Langue, string>> = {
  fr: 'Français',
  ar: 'العربية',
}

export function estLangue(valeur: unknown): valeur is Langue {
  return valeur === 'fr' || valeur === 'ar'
}

/** Sens d'écriture, pour l'attribut `dir` de la page. */
export function direction(langue: Langue): 'ltr' | 'rtl' {
  return langue === 'ar' ? 'rtl' : 'ltr'
}

/**
 * La locale des dates et des heures.
 *
 * `ar-TN` et non `ar` : ICU y donne les mois TUNISIENS (جانفي، فيفري،
 * أفريل، جوان، جويلية، أوت…) et des chiffres occidentaux — exactement ce
 * qu'on lit en Tunisie. `ar-SA` donnerait des chiffres arabes-indiens.
 */
export function locale(langue: Langue): 'fr-FR' | 'ar-TN' {
  return langue === 'ar' ? 'ar-TN' : 'fr-FR'
}

export type Valeurs = Readonly<Record<string, string | number>>

/** Remplace `{nom}` par sa valeur. Une valeur absente laisse la marque visible. */
export function interpoler(modele: string, valeurs?: Valeurs): string {
  if (!valeurs) return modele
  return modele.replace(/\{(\w+)\}/g, (marque, nom: string) =>
    Object.prototype.hasOwnProperty.call(valeurs, nom) ? String(valeurs[nom]) : marque,
  )
}

/**
 * Le CONTEXTE d'une phrase ambiguë : `paiement|Carte`.
 *
 * Le français a des homonymes que l'arabe sépare : « Carte » est la carte
 * du restaurant (قائمة الطعام) dans le menu, et une carte bancaire
 * (بطاقة بنكية) dans un paiement. Le préfixe — des minuscules, puis une
 * barre verticale — distingue les deux clés ; il ne s'affiche jamais. C'est
 * le `msgctxt` de gettext.
 */
const CONTEXTE = /^([a-z]+)\|/

export function sansContexte(cle: string): string {
  return cle.replace(CONTEXTE, '')
}

/**
 * Isole une valeur insérée dans une phrase arabe : FSI … PDI.
 *
 * Sans cela, l'algorithme bidirectionnel range le nom d'un plat, un numéro
 * de ticket ou « 4,200 TND » selon le texte arabe qui les entoure — et un
 * « P1-000042 » devient « 000042-P1 ». L'isolement « premier fort » (U+2068)
 * garde chaque valeur dans son propre sens. Les caractères sont invisibles ;
 * ils ne sont ajoutés qu'en arabe, le français n'en a pas besoin.
 */
function isoler(valeurs?: Valeurs): Valeurs | undefined {
  if (!valeurs) return valeurs
  const isolees: Record<string, string> = {}
  for (const [nom, valeur] of Object.entries(valeurs)) isolees[nom] = `\u2068${valeur}\u2069`
  return isolees
}

/** Traduit une phrase française. Absente du dictionnaire : rendue en français. */
export function traduire(langue: Langue, texte: string, valeurs?: Valeurs): string {
  if (langue === 'fr') return interpoler(sansContexte(texte), valeurs)
  return interpoler(AR[texte] ?? sansContexte(texte), isoler(valeurs))
}

/** Les modèles du dictionnaire qui portent des `{marques}`, compilés une fois. */
let modeles: { motif: RegExp; noms: string[]; cle: string }[] | null = null

function modelesCompiles() {
  if (modeles) return modeles
  modeles = Object.keys(AR)
    .filter((cle) => /\{\w+\}/.test(cle))
    .map((cle) => {
      const noms: string[] = []
      const source = cle
        .split(/(\{\w+\})/)
        .map((morceau) => {
          const marque = /^\{(\w+)\}$/.exec(morceau)
          if (marque) {
            noms.push(marque[1]!)
            return '(.+?)'
          }
          return morceau.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        })
        .join('')
      return { motif: new RegExp(`^${source}$`, 's'), noms, cle }
    })
  return modeles
}

/**
 * Traduit un message DÉJÀ ASSEMBLÉ en français — une erreur du domaine, une
 * réponse du serveur de synchronisation.
 *
 * Ces messages arrivent avec leurs valeurs incrustées (« « Pizza » a déjà été
 * remboursé. »). On cherche d'abord la phrase exacte, puis un modèle du
 * dictionnaire dont elle est une instance (« « {nom} » a déjà été
 * remboursé. »), et on reporte les valeurs dans la traduction. Un message
 * inconnu reste en français : mieux vaut une explication dans la mauvaise
 * langue qu'une erreur muette.
 */
export function traduireMessage(langue: Langue, message: string): string {
  if (langue === 'fr') return message
  const exact = AR[message]
  if (exact !== undefined) return exact
  for (const { motif, noms, cle } of modelesCompiles()) {
    const trouve = motif.exec(message)
    if (!trouve) continue
    const valeurs: Record<string, string> = {}
    noms.forEach((nom, i) => {
      // Une valeur insérée peut être elle-même une phrase de l'interface :
      // « Le nom est obligatoire. » est assemblé à partir de « Le nom ».
      // Elle se traduit si le dictionnaire la connaît, et reste telle quelle
      // sinon — c'est alors une donnée (le nom d'un plat, un montant).
      const valeur = trouve[i + 1] ?? ''
      valeurs[nom] = AR[valeur] ?? valeur
    })
    return interpoler(AR[cle]!, isoler(valeurs))
  }
  return message
}

/**
 * Marque une phrase écrite HORS d'un composant — une liste de module, comme
 * les entrées de la navigation — qui sera traduite à l'AFFICHAGE, par
 * `t(entree.libelle)`.
 *
 * Elle ne fait rien à l'exécution. Elle existe pour le test de couverture :
 * il lit `aTraduire('…')` comme `t('…')`, et exige donc la traduction de
 * cette phrase aussi. Sans elle, une entrée de menu ajoutée demain
 * s'afficherait en français au milieu de l'arabe, sans qu'aucun test le voie.
 */
export function aTraduire(texte: string): string {
  return texte
}

export type Traducteur = (texte: string, valeurs?: Valeurs) => string

/** Un `t()` lié à une langue. */
export function traducteur(langue: Langue): Traducteur {
  return (texte, valeurs) => traduire(langue, texte, valeurs)
}

/**
 * Date et heure lisibles, dans la langue — heure sur 24 h dans les deux.
 *
 * L'arabe par défaut d'ICU affiche « 03:05 م » ; un restaurant tunisien lit
 * « 15:05 ». `hourCycle: 'h23'` le dit explicitement.
 */
export function formaterDate(
  langue: Langue,
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return String(date)
  const avecHeure = options.hour !== undefined || options.timeStyle !== undefined
  return d.toLocaleString(locale(langue), avecHeure ? { hourCycle: 'h23', ...options } : options)
}
