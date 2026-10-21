/**
 * Les gestes RARES d'une commande : changer de table, l'annuler, vendre un
 * article hors carte.
 *
 * Ils vivent derrière « Plus », et pas sur le ticket : on les fait une fois
 * par service, quand « Encaisser » et « Cuisine » se touchent cent fois. Un
 * bouton « Annuler la commande » à côté de « Encaisser » serait touché par
 * erreur un samedi soir — et un gérant devrait venir poser son code pour
 * réparer.
 */

import { useEffect, useState } from 'react'
import { ArrowLeftRight, Ban } from 'lucide-react'
import { depuisDecimal, formaterTND, type Millimes } from '@kaissi/domain'
import type { CommandeOuverte, TableLocale, TauxTaxeLocal } from '@kaissi/db-local'
import { Modale } from './Modale.js'
import { useApp } from '../etat/contexte.js'
import { t } from '../i18n.js'

// ─── Le menu « Plus » ───────────────────────────────────────────────────────

export function ModaleAutresActions({
  vide,
  surTable,
  onChangerTable,
  onAnnuler,
  onFermer,
}: {
  /** Aucun article ni paiement n'a jamais été saisi. */
  readonly vide: boolean
  readonly surTable: boolean
  readonly onChangerTable: () => void
  readonly onAnnuler: () => void
  readonly onFermer: () => void
}) {
  return (
    <Modale titre={t('Autres actions')} onFermer={onFermer}>
      <div className="options grand autres-actions">
        <button type="button" onClick={onChangerTable}>
          <span className="nom-reduction">
            <ArrowLeftRight size={16} strokeWidth={2} aria-hidden="true" />{' '}
            {surTable ? t('Changer de table') : t('Installer à une table')}
          </span>
          <span className="detail">{t('La commande suit, avec tout ce qui est déjà parti en cuisine.')}</span>
        </button>
        <button type="button" className="danger" onClick={onAnnuler}>
          <span className="nom-reduction">
            <Ban size={16} strokeWidth={2} aria-hidden="true" />{' '}
            {vide ? t('Libérer la table') : t('Annuler la commande')}
          </span>
          <span className="detail">
            {vide
              ? t('Rien n’a été saisi : la table redevient libre, sans code de gérant.')
              : t('Demande le code d’un gérant. Rien n’est effacé : l’annulation reste au journal.')}
          </span>
        </button>
      </div>
    </Modale>
  )
}

// ─── Changer de table ───────────────────────────────────────────────────────

/**
 * Choisir la nouvelle table.
 *
 * Les tables OCCUPÉES restent visibles mais ne se choisissent pas : deux
 * commandes sur la même table, c'est deux tickets que personne ne sait plus
 * attribuer à l'encaissement. Fusionner deux tables est un autre geste, qui
 * n'existe pas encore — mieux vaut le dire que de le faire à moitié.
 *
 * « Occupée » se lit sur CETTE caisse, qui connaît les commandes de tout
 * l'établissement redescendues par /sync/pull. Hors ligne, une table prise
 * il y a une minute sur la tablette voisine paraît libre : c'est la limite
 * de toute donnée hors ligne, et le serveur l'acceptera quand même — un
 * transfert n'écrase rien.
 */
export function ModaleChangerTable({
  orderId,
  tableActuelle,
  tables,
  onChoisir,
  onFermer,
}: {
  readonly orderId: string
  readonly tableActuelle: string | null
  readonly tables: readonly TableLocale[]
  readonly onChoisir: (tableId: string | null) => void
  readonly onFermer: () => void
}) {
  const { app } = useApp()
  const [ouvertes, setOuvertes] = useState<CommandeOuverte[] | null>(null)

  useEffect(() => {
    let vivant = true
    void app.caisse.commandesOuvertes().then((c) => {
      if (vivant) setOuvertes(c)
    })
    return () => {
      vivant = false
    }
  }, [app])

  const occupees = new Set(
    (ouvertes ?? []).filter((c) => c.id !== orderId && c.tableId).map((c) => c.tableId),
  )

  return (
    <Modale titre={t('Changer de table')} onFermer={onFermer}>
      {tables.length === 0 ? (
        <p className="vide">{t('Aucune table n’est déclarée pour cet établissement.')}</p>
      ) : (
        <div className="grille-tables-choix">
          {tables.map((table) => {
            const occupee = occupees.has(table.id)
            const actuelle = table.id === tableActuelle
            return (
              <button
                key={table.id}
                type="button"
                className={actuelle ? 'actif' : occupee ? 'occupee' : ''}
                disabled={ouvertes === null || occupee || actuelle}
                aria-label={
                  occupee
                    ? t('Table {numero}, occupée', { numero: table.label })
                    : t('Table {numero}', { numero: table.label })
                }
                onClick={() => onChoisir(table.id)}
              >
                <span className="numero">{table.label}</span>
                <small>{actuelle ? t('ici') : occupee ? t('occupée') : t('libre')}</small>
              </button>
            )
          })}
        </div>
      )}
      {tableActuelle && (
        <button type="button" className="secondaire" onClick={() => onChoisir(null)}>
          {t('Passer en « à emporter »')}
        </button>
      )}
    </Modale>
  )
}

// ─── Annuler la commande ────────────────────────────────────────────────────

export function ModaleAnnulerCommande({
  vide,
  onConfirmer,
  onFermer,
}: {
  readonly vide: boolean
  readonly onConfirmer: (motif: string) => void
  readonly onFermer: () => void
}) {
  const [libre, setLibre] = useState('')
  /*
   * Le motif est écrit dans le JOURNAL, donc en français ; seul son libellé
   * se traduit. Le journal est une donnée, l'écran la traduit à la lecture.
   */
  const motifs = [
    { motif: 'Client parti', libelle: t('Client parti') },
    { motif: 'Erreur de saisie', libelle: t('Erreur de saisie') },
    { motif: 'Commande en double', libelle: t('Commande en double') },
  ]

  if (vide) {
    return (
      <Modale
        titre={t('Libérer la table')}
        sousTitre={t('Aucun article n’a été saisi sur cette commande.')}
        onFermer={onFermer}
        pied={
          <>
            <button type="button" onClick={onFermer}>{t('Garder la commande')}</button>
            <button type="button" className="principal" onClick={() => onConfirmer('')}>
              {t('Libérer la table')}
            </button>
          </>
        }
      >
        <p className="aide">{t('La table redevient libre. Le journal garde la trace de qui l’a libérée.')}</p>
      </Modale>
    )
  }

  return (
    <Modale
      titre={t('Annuler la commande')}
      sousTitre={t('Un gérant devra poser son code. Les articles déjà envoyés restent visibles en cuisine comme annulés.')}
      onFermer={onFermer}
    >
      <p className="aide">{t('Pourquoi cette annulation ?')}</p>
      <div className="options grand">
        {motifs.map(({ motif, libelle }) => (
          <button key={motif} type="button" onClick={() => onConfirmer(motif)}>
            <span className="nom-reduction">{libelle}</span>
          </button>
        ))}
      </div>
      <form
        className="motif-libre"
        onSubmit={(e) => {
          e.preventDefault()
          if (libre.trim()) onConfirmer(libre.trim())
        }}
      >
        <input
          type="text"
          value={libre}
          maxLength={200}
          placeholder={t('Autre motif…')}
          aria-label={t('Autre motif')}
          onChange={(e) => setLibre(e.target.value)}
        />
        <button type="submit" className="secondaire" disabled={libre.trim() === ''}>
          {t('Annuler avec ce motif')}
        </button>
      </form>
    </Modale>
  )
}

// ─── Article à prix libre ───────────────────────────────────────────────────

/**
 * « Divers » : vendre ce qui n'est pas à la carte, sans le créer.
 *
 * Le plat du jour qu'on ne refera pas, le supplément négocié, la bouteille
 * apportée de la réserve. Le créer à la carte (« + Nouvel article ») est
 * réservé au gérant et laisse une tuile pour toujours ; ici, rien ne reste,
 * sauf la ligne sur le ticket.
 *
 * Ce que la ligne n'a PAS : de produit. Elle ne décompte donc aucun stock,
 * et les rapports de marge la rangent dans « coût non saisi » — c'est la
 * vérité, et c'est ce qui rend visible le jour où « Divers » devient
 * l'habitude au lieu de l'exception.
 *
 * Le montant passe par `depuisDecimal`, et par lui seul (RÈGLE 1).
 */
export function ModaleArticleLibre({
  stations,
  onAjouter,
  onFermer,
}: {
  readonly stations: ReadonlyMap<string, { nom: string }>
  readonly onAjouter: (article: {
    designation: string
    prixMillimes: Millimes
    tauxTaxeId: string
    stationId: string | null
  }) => Promise<void>
  readonly onFermer: () => void
}) {
  const { app } = useApp()
  const [designation, setDesignation] = useState('')
  const [prix, setPrix] = useState('')
  const [taux, setTaux] = useState<TauxTaxeLocal[] | null>(null)
  const [tauxId, setTauxId] = useState<string | null>(null)
  const [stationId, setStationId] = useState<string | null>(stations.keys().next().value ?? null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    let vivant = true
    void app.catalogue.tauxTaxes().then((elt) => {
      if (!vivant) return
      setTaux(elt)
      setTauxId((actuel) => actuel ?? elt.find((x) => x.parDefaut)?.id ?? elt[0]?.id ?? null)
    })
    return () => {
      vivant = false
    }
  }, [app])

  const montant = (() => {
    try {
      const m = depuisDecimal(prix)
      return m > 0 ? m : null
    } catch {
      return null
    }
  })()

  async function ajouter() {
    if (montant === null || !tauxId) return
    setEnCours(true)
    try {
      await onAjouter({ designation, prixMillimes: montant, tauxTaxeId: tauxId, stationId })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Modale
      titre={t('Prix libre')}
      sousTitre={t('Un article hors carte, pour cette commande seulement.')}
      onFermer={onFermer}
      pied={
        <>
          <button type="button" onClick={onFermer}>{t('Annuler')}</button>
          <button
            type="button"
            className="principal"
            disabled={enCours || montant === null || !tauxId}
            onClick={() => void ajouter()}
          >
            {montant === null
              ? t('Ajouter')
              : t('Ajouter · {montant}', { montant: formaterTND(montant) })}
          </button>
        </>
      }
    >
      <form
        className="formulaire-article"
        onSubmit={(e) => {
          e.preventDefault()
          void ajouter()
        }}
      >
        <label>
          <span>{t('Montant (TND)')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={prix}
            autoFocus
            placeholder="7,500"
            onChange={(e) => setPrix(e.target.value)}
          />
          <small>
            {prix.trim() === ''
              ? t('Exemple : 7,500')
              : montant === null
                ? t('Montant illisible')
                : t('soit {montant}', { montant: formaterTND(montant) })}
          </small>
        </label>

        <label>
          <span>{t('Désignation')}</span>
          <input
            type="text"
            value={designation}
            maxLength={120}
            placeholder={t('Divers')}
            onChange={(e) => setDesignation(e.target.value)}
          />
        </label>

        <label>
          <span>{t('TVA')}</span>
          <select value={tauxId ?? ''} onChange={(e) => setTauxId(e.target.value || null)}>
            {(taux ?? []).map((elt) => (
              <option key={elt.id} value={elt.id}>
                {elt.nom}
              </option>
            ))}
          </select>
          {/*
            Le montant saisi suit la règle du TAUX, comme le prix d'un article
            de la carte : TVA comprise si le taux est « inclus », ajoutée
            sinon. Le dire évite qu'un caissier croie encaisser 7,500 et en
            demande 8,925.
          */}
          {taux?.find((x) => x.id === tauxId) && (
            <small>
              {taux.find((x) => x.id === tauxId)!.incluse
                ? t('TVA comprise dans ce montant.')
                : t('La TVA s’ajoute à ce montant.')}
            </small>
          )}
        </label>

        {stations.size > 0 && (
          <label>
            <span>{t('Poste de préparation')}</span>
            <select value={stationId ?? ''} onChange={(e) => setStationId(e.target.value || null)}>
              {[...stations.entries()].map(([id, s]) => (
                <option key={id} value={id}>
                  {s.nom}
                </option>
              ))}
              <option value="">{t('— aucun (rien à préparer) —')}</option>
            </select>
          </label>
        )}
      </form>
    </Modale>
  )
}
