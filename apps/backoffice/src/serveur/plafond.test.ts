/**
 * Le plafond des rapports, et le signal qui l'accompagne.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 *
 * MESURÉ, sur 200 commandes par jour : un rapport annuel rend 73 000
 * commandes, triées sur DISQUE par PostgreSQL, puis ~220 000 lignes en 365
 * requêtes. Dans une fonction serverless, c'est une erreur 500 sans
 * explication — sur l'écran des chiffres d'affaires.
 *
 * Le plafond évitait cela. La migration 0033 fait mieux : elle SUPPRIME le
 * besoin, en additionnant dans PostgreSQL. Le plafond ne concerne donc plus
 * que les deux écrans qui affichent une LISTE de tickets — là où une ligne
 * écrite est bien une ligne lue, et où l'agrégation n'a aucun sens.
 *
 * Le vrai risque, partout où le plafond subsiste, reste le même : **tronquer
 * en silence**. Un chiffre d'affaires amputé ressemble exactement à un
 * chiffre d'affaires complet. On l'exporte, on le porte à son comptable, et
 * rien ne le contredit.
 *
 * ⚑ L'invariant testé ci-dessous est donc devenu conditionnel, et c'est
 *   volontaire : « un écran qui charge des LIGNES doit afficher la bannière ;
 *   un écran qui n'en charge pas ne doit pas prétendre le faire ». Il reste
 *   juste au fur et à mesure que des écrans basculent — un test qui
 *   énumérerait la liste à la main serait à réécrire à chaque bascule, donc
 *   réécrit sans y penser.
 */

import { describe, expect, it } from 'vitest'
import { PLAFOND_COMMANDES } from './ventes.js'

describe('le plafond', () => {
  it('couvre une année normale sans jamais se déclencher', () => {
    /*
     * Un établissement ordinaire fait 40 à 60 ventes par jour, soit ~20 000
     * par an. Le plafond ne doit pas gêner celui-là : une limite qui se
     * déclenche pour tout le monde n'est pas un garde-fou, c'est une panne.
     *
     * Ce test a refusé le premier chiffre choisi (20 000) : 55 × 365 = 20 075.
     * C'est exactement son travail.
     */
    const ventesParAnNormal = 60 * 365
    expect(ventesParAnNormal).toBeLessThan(PLAFOND_COMMANDES)
  })

  it('protège avant la mesure qui plantait', () => {
    // 73 000 commandes : le chiffre relevé sur le banc, celui qui produit un
    // tri sur disque et un dépassement de délai.
    expect(PLAFOND_COMMANDES).toBeLessThan(73_000)
  })

  it('reste un nombre rond et explicable au client', () => {
    // « 20 000 ventes » se dit à un restaurateur. « 18 437 » demanderait
    // qu'on explique d'où il sort, et personne ne le ferait deux fois.
    expect(PLAFOND_COMMANDES % 1000).toBe(0)
  })
})

describe('ce que le drapeau `tronque` oblige à faire', () => {
  /*
   * Ces deux tests lisent le CODE plutôt que d'exécuter une requête : ils
   * vérifient qu'aucun écran de rapport n'oublie la bannière, et que l'export
   * refuse au lieu de livrer. C'est une vérification de discipline — le genre
   * qu'on ne fait plus à la main après le troisième écran ajouté.
   */
  const lire = (chemin: string) =>
    // eslint-disable-next-line
    require('node:fs').readFileSync(new URL(chemin, import.meta.url), 'utf8') as string

  const ECRANS = [
    '../app/[restaurant]/ventes/page.tsx',
    '../app/[restaurant]/articles/page.tsx',
    '../app/[restaurant]/ventes-par-categorie/page.tsx',
    '../app/[restaurant]/ventes-par-employe/page.tsx',
    '../app/[restaurant]/ventes-par-paiement/page.tsx',
    '../app/[restaurant]/reductions/page.tsx',
    '../app/[restaurant]/recus/page.tsx',
    '../app/[restaurant]/tableau-bord/page.tsx',
  ]

  /** Un écran charge la ligne à ligne s'il la demande explicitement. */
  const chargeDesLignes = (source: string) =>
    source.includes('{ lignes: true }') || source.includes('chargerVentes(')

  it('un écran qui charge des LIGNES affiche l’avertissement', () => {
    const concernes = ECRANS.filter((e) => chargeDesLignes(lire(e)))
    // Le jour où il n'y en a plus aucun, ce test passerait à vide et ne
    // protégerait plus rien sans le dire. On exige donc qu'il en reste au
    // moins un — la liste des reçus, qui est une liste par nature.
    expect(concernes.length).toBeGreaterThan(0)
    for (const ecran of concernes) {
      expect(lire(ecran), `${ecran} charge des lignes sans AvertissementTronque`).toContain(
        'AvertissementTronque',
      )
    }
  })

  it('un écran AGRÉGÉ n’affiche plus de bannière — il n’a plus rien à tronquer', () => {
    for (const ecran of ECRANS.filter((e) => !chargeDesLignes(lire(e)))) {
      const source = lire(ecran)
      expect(source, `${ecran} affiche une bannière sans charger de lignes`).not.toContain(
        'AvertissementTronque',
      )
      // Et il lit bien les agrégats : sans cela, « pas de bannière » voudrait
      // simplement dire « écran cassé qui affiche zéro ».
      expect(source, `${ecran} n’utilise pas les agrégats`).toContain('agregats')
    }
  })

  it('l’export REFUSE une période tronquée au lieu de livrer un fichier amputé', () => {
    // Un fichier quitte l'application : il n'a plus de bannière pour dire
    // qu'il est incomplet, et le total y aura l'air juste indéfiniment.
    const route = lire('../app/[restaurant]/export/[quoi]/route.ts')
    expect(route).toContain('ventes.tronque')
    expect(route).toContain('413')
  })
})
