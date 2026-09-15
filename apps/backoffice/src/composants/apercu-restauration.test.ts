/**
 * L'aperçu des options de restauration TOMBE-T-IL sur le total ?
 *
 * ── Le défaut que ce fichier fige ─────────────────────────────────────────
 *
 * L'aperçu listait « Taxe sur le service » comme un montant ajouté. Avec un
 * taux INCLUS — et les taux tunisiens du jeu de démonstration le sont —, cette
 * taxe est EXTRAITE du service : elle est déjà dedans. La colonne affichait
 * donc 19,500 + 1,950 + 0,311 + 0,600 = 22,361 sous un total de 22,050.
 *
 * Rien ne l'attrapait. Les chiffres étaient justes un par un, bien alignés,
 * dans le bon ordre ; les tests de largeur passaient ; la capture d'écran
 * paraissait correcte. Seule leur SOMME était fausse — et c'est précisément
 * ce qu'un gérant vérifie avant de faire confiance à un logiciel de caisse.
 *
 * On ne vérifie donc pas la mise en forme : on vérifie l'INVARIANT. Les
 * montants viennent de `calculerTotaux`, la vraie fonction, pour les quatre
 * combinaisons qui existent.
 */

import { describe, expect, it } from 'vitest'
import { calculerTotaux, configEtablissement, millimes } from '@kaissi/domain'
import { lignesApercu, sommeApercu } from './apercu-restauration.js'

const INCLUS = { id: 'i1', nom: 'TVA 19 %', tauxBp: 1900, incluse: true }
const INCLUS_7 = { id: 'i2', nom: 'TVA 7 %', tauxBp: 700, incluse: true }
const EXCLUSIF = { id: 'e1', nom: 'TVA 19 % HT', tauxBp: 1900, incluse: false }

/** Deux lignes, deux taux : la forme qui révèle l'arrondi PAR TAUX (étape 6). */
const lignes = (tauxA: string, tauxB: string) => [
  {
    id: 'a',
    prixBaseMillimes: millimes(12_500),
    modificateursMillimes: millimes(0),
    quantite: 1,
    tauxTaxeId: tauxA,
  },
  {
    id: 'b',
    prixBaseMillimes: millimes(3_500),
    modificateursMillimes: millimes(0),
    quantite: 2,
    tauxTaxeId: tauxB,
  },
]

describe('l’aperçu des options de restauration', () => {
  const cas = [
    {
      nom: 'sans aucune option',
      taux: [INCLUS, INCLUS_7],
      options: {},
      tauxService: null,
    },
    {
      nom: 'service non taxable + timbre',
      taux: [INCLUS, INCLUS_7],
      options: { tauxServiceBp: 1000, timbreMillimes: 600 },
      tauxService: null,
    },
    {
      nom: 'service taxable à un taux INCLUS — la taxe est dans le service',
      taux: [INCLUS, INCLUS_7],
      options: {
        tauxServiceBp: 1000,
        serviceTaxable: true,
        serviceTauxTaxeId: INCLUS.id,
        timbreMillimes: 600,
      },
      tauxService: INCLUS,
    },
    {
      nom: 'service taxable à un taux EXCLUSIF — la taxe s’ajoute',
      taux: [EXCLUSIF, INCLUS_7],
      options: {
        tauxServiceBp: 1000,
        serviceTaxable: true,
        serviceTauxTaxeId: EXCLUSIF.id,
        timbreMillimes: 600,
      },
      tauxService: EXCLUSIF,
    },
    {
      nom: 'articles à taux EXCLUSIF, sans service — la taxe des lignes compte',
      taux: [EXCLUSIF, INCLUS_7],
      options: {},
      tauxService: null,
      premierTaux: EXCLUSIF.id,
    },
  ]

  for (const c of cas) {
    it(`tombe sur le total : ${c.nom}`, () => {
      const config = configEtablissement(c.taux, c.options)
      const totaux = calculerTotaux({
        lignes: lignes(c.premierTaux ?? c.taux[0]!.id, c.taux[1]!.id),
        config,
      })

      const rendu = lignesApercu(totaux, {
        taxeComprise: c.tauxService?.incluse ?? false,
        nomTaux: c.tauxService?.nom ?? null,
      })

      expect(
        sommeApercu(rendu),
        `les lignes affichées (${rendu
          .map((l) => `${l.libelle} ${l.montantMillimes}${l.dont ? ' [dont]' : ''}`)
          .join(' · ')}) doivent faire le total ${totaux.totalMillimes}`,
      ).toBe(totaux.totalMillimes)
    })
  }

  it('marque « dont » UNIQUEMENT une taxe comprise', () => {
    const config = configEtablissement([INCLUS, INCLUS_7], {
      tauxServiceBp: 1000,
      serviceTaxable: true,
      serviceTauxTaxeId: INCLUS.id,
    })
    const totaux = calculerTotaux({ lignes: lignes(INCLUS.id, INCLUS_7.id), config })
    const rendu = lignesApercu(totaux, { taxeComprise: true, nomTaux: INCLUS.nom })

    const dont = rendu.filter((l) => l.dont)
    expect(dont).toHaveLength(1)
    expect(dont[0]!.libelle).toContain('dont')
    // Et elle porte bien un montant : une ligne « dont » à zéro ne serait
    // affichée nulle part, et ce test ne prouverait rien.
    expect(dont[0]!.montantMillimes).toBeGreaterThan(0)
  })

  it('n’affiche NI service NI timbre quand il n’y en a pas', () => {
    const config = configEtablissement([INCLUS, INCLUS_7])
    const totaux = calculerTotaux({ lignes: lignes(INCLUS.id, INCLUS_7.id), config })
    const rendu = lignesApercu(totaux, { taxeComprise: false, nomTaux: null })

    expect(rendu.map((l) => l.libelle)).toEqual(['Articles'])
  })
})
