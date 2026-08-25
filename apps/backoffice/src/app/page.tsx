/**
 * Back-office — SQUELETTE de Phase 0.
 *
 * Le back-office réel (rapports, catalogue, employés, appairage des
 * appareils) est la Phase 1. Cette page existe pour que l'application
 * compile dans la CI et que la place soit tenue dans le monorepo.
 *
 * Elle affiche une vérification concrète : le calcul des totaux exécuté ICI,
 * côté serveur, avec le MÊME module que la tablette. Un écart entre les deux
 * serait un écart de caisse inexplicable en production.
 */

import {
  calculerTotaux,
  formaterTND,
  millimes,
  pointsDeBase,
  type ConfigCalcul,
} from '@kaissi/domain'

const TVA_19 = { id: 'tva-19', nom: 'TVA 19 %', tauxBp: pointsDeBase(1900), incluse: true }
const TVA_07 = { id: 'tva-07', nom: 'TVA 7 %', tauxBp: pointsDeBase(700), incluse: true }

const config: ConfigCalcul = { tauxTaxes: { [TVA_19.id]: TVA_19, [TVA_07.id]: TVA_07 } }

export default function Accueil() {
  const totaux = calculerTotaux({
    lignes: [
      {
        id: 'l1',
        prixBaseMillimes: millimes(14500),
        modificateursMillimes: millimes(0),
        quantite: 1,
        tauxTaxeId: TVA_19.id,
      },
      {
        id: 'l2',
        prixBaseMillimes: millimes(4200),
        modificateursMillimes: millimes(0),
        quantite: 2,
        tauxTaxeId: TVA_07.id,
      },
    ],
    config,
  })

  return (
    <main style={{ padding: '2rem', maxWidth: '48rem', margin: '0 auto', lineHeight: 1.6 }}>
      <h1 style={{ color: '#e0a33f', letterSpacing: '-0.02em' }}>Kaissi — Back-office</h1>
      <p style={{ color: '#9aa3a8' }}>
        Squelette de Phase&nbsp;0. Les rapports et l&apos;administration arrivent en
        Phase&nbsp;1.
      </p>

      <section
        style={{
          marginTop: '2rem',
          padding: '1rem',
          background: '#171b1f',
          border: '1px solid #2a3238',
          borderRadius: 10,
        }}
      >
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>
          Contrôle : mêmes totaux qu&apos;à la caisse
        </h2>
        <p style={{ fontSize: '0.85rem', color: '#9aa3a8' }}>
          Ce total est calculé ici, côté serveur, par <code>@kaissi/domain</code> —
          exactement le module qu&apos;exécute la tablette hors ligne.
        </p>
        <table style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }}>
          <tbody>
            <tr>
              <td>Sous-total</td>
              <td style={{ textAlign: 'right' }}>{formaterTND(totaux.sousTotalMillimes)}</td>
            </tr>
            {totaux.ventilationTaxes.map((v) => (
              <tr key={v.tauxTaxeId} style={{ color: '#9aa3a8', fontSize: '0.9rem' }}>
                <td>
                  {v.nom} {v.incluse ? '(incluse)' : ''}
                </td>
                <td style={{ textAlign: 'right' }}>{formaterTND(v.taxeMillimes)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800, fontSize: '1.1rem' }}>
              <td>Total</td>
              <td style={{ textAlign: 'right' }}>{formaterTND(totaux.totalMillimes)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  )
}
