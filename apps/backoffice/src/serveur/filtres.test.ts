import { describe, expect, it } from 'vitest'
import { FILTRES_PAR_DEFAUT, filtresNeutres, resoudreFiltres, versParametres } from './filtres.js'

const UN_UUID = '01930000-0000-7000-8000-000000000701'

describe('filtres de rapport', () => {
  it('sans paramètre : toute la journée, tous les employés', () => {
    expect(resoudreFiltres({})).toEqual(FILTRES_PAR_DEFAUT)
    expect(filtresNeutres(resoudreFiltres({}))).toBe(true)
  })

  it('lit une tranche horaire', () => {
    expect(resoudreFiltres({ h: '12-15' })).toMatchObject({ heureDebut: 12, heureFin: 15 })
  })

  it('ignore une tranche absurde plutôt que de tomber', () => {
    // Une URL se tape à la main et se tronque en la copiant : une valeur
    // fausse doit rendre le rapport complet, jamais une page d'erreur.
    for (const h of ['15-12', '25-30', 'midi', '-3', '']) {
      expect(resoudreFiltres({ h })).toMatchObject({ heureDebut: 0, heureFin: 23 })
    }
  })

  it('n’accepte un employé que sous forme d’UUID', () => {
    expect(resoudreFiltres({ employe: UN_UUID }).employeId).toBe(UN_UUID)
    // Une valeur libre partirait dans une requête : on la refuse ici, où
    // c'est explicite, plutôt que de compter sur le filtrage d'à côté.
    expect(resoudreFiltres({ employe: "'; drop table" }).employeId).toBeNull()
  })

  it('omet les valeurs neutres dans l’URL', () => {
    expect(versParametres(FILTRES_PAR_DEFAUT)).toEqual({})
    expect(versParametres({ heureDebut: 12, heureFin: 15, employeId: UN_UUID })).toEqual({
      h: '12-15',
      employe: UN_UUID,
    })
  })

  it('fait l’aller-retour sans perte', () => {
    const filtres = { heureDebut: 8, heureFin: 11, employeId: UN_UUID }
    expect(resoudreFiltres(versParametres(filtres))).toEqual(filtres)
  })
})
