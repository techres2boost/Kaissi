/**
 * Écran de caisse — Phase 0.
 *
 * Le menu vient EXCLUSIVEMENT de SQLite local. Les totaux viennent
 * EXCLUSIVEMENT de `@kaissi/domain`, le même module que celui qu'utilisera
 * le serveur à la réconciliation : un prix se calcule exactement pareil des
 * deux côtés, c'est la décision la plus importante de l'architecture.
 *
 * Périmètre volontairement limité : cet écran démontre le chemin
 * « catalogue local → événements → état → totaux ». La prise de commande
 * complète (tables, envoi cuisine, encaissement) est la Phase 1.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  calculerTotaux,
  formaterTND,
  millimes,
  pointsDeBase,
  reduireEvenements,
  uuidV7,
  type ConfigCalcul,
  type EvenementCommande,
  type LigneCalculable,
  type Millimes,
  type TauxTaxe,
} from '@kaissi/domain'
import type {
  CategorieLocale,
  ProduitLocal,
  TauxTaxeLocal,
} from '@kaissi/db-local'
import type { ContexteApplication } from '../donnees/demarrage.js'

interface Props {
  contexte: ContexteApplication
}

export function EcranCaisse({ contexte }: Props) {
  const [categories, setCategories] = useState<CategorieLocale[]>([])
  const [produits, setProduits] = useState<ProduitLocal[]>([])
  const [taxes, setTaxes] = useState<TauxTaxeLocal[]>([])
  const [categorieActive, setCategorieActive] = useState<string | null>(null)
  const [journal, setJournal] = useState<EvenementCommande[]>([])
  const [remisePourcent, setRemisePourcent] = useState(0)
  const [identite, setIdentite] = useState({ orgId: '', restoId: '', deviceId: '' })

  // ── Chargement du catalogue : une seule lecture SQLite, aucun réseau ─────
  useEffect(() => {
    let vivant = true
    void (async () => {
      const [c, p, t, org, resto, device] = await Promise.all([
        contexte.catalogue.categories(),
        contexte.catalogue.produits(),
        contexte.catalogue.tauxTaxes(),
        contexte.etat.lire('organization_id'),
        contexte.etat.lire('restaurant_id'),
        contexte.etat.lire('device_id'),
      ])
      if (!vivant) return
      setCategories(c)
      setProduits(p)
      setTaxes(t)
      setCategorieActive(c[0]?.id ?? null)
      setIdentite({ orgId: org ?? '', restoId: resto ?? '', deviceId: device ?? '' })
    })()
    return () => {
      vivant = false
    }
  }, [contexte])

  // ── Configuration de calcul, dérivée du catalogue local ──────────────────
  const config: ConfigCalcul = useMemo(() => {
    const table: Record<string, TauxTaxe> = {}
    for (const t of taxes) {
      table[t.id] = {
        id: t.id,
        nom: t.nom,
        tauxBp: pointsDeBase(t.tauxBp),
        incluse: t.incluse,
      }
    }
    return { tauxTaxes: table }
  }, [taxes])

  // ── L'état de la commande est RÉDUIT depuis le journal, jamais muté ──────
  const etat = useMemo(
    () => (journal.length > 0 ? reduireEvenements(journal) : null),
    [journal],
  )

  const totaux = useMemo(() => {
    if (!etat || taxes.length === 0) return null
    // `etat.lignes` est déjà `readonly LigneCalculable[]` : on le passe tel
    // quel, sans copie — l'état réduit ne doit jamais être muté.
    const lignes: readonly LigneCalculable[] = etat.lignes
    try {
      return calculerTotaux({
        lignes,
        remiseGlobale:
          remisePourcent > 0
            ? { type: 'pourcentage', valeurBp: pointsDeBase(remisePourcent * 100) }
            : undefined,
        config,
      })
    } catch {
      // Un taux absent du catalogue local signale une désynchronisation :
      // on n'affiche pas un total faux, on n'affiche rien.
      return null
    }
  }, [etat, config, remisePourcent, taxes.length])

  // ── Ajout d'une ligne : un ÉVÉNEMENT, écrit localement puis affiché ──────
  const ajouterProduit = useCallback(
    async (produit: ProduitLocal) => {
      const orderId = etat?.id ?? uuidV7()
      const contexteEvenement = {
        orderId,
        restaurantId: identite.restoId,
        organizationId: identite.orgId,
        deviceId: identite.deviceId,
      }

      const nouveaux: EvenementCommande[] = []
      if (!etat) {
        nouveaux.push({
          ...contexteEvenement,
          eventId: uuidV7(),
          seqDevice: await contexte.journal.prochaineSeq(),
          clientTs: new Date().toISOString(),
          serverSeq: null,
          type: 'order.opened',
          payload: { type: 'takeaway', ouvertePar: identite.deviceId },
          acteurId: null,
        })
      }

      nouveaux.push({
        ...contexteEvenement,
        eventId: uuidV7(),
        seqDevice: await contexte.journal.prochaineSeq(),
        clientTs: new Date().toISOString(),
        serverSeq: null,
        type: 'line.added',
        payload: {
          ligneId: uuidV7(),
          produitId: produit.id,
          designation: produit.nom,
          quantite: 1,
          prixBaseMillimes: millimes(produit.prixBaseMillimes),
          modificateursMillimes: millimes(0),
          tauxTaxeId: produit.tauxTaxeId,
          stationId: produit.stationId,
        },
        acteurId: null,
      })

      // Écriture locale d'abord (durabilité), affichage ensuite.
      // L'inverse ferait afficher une vente qui n'existe nulle part.
      for (const e of nouveaux) await contexte.journal.ajouter(e)
      setJournal((precedent) => [...precedent, ...nouveaux])
    },
    [contexte, etat, identite],
  )

  const annulerLigne = useCallback(
    async (ligneId: string) => {
      if (!etat) return
      // Une annulation n'efface RIEN : elle ajoute un événement.
      const evenement: EvenementCommande = {
        eventId: uuidV7(),
        orderId: etat.id,
        restaurantId: identite.restoId,
        organizationId: identite.orgId,
        deviceId: identite.deviceId,
        seqDevice: await contexte.journal.prochaineSeq(),
        clientTs: new Date().toISOString(),
        serverSeq: null,
        type: 'line.voided',
        payload: { ligneId, motif: 'Retiré par le caissier' },
        acteurId: null,
      }
      await contexte.journal.ajouter(evenement)
      setJournal((precedent) => [...precedent, evenement])
    },
    [contexte, etat, identite],
  )

  const produitsAffiches = categorieActive
    ? produits.filter((p) => p.categorieId === categorieActive)
    : produits

  const lignesActives = etat?.lignes.filter((l) => !l.annulee) ?? []

  return (
    <div className="caisse">
      <section className="menu" aria-label="Carte">
        <div className="categories" role="tablist">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={categorieActive === c.id}
              className={categorieActive === c.id ? 'actif' : ''}
              style={{ '--teinte': c.couleur ?? '#6b7280' } as React.CSSProperties}
              onClick={() => setCategorieActive(c.id)}
            >
              {c.nom}
            </button>
          ))}
        </div>

        <div className="grille-produits">
          {produitsAffiches.map((p) => (
            <button
              key={p.id}
              type="button"
              className="carte-produit"
              disabled={!p.disponible}
              onClick={() => void ajouterProduit(p)}
            >
              <span className="nom">{p.nom}</span>
              <span className="prix">{formaterTND(millimes(p.prixBaseMillimes))}</span>
            </button>
          ))}
          {produitsAffiches.length === 0 && (
            <p className="vide">Aucun produit dans cette catégorie.</p>
          )}
        </div>
      </section>

      <aside className="ticket" aria-label="Commande en cours">
        <h2>Commande</h2>

        {lignesActives.length === 0 ? (
          <p className="vide">
            Touchez un produit pour l'ajouter. Tout est écrit dans SQLite local :
            aucune connexion n'est nécessaire.
          </p>
        ) : (
          <ul className="lignes">
            {lignesActives.map((l) => {
              const detail = totaux?.lignes.find((x) => x.id === l.id)
              return (
                <li key={l.id}>
                  <span className="qte">{l.quantite}×</span>
                  <span className="designation">{l.designation}</span>
                  <span className="montant">
                    {formaterTND(
                      (detail?.totalBrutMillimes ??
                        millimes(l.prixBaseMillimes * l.quantite)) as Millimes,
                      { symbole: false },
                    )}
                  </span>
                  <button
                    type="button"
                    className="retirer"
                    aria-label={`Annuler ${l.designation}`}
                    onClick={() => void annulerLigne(l.id)}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {totaux && lignesActives.length > 0 && (
          <div className="totaux">
            <label className="remise">
              Remise globale
              <select
                value={remisePourcent}
                onChange={(e) => setRemisePourcent(Number(e.target.value))}
              >
                {[0, 5, 10, 15, 20, 50].map((v) => (
                  <option key={v} value={v}>
                    {v} %
                  </option>
                ))}
              </select>
            </label>

            <div className="ligne-total">
              <span>Sous-total</span>
              <span>{formaterTND(totaux.sousTotalMillimes)}</span>
            </div>

            {totaux.totalRemisesMillimes > 0 && (
              <div className="ligne-total remise-appliquee">
                <span>Remise</span>
                <span>− {formaterTND(totaux.totalRemisesMillimes)}</span>
              </div>
            )}

            {/*
              Ventilation PAR TAUX, arrondie par taux puis sommée.
              C'est la règle figée de packages/domain, étape 6.
            */}
            {totaux.ventilationTaxes.map((v) => (
              <div key={`${v.tauxTaxeId}-${v.nom}`} className="ligne-total taxe">
                <span>
                  {v.nom} {v.incluse ? '(incluse)' : ''}
                </span>
                <span>{formaterTND(v.taxeMillimes)}</span>
              </div>
            ))}

            <div className="ligne-total grand-total">
              <span>Total</span>
              <span>{formaterTND(totaux.totalMillimes)}</span>
            </div>

            {totaux.ecartRepartitionMillimes > 0 && (
              <p className="note-arrondi">
                Écart d'arrondi de répartition absorbé :{' '}
                {formaterTND(totaux.ecartRepartitionMillimes)}
              </p>
            )}
          </div>
        )}

        <p className="compteur-evenements">
          {journal.length} événement(s) dans le journal local
          {etat?.exceptions.length ? ` · ${etat.exceptions.length} anomalie(s)` : ''}
        </p>
      </aside>
    </div>
  )
}
