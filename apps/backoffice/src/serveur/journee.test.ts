/**
 * La journée commerciale décide de quel jour relève chaque vente.
 *
 * Une erreur ici ne fait rien planter : elle attribue le chiffre d'affaires
 * d'une soirée au mauvais jour. Le gérant compare alors son rapport à sa
 * caisse et ne comprend pas l'écart.
 */

import { describe, expect, it } from 'vitest'
import {
  bornesJourneeCommerciale,
  ErreurJournee,
  journeeCourante,
  journeeDecalee,
  libelleJournee,
  minutesDeBascule,
} from './journee.js'

const TUNIS = 'Africa/Tunis'

describe('bornes de la journée commerciale', () => {
  it('commence à l’heure de bascule locale, pas à minuit UTC', () => {
    // Tunis est à UTC+1 : 04:00 local = 03:00 UTC.
    const { debut, fin } = bornesJourneeCommerciale('2026-08-29', TUNIS, '04:00')
    expect(debut.toISOString()).toBe('2026-08-29T03:00:00.000Z')
    expect(fin.toISOString()).toBe('2026-08-30T03:00:00.000Z')
  })

  it('la borne haute est EXCLUE — sinon une vente de la dernière seconde disparaît', () => {
    const { debut, fin } = bornesJourneeCommerciale('2026-08-29', TUNIS, '04:00')
    // 24 h pile : la fin d'un jour est le début du suivant, sans trou ni
    // recouvrement. Un « 23:59:59 » laisserait passer une milliseconde.
    expect(fin.getTime() - debut.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('une vente à 00h30 tombe dans la journée de la VEILLE', () => {
    const { debut, fin } = bornesJourneeCommerciale('2026-08-28', TUNIS, '04:00')
    const venteApresMinuit = new Date('2026-08-29T00:30:00+01:00')
    expect(venteApresMinuit >= debut && venteApresMinuit < fin).toBe(true)
  })

  it('une bascule à minuit redonne le jour calendaire', () => {
    const { debut } = bornesJourneeCommerciale('2026-08-29', TUNIS, '00:00')
    expect(debut.toISOString()).toBe('2026-08-28T23:00:00.000Z')
  })

  it('deux journées consécutives se touchent sans trou ni recouvrement', () => {
    const veille = bornesJourneeCommerciale('2026-08-28', TUNIS, '04:00')
    const jour = bornesJourneeCommerciale('2026-08-29', TUNIS, '04:00')
    expect(veille.fin.getTime()).toBe(jour.debut.getTime())
  })

  it('suit les changements d’heure là où il y en a', () => {
    // Tunis n'en a plus depuis 2008 ; Paris si. Avec une bascule à 04:00, la
    // journée qui CONTIENT le saut de 02:00 du 29 mars est celle du 28 : elle
    // ne dure que 23 heures. Et celle du 24 octobre en dure 25.
    const heures = (journee: string) => {
      const { debut, fin } = bornesJourneeCommerciale(journee, 'Europe/Paris', '04:00')
      return (fin.getTime() - debut.getTime()) / 3_600_000
    }
    expect(heures('2026-03-28')).toBe(23)
    expect(heures('2026-03-29')).toBe(24)
    expect(heures('2026-10-24')).toBe(25)
  })

  it('la bascule reste à 04:00 HEURE LOCALE des deux côtés d’un saut', () => {
    // C'est la propriété qui compte : le gérant ouvre toujours sa journée à
    // la même heure de sa montre, changement d'heure ou pas.
    const heureLocale = (instant: Date) =>
      new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        minute: '2-digit',
      }).format(instant)

    for (const journee of ['2026-03-28', '2026-03-29', '2026-10-24', '2026-10-25']) {
      const { debut, fin } = bornesJourneeCommerciale(journee, 'Europe/Paris', '04:00')
      expect(heureLocale(debut)).toBe('04:00')
      expect(heureLocale(fin)).toBe('04:00')
    }
  })

  it('refuse une date ou une heure illisible plutôt que d’inventer', () => {
    expect(() => bornesJourneeCommerciale('29/08/2026', TUNIS, '04:00')).toThrow(ErreurJournee)
    expect(() => bornesJourneeCommerciale('2026-08-29', TUNIS, '25:00')).toThrow(ErreurJournee)
    expect(() => minutesDeBascule('4h')).toThrow(ErreurJournee)
  })

  it('accepte les deux écritures que Postgres rend pour un « time »', () => {
    expect(minutesDeBascule('04:00')).toBe(240)
    expect(minutesDeBascule('04:00:00')).toBe(240)
  })
})

describe('journée courante', () => {
  it('à 2 h du matin, on est encore « hier »', () => {
    const nuit = new Date('2026-08-29T02:00:00+01:00')
    expect(journeeCourante(TUNIS, '04:00', nuit)).toBe('2026-08-28')
  })

  it('à 5 h du matin, la nouvelle journée a commencé', () => {
    const aube = new Date('2026-08-29T05:00:00+01:00')
    expect(journeeCourante(TUNIS, '04:00', aube)).toBe('2026-08-29')
  })

  it('est cohérente avec les bornes qu’elle désigne', () => {
    for (const heure of ['00:30', '03:59', '04:01', '13:00', '23:45']) {
      const instant = new Date(`2026-08-29T${heure}:00+01:00`)
      const journee = journeeCourante(TUNIS, '04:00', instant)
      const { debut, fin } = bornesJourneeCommerciale(journee, TUNIS, '04:00')
      expect(instant >= debut && instant < fin).toBe(true)
    }
  })
})

describe('navigation et libellés', () => {
  it('recule et avance d’un jour, y compris en changeant de mois', () => {
    expect(journeeDecalee('2026-08-29', -1)).toBe('2026-08-28')
    expect(journeeDecalee('2026-09-01', -1)).toBe('2026-08-31')
    expect(journeeDecalee('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('écrit la date en français', () => {
    expect(libelleJournee('2026-08-29')).toBe('samedi 29 août 2026')
  })
})
