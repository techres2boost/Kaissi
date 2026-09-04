/**
 * Export CSV — un seul endroit pour l'échappement et l'encodage.
 *
 * ── Pourquoi CSV et pas un vrai .xlsx ─────────────────────────────────────
 *
 * La demande dit « export Excel ». Excel OUVRE un CSV, et un CSV s'ouvre
 * aussi dans LibreOffice, Google Sheets, un éditeur de texte, et se relit par
 * un script comptable dans dix ans. Produire un vrai classeur exigerait une
 * bibliothèque d'écriture ZIP + XML dans le back-office, pour un fichier que
 * personne ne relira jamais avec des formules. Le jour où un client demande
 * plusieurs onglets ou des styles, ce module rendra un `.xlsx` sans que les
 * pages qui l'appellent changent.
 *
 * ── Les trois pièges d'un CSV « français », et comment ils sont réglés ────
 *
 * 1. **Le séparateur.** Excel en configuration française attend un
 *    POINT-VIRGULE, pas une virgule — parce que la virgule est déjà le
 *    séparateur décimal. Avec une virgule, tout le fichier atterrit dans la
 *    première colonne, et le gérant conclut que l'export est cassé.
 *
 * 2. **L'encodage.** Sans marque d'ordre des octets (BOM), Excel lit un
 *    fichier UTF-8 comme du Latin-1 : « Crème brûlée » devient « CrÃ¨me
 *    brÃ»lÃ©e ». Le BOM ne change pas le contenu, il lève l'ambiguïté.
 *
 * 3. **L'injection de formule.** Une cellule qui commence par `=`, `+`, `-`
 *    ou `@` est interprétée comme une FORMULE à l'ouverture. Un nom de
 *    produit saisi comme `=1+1` s'afficherait « 2 » ; pire, certaines
 *    fonctions déclenchent un avertissement de sécurité, voire exécutent
 *    quelque chose. On préfixe donc ces cellules d'une apostrophe : le texte
 *    reste lisible et n'est plus une formule.
 */

/** Ce qu'une cellule peut contenir avant mise en forme. */
export type Cellule = string | number | null | undefined

const SEPARATEUR = ';'
/** Marque d'ordre des octets : sans elle, Excel lit l'UTF-8 en Latin-1. */
const BOM = '﻿'

/**
 * Met une cellule en forme, en la neutralisant si besoin.
 *
 * Les nombres ne sont PAS reformatés ici : les montants arrivent déjà en
 * texte français depuis `formaterTND`, et un nombre brut doit rester brut
 * pour rester calculable dans le tableur.
 */
function cellule(valeur: Cellule): string {
  if (valeur === null || valeur === undefined) return ''
  const texte = String(valeur)

  // Neutralisation de formule — voir le piège 3 en tête de fichier.
  const dangereuse = /^[=+\-@\t\r]/.test(texte)
  const sur = dangereuse ? `'${texte}` : texte

  // Guillemets doublés, et champ entouré dès qu'il contient un séparateur,
  // un guillemet ou un saut de ligne. Un nom de produit avec un point-virgule
  // décalerait sinon toutes les colonnes suivantes.
  if (/["\n\r;]/.test(sur)) return `"${sur.replace(/"/g, '""')}"`
  return sur
}

/** Assemble un CSV complet, prêt à être servi. */
export function versCsv(entetes: readonly string[], lignes: readonly Cellule[][]): string {
  const corps = [entetes, ...lignes]
    .map((ligne) => ligne.map(cellule).join(SEPARATEUR))
    // CRLF : c'est ce qu'attend Excel sous Windows, et les autres outils
    // l'acceptent tous.
    .join('\r\n')
  return BOM + corps + '\r\n'
}

/**
 * Un nom de fichier lisible ET sûr.
 *
 * Le nom du restaurant y figure — un gérant qui exporte trois établissements
 * se retrouverait sinon avec trois « ventes.csv » dans son dossier de
 * téléchargements, impossibles à distinguer.
 *
 * Tout ce qui n'est ni lettre ni chiffre devient un tiret : un « / » dans un
 * nom d'établissement casserait l'en-tête HTTP, et les accents ne survivent
 * pas à tous les systèmes de fichiers.
 */
export function nomFichier(prefixe: string, etablissement: string, suffixe?: string): string {
  const propre = (texte: string) =>
    texte
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40)
  const morceaux = [prefixe, propre(etablissement), suffixe ? propre(suffixe) : null].filter(
    (m): m is string => !!m && m.length > 0,
  )
  return `${morceaux.join('-')}.csv`
}

/** La réponse HTTP complète : type, encodage, et téléchargement forcé. */
export function reponseCsv(contenu: string, fichier: string): Response {
  return new Response(contenu, {
    headers: {
      // `charset=utf-8` EN PLUS du BOM : les deux se complètent, et un
      // navigateur qui prévisualise le fichier a besoin de l'en-tête.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fichier}"`,
      // Un export est une photo d'un instant : le mettre en cache
      // rendrait un fichier périmé au clic suivant, sans rien qui le dise.
      'cache-control': 'no-store',
    },
  })
}
