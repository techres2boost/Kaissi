/**
 * Les formules d'abonnement — et la frontière qu'elles ne franchissent pas.
 *
 * Ce fichier existe surtout pour figer DEUX décisions qu'un futur passage
 * pourrait défaire sans s'en rendre compte :
 *
 *   1. un essai expiré RETOMBE au gratuit, il ne coupe rien ;
 *   2. une formule inconnue vaut `gratuit`, jamais `pro`.
 *
 * Et une troisième, qui n'est pas testable ici mais qui se lit dans l'absence
 * même de ce fichier : aucun module de CAISSE n'apparaît nulle part. Un
 * abonnement ne ferme que des écrans de gestion.
 */

import { describe, expect, it } from 'vitest'
import {
  debutHistorique,
  etatAbonnement,
  finEssaiDepuis,
  moduleOuvert,
  FORMULES,
  JOURS_ESSAI,
  MODULES,
} from './abonnement.js'

const LE_15 = new Date('2026-03-15T12:00:00.000Z')

describe('l’état d’un abonnement', () => {
  it('un essai en cours ouvre TOUT — c’est ce qu’on essaie', () => {
    const etat = etatAbonnement(
      { plan: 'essai', finEssai: '2026-03-25T12:00:00.000Z' },
      LE_15,
    )
    expect(etat.enEssai).toBe(true)
    expect(etat.essaiExpire).toBe(false)
    expect(etat.joursRestants).toBe(10)
    expect(etat.modules).toEqual(MODULES)
    expect(etat.joursHistorique).toBeNull()
  })

  it('compte les jours restants au SUPÉRIEUR', () => {
    /*
     * À onze heures de la fin il reste « 1 jour », pas zéro : annoncer zéro à
     * quelqu'un qui peut encore travailler aujourd'hui le ferait renoncer une
     * journée trop tôt.
     */
    const etat = etatAbonnement(
      { plan: 'essai', finEssai: '2026-03-15T23:00:00.000Z' },
      LE_15,
    )
    expect(etat.joursRestants).toBe(1)
    expect(etat.enEssai).toBe(true)
  })

  it('un essai EXPIRÉ retombe au gratuit — il ne coupe pas', () => {
    const etat = etatAbonnement(
      { plan: 'essai', finEssai: '2026-03-01T12:00:00.000Z' },
      LE_15,
    )
    expect(etat.essaiExpire).toBe(true)
    expect(etat.enEssai).toBe(false)
    expect(etat.joursRestants).toBe(0)

    // Les droits sont ceux du gratuit, pas « rien ».
    expect(etat.modules).toEqual([])
    expect(etat.joursHistorique).toBe(FORMULES.gratuit.joursHistorique)

    // Et le plan RESTE « essai » : c'est ce que dit la base, et l'écran doit
    // pouvoir proposer « votre essai est terminé » plutôt que « vous êtes au
    // gratuit », qui laisserait croire à un choix qu'on n'a pas fait.
    expect(etat.plan).toBe('essai')
  })

  it('une formule INCONNUE vaut gratuit, jamais pro', () => {
    /*
     * Une migration à moitié appliquée, une formule retirée : ouvrir tous les
     * modules dans le doute, ce serait offrir le payant à qui ne l'a pas.
     */
    for (const brut of [null, { plan: null, finEssai: null }, { plan: 'platine', finEssai: null }]) {
      const etat = etatAbonnement(brut, LE_15)
      expect(etat.plan, `formule « ${String(brut?.plan)} »`).toBe('gratuit')
      expect(etat.modules).toEqual([])
    }
  })

  it('une date de fin ILLISIBLE ne fait pas expirer l’essai par accident', () => {
    // `new Date('n’importe quoi')` rend `Invalid Date`, dont les comparaisons
    // sont toutes fausses. Sans le contrôle, l'essai paraîtrait valide à
    // l'infini OU expiré sur-le-champ, selon le sens de la comparaison.
    const etat = etatAbonnement({ plan: 'essai', finEssai: 'pas une date' }, LE_15)
    expect(etat.essaiExpire).toBe(false)
    expect(etat.joursRestants).toBeNull()
  })

  it('le PRO n’a ni limite d’historique ni module fermé', () => {
    const etat = etatAbonnement({ plan: 'pro', finEssai: null }, LE_15)
    expect(etat.joursHistorique).toBeNull()
    for (const m of MODULES) expect(moduleOuvert(etat, m)).toBe(true)
  })

  it('le GRATUIT ferme les modules et borne l’historique', () => {
    const etat = etatAbonnement({ plan: 'gratuit', finEssai: null }, LE_15)
    for (const m of MODULES) expect(moduleOuvert(etat, m)).toBe(false)

    const debut = debutHistorique(etat, LE_15)
    expect(debut).not.toBeNull()
    // 62 jours avant le 15 mars 2026 : le 12 janvier.
    expect(debut?.toISOString().slice(0, 10)).toBe('2026-01-12')
  })

  it('l’historique du PRO n’a pas de début', () => {
    expect(debutHistorique(etatAbonnement({ plan: 'pro', finEssai: null }, LE_15), LE_15)).toBeNull()
  })

  it('un essai ouvert aujourd’hui dure QUATORZE jours', () => {
    const fin = finEssaiDepuis(LE_15)
    const etat = etatAbonnement({ plan: 'essai', finEssai: fin }, LE_15)
    expect(etat.joursRestants).toBe(JOURS_ESSAI)
    expect(etat.enEssai).toBe(true)
  })

  /*
   * Un essai PROLONGÉ — le geste commercial de `pnpm sync:abonnement
   * --jours 30`. Le test tient à ce que la durée traverse : une valeur
   * ignorée en silence rendrait un essai de quatorze jours à quelqu'un à qui
   * on vient d'en promettre trente, et personne ne le verrait avant le
   * quinzième jour.
   */
  it('un essai PROLONGÉ dure ce qu’on lui demande', () => {
    const fin = finEssaiDepuis(LE_15, 30)
    expect(etatAbonnement({ plan: 'essai', finEssai: fin }, LE_15).joursRestants).toBe(30)
  })
})

describe('la frontière : un abonnement ne ferme aucun geste de caisse', () => {
  it('ne connaît AUCUN module de caisse', () => {
    /*
     * ⚠ Ce test est une garde de CONCEPTION, pas d'arithmétique.
     *
     * Le jour où quelqu'un ajoutera « encaissement », « hors_ligne » ou
     * « impression » à la liste des modules payants, il échouera — et c'est
     * exactement le moment où il faut s'arrêter. Une caisse qui refuse
     * d'encaisser parce qu'un essai a expiré s'arrête un vendredi soir, en
     * plein service, devant des clients qui attendent.
     *
     * Le POS est par ailleurs EMPAQUETÉ : il n'a pas de mode « connecté » dont
     * on pourrait le priver. « Désactiver l'offline » voudrait dire écrire du
     * code qui l'empêche de fonctionner sans réseau.
     */
    const interdits = ['encaissement', 'hors_ligne', 'offline', 'caisse', 'impression', 'vente']
    for (const module of MODULES) {
      for (const mot of interdits) {
        expect(
          module.includes(mot),
          `« ${module} » ressemble à un verrou de CAISSE. Un abonnement ne ` +
            'ferme que des écrans de gestion — voir la note en tête de ' +
            'packages/domain/src/abonnement.ts.',
        ).toBe(false)
      }
    }
  })

  it('même expiré, ne rend jamais une liste de modules « négative »', () => {
    // Autrement dit : il n'existe pas d'état où l'on RETIRE quelque chose de
    // plus que ce que le gratuit offre déjà. Le pire cas est le gratuit.
    const expire = etatAbonnement({ plan: 'essai', finEssai: '2020-01-01' }, LE_15)
    const gratuit = etatAbonnement({ plan: 'gratuit', finEssai: null }, LE_15)
    expect(expire.modules).toEqual(gratuit.modules)
    expect(expire.joursHistorique).toBe(gratuit.joursHistorique)
  })
})
