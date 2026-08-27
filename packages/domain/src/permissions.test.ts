import { describe, expect, it } from 'vitest'
import {
  autoriser,
  autoriserRemise,
  exigeUnMotif,
  peut,
  permissionsDe,
  remiseMaxBp,
  type Employe,
} from './permissions.js'

const employe = (role: Employe['role'], surcharges?: Employe['surcharges']): Employe => ({
  id: `emp-${role}`,
  nom: role,
  role,
  surcharges,
})

describe('permissions par rôle', () => {
  it('un caissier encaisse mais ne modifie pas le catalogue', () => {
    const c = employe('caissier')
    expect(peut(c, 'paiement.encaisser')).toBe(true)
    expect(peut(c, 'catalogue.modifier')).toBe(false)
    expect(peut(c, 'rapport.voir_marges')).toBe(false)
  })

  it('un serveur prend des commandes mais n encaisse pas', () => {
    const s = employe('serveur')
    expect(peut(s, 'commande.ajouter_ligne')).toBe(true)
    expect(peut(s, 'paiement.encaisser')).toBe(false)
    expect(peut(s, 'shift.cloturer')).toBe(false)
  })

  it('un caissier ne peut pas annuler une vente encaissée', () => {
    expect(peut(employe('caissier'), 'commande.annuler')).toBe(false)
    expect(peut(employe('gerant'), 'commande.annuler')).toBe(true)
  })

  it('la cuisine ne touche ni à l argent ni au catalogue', () => {
    const c = employe('cuisine')
    expect(permissionsDe(c).size).toBe(1)
    expect(peut(c, 'paiement.encaisser')).toBe(false)
  })
})

describe('surcharges par établissement', () => {
  it('accorde une permission supplémentaire à un caissier de confiance', () => {
    const c = employe('caissier', { accordees: ['commande.annuler'] })
    expect(peut(c, 'commande.annuler')).toBe(true)
  })

  it('retire une permission — la surcharge prime sur le rôle', () => {
    const c = employe('caissier', { retirees: ['paiement.encaisser'] })
    expect(peut(c, 'paiement.encaisser')).toBe(false)
  })
})

describe('escalade — interdit ≠ interdit à tout le monde', () => {
  it('distingue « un manager peut le faire » de « personne ne peut »', () => {
    const refus = autoriser(employe('caissier'), 'commande.annuler')
    expect(refus.accorde).toBe(false)
    if (!refus.accorde) expect(refus.escaladePossible).toBe(true)
  })

  it('un gérant n a jamais besoin d escalader', () => {
    expect(autoriser(employe('gerant'), 'commande.annuler').accorde).toBe(true)
  })
})

describe('plafond de remise', () => {
  it('applique un plafond différent selon le rôle', () => {
    expect(remiseMaxBp(employe('serveur'))).toBe(500)
    expect(remiseMaxBp(employe('caissier'))).toBe(1000)
    expect(remiseMaxBp(employe('gerant'))).toBe(10000)
  })

  it('laisse passer une remise sous le plafond', () => {
    expect(autoriserRemise(employe('caissier'), 500).accorde).toBe(true)
  })

  it('EXIGE une escalade au-delà du plafond, avec un motif chiffré', () => {
    const refus = autoriserRemise(employe('serveur'), 2000)
    expect(refus.accorde).toBe(false)
    if (!refus.accorde) {
      expect(refus.escaladePossible).toBe(true)
      // Le motif est lu par le manager qui autorise : il doit nommer les DEUX
      // taux, en français — donc virgule décimale et pas de zéros inutiles.
      expect(refus.motif).toContain('Remise de 20 %')
      expect(refus.motif).toContain('plafond de 5 %')
      // Un point ENTRE DEUX CHIFFRES seulement : la phrase se termine bien
      // par un point, ce n'est pas un séparateur décimal.
      expect(refus.motif).not.toMatch(/\d\.\d/)
    }
  })

  it('honore une surcharge de plafond', () => {
    const c = employe('caissier', { remiseMaxBp: 3000 })
    expect(autoriserRemise(c, 2500).accorde).toBe(true)
    expect(autoriserRemise(c, 3500).accorde).toBe(false)
  })

  it('un rôle sans droit de remise ne peut rien accorder, même 0 %', () => {
    expect(autoriserRemise(employe('cuisine'), 0).accorde).toBe(false)
  })
})

describe('motif obligatoire', () => {
  it('exige une justification sur les opérations sensibles', () => {
    expect(exigeUnMotif('commande.annuler')).toBe(true)
    expect(exigeUnMotif('paiement.rembourser')).toBe(true)
    expect(exigeUnMotif('tiroir.ouvrir_hors_vente')).toBe(true)
    expect(exigeUnMotif('commande.ajouter_ligne')).toBe(false)
  })
})
