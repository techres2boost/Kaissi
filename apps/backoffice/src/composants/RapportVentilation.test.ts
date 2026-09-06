/**
 * Ce que ce test protège : la FRONTIÈRE serveur → client.
 *
 * Le tableau des rapports est un composant client (pagination, tri, choix des
 * colonnes). Les pages, elles, sont des composants serveur. Tout ce qui
 * traverse cette frontière doit être SÉRIALISABLE — React envoie les
 * propriétés au navigateur sous forme de données, et une fonction ne
 * s'envoie pas.
 *
 * La première version passait des clôtures (`rendu: (ligne) => …`). Elle
 * compilait, `next build` passait, et SIX écrans tombaient en production avec
 * « Application error: a server-side exception has occurred ». Ni TypeScript
 * ni le build ne voient cette faute : elle n'existe qu'au rendu.
 *
 * D'où ce test, qui vérifie ce que ni l'un ni l'autre ne vérifie : ce qu'on
 * remet au tableau reste du texte et des nombres.
 */

import { describe, expect, it } from 'vitest'
import { millimes } from '@kaissi/domain'
import {
  celluleMontant,
  cellulePourcent,
  colonnesVentilation,
  lignesVentilation,
} from './RapportVentilation.js'
import type { Ventilation } from '../serveur/rapports.js'

const ventilation = (p: Partial<Ventilation> = {}): Ventilation => ({
  cle: 'p1',
  libelle: 'Ojja merguez',
  quantite: 42,
  marge: {
    caMillimes: millimes(83_500),
    coutMillimes: millimes(52_300),
    margeMillimes: millimes(31_200),
    margeBp: 3_740,
  },
  part: 2_840,
  brutMillimes: millimes(90_000),
  remisesMillimes: millimes(6_500),
  taxesMillimes: millimes(13_300),
  ...p,
})

/**
 * Cherche une FONCTION, à n'importe quelle profondeur.
 *
 * Et non un aller-retour `JSON.stringify` : celui-ci laisse tomber les
 * fonctions EN SILENCE, si bien qu'un objet fautif en ressortirait identique
 * à lui-même. Le contrôle passerait, et la page tomberait quand même — le
 * pire des tests, celui qui rassure à tort.
 */
function cheminVersUneFonction(valeur: unknown, chemin = ''): string | null {
  if (typeof valeur === 'function') return chemin || '(racine)'
  if (Array.isArray(valeur)) {
    for (const [i, v] of valeur.entries()) {
      const trouve = cheminVersUneFonction(v, `${chemin}[${i}]`)
      if (trouve) return trouve
    }
    return null
  }
  if (valeur && typeof valeur === 'object') {
    for (const [k, v] of Object.entries(valeur)) {
      const trouve = cheminVersUneFonction(v, chemin ? `${chemin}.${k}` : k)
      if (trouve) return trouve
    }
  }
  return null
}

describe('ce qui traverse la frontière serveur → client', () => {
  it('les colonnes ne contiennent AUCUNE fonction', () => {
    const colonnes = colonnesVentilation('Article', [
      { cle: 'categorie', titre: 'Catégorie', secondaire: true },
    ])
    expect(cheminVersUneFonction(colonnes)).toBeNull()
  })

  it('les lignes ne contiennent AUCUNE fonction', () => {
    const lignes = lignesVentilation([ventilation()], (l) => ({
      categorie: { texte: l.libelle === 'Ojja merguez' ? 'Plats' : '—' },
    }))
    expect(cheminVersUneFonction(lignes)).toBeNull()
  })

  it('chaque colonne a sa cellule, et réciproquement', () => {
    // Une colonne sans cellule afficherait un tiret sans qu'on sache si la
    // donnée manque ou si la clé est mal écrite ; une cellule sans colonne
    // serait du travail fait pour rien.
    const colonnes = colonnesVentilation('Article')
    const [ligne] = lignesVentilation([ventilation()])
    expect(Object.keys(ligne!.cellules).sort()).toEqual(colonnes.map((c) => c.cle).sort())
  })
})

describe('le détecteur lui-même', () => {
  it('trouve une fonction cachée au fond d’un objet', () => {
    // Sans ce cas, le test précédent pourrait passer sur un détecteur cassé
    // — et c'est exactement l'erreur qui a coûté six écrans.
    expect(cheminVersUneFonction([{ cellules: { a: { texte: () => 'x' } } }])).toBe(
      '[0].cellules.a.texte',
    )
    expect(cheminVersUneFonction([{ cellules: { a: { texte: 'x' } } }])).toBeNull()
  })
})

describe('les cellules chiffrées', () => {
  it('affichent le montant et gardent le NOMBRE pour trier', () => {
    const cellule = celluleMontant(83_500)
    expect(cellule.texte).toContain('83,500')
    // Sans cette valeur, le tri se ferait sur le texte : « 9,000 TND »
    // passerait devant « 83,500 TND », parce que « 9 » vient après « 8 ».
    expect(cellule.valeur).toBe(83_500)
  })

  it('arrondissent AVANT de construire un montant', () => {
    // `millimes()` refuse un non-entier : une moyenne non arrondie ferait
    // tomber la page entière, pas seulement la cellule.
    expect(() => celluleMontant(1234.567)).not.toThrow()
    expect(celluleMontant(1234.567).texte).toContain('1,235')
  })

  it('distinguent « coût non saisi » de « marge nulle »', () => {
    // Afficher 0 % ferait passer le premier pour le second, et le total
    // paraîtrait juste.
    expect(cellulePourcent(null).texte).toBe('—')
    expect(cellulePourcent(null).aide).toContain('non saisi')
    // « 0 » et non « 0,00 » : `formaterPourcentage` coupe les décimales
    // nulles — un taux rond se lit rond.
    expect(cellulePourcent(0).texte).toBe('0 %')
  })
})
