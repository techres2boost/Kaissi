/**
 * La traduction ne se dégrade pas en silence.
 *
 * Un écran à moitié traduit n'échoue nulle part : il affiche simplement du
 * français au milieu de l'arabe, et c'est le caissier qui le découvre. Ces
 * tests font échouer la CI à la place, sur la règle et non sur un exemple :
 *
 *   1. toute phrase passée à `t('…')` dans la caisse et le back-office a sa
 *      traduction arabe ;
 *   2. aucun texte visible n'est resté écrit en dur dans le JSX — ni entre
 *      deux balises, ni dans un attribut lu par l'utilisateur ;
 *   3. une traduction garde exactement les `{marques}` de sa phrase ;
 *   4. une traduction est bien de l'arabe — pas une phrase oubliée en
 *      français ;
 *   5. les libellés venus du DOMAINE (modes de paiement, statuts) sont
 *      traduits, puisqu'ils ne passent par `t()` qu'à l'affichage.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { libelleModePaiement, libelleStatut, libelleTypeCommande } from '@kaissi/domain'
import { AR, traduire, traduireMessage } from './index.js'

const RACINE = join(import.meta.dirname, '..', '..', '..')
const APPLICATIONS = ['apps/pos/src', 'apps/backoffice/src']

/**
 * Les attributs JSX qu'un utilisateur LIT — les autres sont du code.
 *
 * Un MOTIF de nom plutôt qu'une liste fermée : `libelleValider="Encaisser"`
 * était passé entre les mailles d'une liste qui ne connaissait que `libelle`.
 */
const ATTRIBUTS_LUS = {
  has: (nom: string) =>
    /^(aria-label|placeholder|title|alt)$/.test(nom) ||
    /(libelle|titre|texte|label|aide|message|vide|detail|description|confirmation|intitule|entete)/i.test(nom),
}

/**
 * Ce qui ne se traduit pas : la marque, des codes, des unités techniques —
 * et le pied de TICKET par défaut. Le ticket s'imprime en français
 * (l'imprimante thermique encode en CP858, sans arabe) : son aperçu au
 * back-office doit montrer ce qui sortira réellement du rouleau.
 */
const INTRADUISIBLES = new Set(['Kaissi', 'TND', 'PIN', 'ESC/POS', 'SQLite', 'IndexedDB', 'CORS', 'Commit', 'Merci de votre visite !'])

function fichiers(dossier: string): string[] {
  const sortie: string[] = []
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) sortie.push(...fichiers(chemin))
    else if (/\.(ts|tsx)$/.test(nom) && !/\.(test|d)\.tsx?$/.test(nom)) sortie.push(chemin)
  }
  return sortie
}

interface Trouvaille {
  readonly cles: Map<string, string>
  readonly enDur: string[]
}

function analyser(): Trouvaille {
  const cles = new Map<string, string>()
  const enDur: string[] = []
  for (const app of APPLICATIONS) {
    for (const chemin of fichiers(join(RACINE, app))) {
      const texte = readFileSync(chemin, 'utf8')
      const tsx = chemin.endsWith('.tsx')
      const src = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const ou = (n: ts.Node) =>
        `${relative(RACINE, chemin)}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`
      const visiter = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          (n.expression.text === 't' || n.expression.text === 'aTraduire') &&
          n.arguments[0] &&
          (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))
        ) {
          const cle = n.arguments[0].text
          if (!cles.has(cle)) cles.set(cle, ou(n))
        }
        if (ts.isJsxText(n)) {
          const visible = n.text.replace(/\s+/g, ' ').trim()
          if (/\p{L}/u.test(visible) && !INTRADUISIBLES.has(visible)) enDur.push(`${ou(n)}  « ${visible.slice(0, 70)} »`)
        }
        // Un texte RENDU depuis une expression : `{cond ? 'Client' : nom}`,
        // `{x && ' — obligatoire'}`, ou une infobulle calculée. Ce sont les
        // mots isolés qui avaient échappé à la première passe.
        const rendu = (e: ts.Expression | undefined): void => {
          if (!e) return
          if (ts.isParenthesizedExpression(e)) return rendu(e.expression)
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
            const v = e.text.trim()
            if (/\p{L}{2}/u.test(v) && !INTRADUISIBLES.has(v)) enDur.push(`${ou(e)}  {'${v.slice(0, 60)}'}`)
            return
          }
          if (ts.isTemplateExpression(e)) {
            const brut = [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(' ')
            if (/\p{L}{2}/u.test(brut)) enDur.push(`${ou(e)}  \`${brut.trim().slice(0, 60)}\``)
            return
          }
          if (ts.isConditionalExpression(e)) {
            rendu(e.whenTrue)
            rendu(e.whenFalse)
            return
          }
          if (ts.isBinaryExpression(e)) {
            const op = e.operatorToken.kind
            if (op === ts.SyntaxKind.AmpersandAmpersandToken) rendu(e.right)
            if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
              rendu(e.left)
              rendu(e.right)
            }
          }
        }
        if (ts.isJsxExpression(n) && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
          rendu(n.expression)
        }
        if (ts.isJsxAttribute(n) && n.initializer && ts.isJsxExpression(n.initializer)) {
          if (ATTRIBUTS_LUS.has(n.name.getText(src))) rendu(n.initializer.expression)
        }
        if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer)) {
          const nom = n.name.getText(src)
          const valeur = n.initializer.text
          if (ATTRIBUTS_LUS.has(nom) && /\p{L}{2}/u.test(valeur) && !INTRADUISIBLES.has(valeur)) {
            enDur.push(`${ou(n)}  ${nom}="${valeur.slice(0, 60)}"`)
          }
        }
        ts.forEachChild(n, visiter)
      }
      visiter(src)
    }
  }
  return { cles, enDur }
}

const { cles, enDur } = analyser()
const marques = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('couverture de la traduction arabe', () => {
  it('trouve bien les phrases à traduire (contrôle non vide)', () => {
    // Un analyseur cassé qui ne trouve rien ferait passer tous les tests.
    expect(cles.size).toBeGreaterThan(400)
  })

  it('toute phrase passée à t() a sa traduction', () => {
    const manquantes = [...cles].filter(([cle]) => AR[cle] === undefined).map(([cle, ou]) => `${ou}  « ${cle.slice(0, 80)} »`)
    expect(manquantes).toEqual([])
  })

  it('aucun texte visible n’est resté écrit en dur dans le JSX', () => {
    expect(enDur).toEqual([])
  })

  it('une traduction garde exactement les {marques} de sa phrase', () => {
    const fautives = Object.entries(AR)
      .filter(([fr, ar]) => marques(fr).join() !== marques(ar).join())
      .map(([fr]) => fr)
    expect(fautives).toEqual([])
  })

  it('une traduction est bien de l’arabe', () => {
    const technique = /^[\w\s./:=@`…,-]*$/
    const oubliees = Object.entries(AR)
      .filter(([fr, ar]) => !/[؀-ۿ]/.test(ar) && !INTRADUISIBLES.has(fr) && !technique.test(fr))
      .map(([fr]) => fr)
    expect(oubliees).toEqual([])
  })

  it('les libellés du domaine sont traduits', () => {
    const modes = ['cash', 'card', 'online', 'other'].map((m) => `paiement|${libelleModePaiement(m)}`)
    const statuts = (['ouverte', 'envoyee', 'close', 'annulee'] as const).map(libelleStatut)
    const types = ['dine_in', 'takeaway', 'delivery'].map(libelleTypeCommande)
    const manquants = [...modes, ...statuts, ...types].filter((c) => AR[c] === undefined)
    expect(manquants).toEqual([])
  })
})

describe('le moteur de traduction', () => {
  it('le français est rendu tel quel, contexte retiré', () => {
    expect(traduire('fr', 'paiement|Carte')).toBe('Carte')
    expect(traduire('fr', 'Table {numero}', { numero: 4 })).toBe('Table 4')
  })

  it('le contexte sépare les homonymes', () => {
    expect(traduire('ar', 'Carte')).not.toBe(traduire('ar', 'paiement|Carte'))
  })

  it('une phrase inconnue reste en français plutôt que de disparaître', () => {
    expect(traduire('ar', 'Phrase jamais traduite')).toBe('Phrase jamais traduite')
  })

  it('un message assemblé ailleurs est reconnu par son modèle', () => {
    const modele = Object.keys(AR).find((k) => k === 'Table {numero}')
    expect(modele).toBeDefined()
    expect(traduireMessage('ar', 'Table 12')).toBe(traduire('ar', 'Table {numero}', { numero: '12' }))
  })

  it('en arabe, une valeur insérée est ISOLÉE — un numéro ne se retourne pas', () => {
    expect(traduire('ar', 'Table {numero}', { numero: 'P1-42' })).toContain('\u2068P1-42\u2069')
    // Le français n'en a pas besoin, et n'en reçoit pas.
    expect(traduire('fr', 'Table {numero}', { numero: 'P1-42' })).toBe('Table P1-42')
  })
})
