'use client'

/**
 * Service et droit de timbre — les deux réglages qui changent le TOTAL.
 *
 * ── Pourquoi un APERÇU, et pourquoi il est calculé par le domaine ─────────
 *
 * « 10 % de service, taxable, 600 millimes de timbre » ne dit rien tant qu'on
 * n'a pas vu ce que ça fait à une addition. L'aperçu montre une commande
 * d'exemple et son total, recalculé à chaque frappe.
 *
 * Il appelle `calculerTotaux` de `@kaissi/domain` — la fonction que la caisse
 * et le serveur appellent, pas une imitation. Un aperçu qui refarait le calcul
 * « à peu près » serait la TROISIÈME implémentation du total : il afficherait
 * un chiffre juste pendant six mois, puis un chiffre faux le jour où l'ordre
 * des étapes changerait, et c'est précisément ce chiffre-là que le gérant
 * aurait utilisé pour décider.
 */

import { useActionState, useMemo, useState } from 'react'
import {
  calculerTotaux,
  configEtablissement,
  formaterTND,
  millimes,
  pointsDeBase,
} from '@kaissi/domain'
import { Info, TriangleAlert } from 'lucide-react'
import {
  enregistrerOptions,
  type Resultat,
} from '../app/[restaurant]/restauration/actions.js'
import { lignesApercu } from './apercu-restauration.js'

export interface TauxDisponible {
  id: string
  nom: string
  tauxBp: number
  incluse: boolean
}

export interface ValeursRestauration {
  tauxServiceBp: number
  serviceTaxable: boolean
  serviceTauxTaxeId: string | null
  timbreMillimes: number
}

/** « 1000 » → « 10 », pour un champ de saisie. Jamais un flottant en base. */
function pourChampTaux(bp: number): string {
  if (bp === 0) return ''
  const entier = Math.floor(bp / 100)
  const reste = bp % 100
  return reste === 0 ? String(entier) : `${entier},${String(reste).padStart(2, '0')}`
}

/** 600 → « 0,600 ». Le dinar a TROIS décimales. */
function pourChampTimbre(m: number): string {
  if (m === 0) return ''
  return `${Math.floor(m / 1000)},${String(m % 1000).padStart(3, '0')}`
}

function lireTaux(saisi: string): number {
  const n = Number(saisi.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 100) return 0
  return Math.round(n * 100)
}

function lireTimbre(saisi: string): number {
  const n = Number(saisi.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 1000)
}

export function OptionsRestauration({
  restaurantId,
  modifiable,
  valeurs,
  taux,
}: {
  restaurantId: string
  modifiable: boolean
  valeurs: ValeursRestauration
  taux: TauxDisponible[]
}) {
  const [resultat, action] = useActionState(
    enregistrerOptions.bind(null, restaurantId),
    null as Resultat | null,
  )

  const [service, setService] = useState(pourChampTaux(valeurs.tauxServiceBp))
  const [taxable, setTaxable] = useState(valeurs.serviceTaxable)
  const [tauxService, setTauxService] = useState(valeurs.serviceTauxTaxeId ?? '')
  const [timbre, setTimbre] = useState(pourChampTimbre(valeurs.timbreMillimes))

  const tauxParDefaut = taux.find((t) => !t.incluse) ?? taux[0]

  /*
   * L'aperçu : une commande d'exemple, passée dans le VRAI calcul.
   *
   * Deux lignes plutôt qu'une, et à deux taux différents : c'est la forme qui
   * révèle l'étape 6 (arrondi de la TVA PAR TAUX, puis somme). Une seule
   * ligne donnerait un total juste même avec un calcul faux.
   */
  const apercu = useMemo(() => {
    if (!tauxParDefaut) return null
    const bp = lireTaux(service)
    const config = configEtablissement(taux, {
      tauxServiceBp: bp,
      serviceTaxable: taxable,
      serviceTauxTaxeId: taxable ? tauxService || null : null,
      timbreMillimes: lireTimbre(timbre),
    })
    const lignes = [
      {
        id: 'a',
        prixBaseMillimes: millimes(12_500),
        modificateursMillimes: millimes(0),
        quantite: 1,
        tauxTaxeId: tauxParDefaut.id,
      },
      {
        id: 'b',
        prixBaseMillimes: millimes(3_500),
        modificateursMillimes: millimes(0),
        quantite: 2,
        tauxTaxeId: (taux[1] ?? tauxParDefaut).id,
      },
    ]
    const avec = calculerTotaux({ lignes, config })
    const sans = calculerTotaux({ lignes, config: configEtablissement(taux) })
    /*
     * ── La taxe du service est-elle AJOUTÉE ou COMPRISE ? ─────────────────
     *
     * Elle dépend du taux choisi (étape 7 de `totaux.ts`) : un taux INCLUS est
     * EXTRAIT du service, il ne s'y ajoute pas. Les taux tunisiens du jeu de
     * démonstration sont inclus.
     *
     * ⚑ Vu à l'écran, pas dans un test : l'aperçu listait « Taxe sur le
     *   service » entre le service et le timbre, et la colonne NE TOMBAIT PAS
     *   sur le total — 19,500 + 1,950 + 0,311 + 0,600 fait 22,361, pas 22,050.
     *   Un gérant qui additionne quatre lignes et trouve autre chose que le
     *   total conclut que le logiciel compte faux, et il a raison de le
     *   croire. Les deux cas se disent donc différemment.
     */
    const tauxDuService = taxable ? taux.find((t) => t.id === tauxService) : undefined
    return {
      avec,
      sans,
      ecart: avec.totalMillimes - sans.totalMillimes,
      lignes: lignesApercu(avec, {
        taxeComprise: tauxDuService?.incluse ?? false,
        nomTaux: tauxDuService?.nom ?? null,
      }),
    }
  }, [service, taxable, tauxService, timbre, taux, tauxParDefaut])

  return (
    <div className="reglages-recu">
      <form action={action} className="carte formulaire-taux">
        <h2>Frais de service</h2>

        <label htmlFor="service">Taux de service (%)</label>
        <input
          id="service"
          name="service"
          value={service}
          onChange={(e) => setService(e.target.value)}
          placeholder="aucun"
          inputMode="decimal"
          maxLength={6}
          disabled={!modifiable}
        />
        <p className="indication">
          Appliqué à la base <strong>après remises</strong>, jamais au TTC.
          Vide ou zéro : aucun service, et aucune ligne sur le ticket.
        </p>

        <label className="case">
          <input
            type="checkbox"
            name="taxable"
            value="oui"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
            disabled={!modifiable}
          />
          <span>le service est lui-même soumis à la taxe</span>
        </label>

        {taxable && (
          <>
            <label htmlFor="tauxService">Taux applicable au service</label>
            <select
              id="tauxService"
              name="tauxService"
              value={tauxService}
              onChange={(e) => setTauxService(e.target.value)}
              disabled={!modifiable}
            >
              <option value="">— choisir un taux —</option>
              {taux.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom}
                </option>
              ))}
            </select>
            <p className="indication">
              {/*
                La phrase qui évite un réglage muet. Le domaine ne taxe le
                service que s'il connaît le taux : sans ce choix, la case
                serait cochée et le service sortirait tout de même hors taxe.
              */}
              Sans taux choisi, la case ci-dessus <strong>ne taxe rien</strong> —
              l’enregistrement sera refusé plutôt que de laisser un réglage qui
              n’a pas d’effet.
            </p>
          </>
        )}

        <h2 style={{ marginTop: '1.25rem' }}>Droit de timbre</h2>
        <label htmlFor="timbre">Montant fixe par ticket (TND)</label>
        <input
          id="timbre"
          name="timbre"
          value={timbre}
          onChange={(e) => setTimbre(e.target.value)}
          placeholder="aucun"
          inputMode="decimal"
          maxLength={10}
          disabled={!modifiable}
        />
        <p className="indication">
          Ajouté au total, <strong>après</strong> les taxes et le service. Le
          dinar a trois décimales : « 0,600 » vaut six cents millimes.
        </p>

        {modifiable && (
          <button type="submit" className="principal">
            Enregistrer
          </button>
        )}
        {resultat?.erreur && <p className="message erreur">{resultat.erreur}</p>}
        {resultat?.succes && <p className="message succes">{resultat.succes}</p>}
      </form>

      <div className="carte apercu-restauration">
        <h2>Sur une addition d’exemple</h2>
        {apercu === null ? (
          <p className="indication">
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" /> Aucun
            taux de taxe : l’aperçu ne peut rien calculer, et la caisse ne
            pourrait rien encaisser non plus.
          </p>
        ) : (
          <>
            <table className="tableau-apercu">
              <tbody>
                {/*
                  Les lignes viennent de `lignesApercu`, et leur somme est
                  vérifiée par `apercu-restauration.test.ts`. Les construire ici
                  en JSX, c'est ce qui avait produit une colonne qui ne tombait
                  pas sur son propre total — une taxe COMPRISE y était listée
                  comme un montant ajouté.
                */}
                {apercu.lignes.map((l) => (
                  <tr key={l.libelle} className={l.dont ? 'apercu-dont' : undefined}>
                    <td>{l.libelle}</td>
                    <td>{formaterTND(millimes(l.montantMillimes))}</td>
                  </tr>
                ))}
                <tr className="apercu-total">
                  <td>Total</td>
                  <td>{formaterTND(apercu.avec.totalMillimes)}</td>
                </tr>
              </tbody>
            </table>
            <p className="indication">
              {apercu.ecart === 0
                ? 'Identique à un ticket sans options : rien n’est ajouté.'
                : `Soit ${formaterTND(millimes(apercu.ecart))} de plus qu’un ticket sans options.`}
            </p>
          </>
        )}

        {/*
          ⚠ Le repère le plus important de l'écran. Ce dépôt n'affirme aucune
          règle fiscale tunisienne, et surtout pas depuis une valeur par
          défaut : un logiciel qui pose « 1 % de service, 600 millimes de
          timbre, parce que c'est l'usage » facture faux pendant des mois sans
          que personne ne le relise.
        */}
        <div className="message info" style={{ marginTop: '1rem', marginBottom: 0 }}>
          <Info size={16} strokeWidth={2} aria-hidden="true" />{' '}
          <strong>À valider avec votre comptable.</strong> Kaissi n’applique
          que ce que vous saisissez ici, et ne propose aucune valeur par
          défaut. Le droit de timbre s’applique-t-il à un ticket de restaurant,
          à quel montant, et les frais de service sont-ils soumis à la TVA ?
          Ce sont des questions réglementaires — un logiciel qui y répondrait à
          votre place vous ferait facturer faux sans que rien ne le signale.
        </div>
      </div>
    </div>
  )
}
