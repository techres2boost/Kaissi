/**
 * Ce que ce test protège : un fichier qu'Excel ouvre CORRECTEMENT.
 *
 * Les trois pièges d'un CSV français ne se voient pas dans le code — ils se
 * voient au moment où un gérant double-clique sur le fichier et trouve tout
 * dans la première colonne, ou « CrÃ¨me brÃ»lÃ©e » à la place de son produit.
 */

import { describe, expect, it } from 'vitest'
import { nomFichier, versCsv } from './export-csv.js'

describe('versCsv', () => {
  it('sépare par POINT-VIRGULE, ce qu’attend Excel en français', () => {
    // Avec une virgule, tout le fichier atterrit dans la première colonne —
    // parce que la virgule est déjà le séparateur décimal.
    const csv = versCsv(['Produit', 'Prix'], [['Pizza', '24,500']])
    expect(csv).toContain('Produit;Prix')
    expect(csv).toContain('Pizza;24,500')
  })

  it('commence par un BOM, sinon Excel lit l’UTF-8 en Latin-1', () => {
    const csv = versCsv(['Produit'], [['Crème brûlée']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('Crème brûlée')
  })

  it('NEUTRALISE une cellule qui commence comme une formule', () => {
    // `=1+1` s'afficherait « 2 » ; certaines fonctions font pire.
    const csv = versCsv(['Nom'], [['=1+1'], ['+33 1 23'], ['-Remise'], ['@ici']])
    expect(csv).toContain("'=1+1")
    expect(csv).toContain("'+33 1 23")
    expect(csv).toContain("'-Remise")
    expect(csv).toContain("'@ici")
  })

  it('entoure et double les guillemets, et protège le séparateur', () => {
    // Un point-virgule dans un nom de produit décalerait toutes les colonnes
    // suivantes — la ligne resterait lisible, mais fausse.
    const csv = versCsv(['Nom'], [['Menu ; formule'], ['Le "grand" plat'], ['Deux\nlignes']])
    expect(csv).toContain('"Menu ; formule"')
    expect(csv).toContain('"Le ""grand"" plat"')
    expect(csv).toContain('"Deux\nlignes"')
  })

  it('rend une cellule vide pour null et undefined, pas « null »', () => {
    const csv = versCsv(['A', 'B', 'C'], [['x', null, undefined]])
    expect(csv).toContain('x;;')
    expect(csv).not.toContain('null')
  })

  it('sépare les lignes par CRLF', () => {
    expect(versCsv(['A'], [['1'], ['2']])).toBe('﻿A\r\n1\r\n2\r\n')
  })
})

describe('nomFichier', () => {
  it('porte le nom de l’établissement, pour distinguer trois exports', () => {
    expect(nomFichier('ventes', 'Snack Lac 1')).toBe('ventes-snack-lac-1.csv')
  })

  it('retire accents et caractères qui casseraient l’en-tête HTTP', () => {
    // Un « / » dans un nom d'établissement casserait content-disposition.
    expect(nomFichier('ventes', 'Café / Résto')).toBe('ventes-cafe-resto.csv')
  })

  it('accepte un suffixe, et ignore ce qui devient vide', () => {
    expect(nomFichier('ticket', 'Snack', 'P1-000002')).toBe('ticket-snack-p1-000002.csv')
    expect(nomFichier('ventes', '###')).toBe('ventes.csv')
  })
})
