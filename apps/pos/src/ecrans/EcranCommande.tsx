/**
 * Prise de commande.
 *
 * Chaque geste passe par `SessionCaisse` : contrôle de permission, écriture
 * de l'événement, reprojection, puis affichage. Rien n'est jamais muté
 * directement dans l'état React — l'état vient toujours du journal réduit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  calculerTotaux,
  formaterTND,
  millimes,
  pointsDeBase,
  reduireEvenements,
  estModifiable,
  type EtatCommande,
  type Millimes,
  type TotauxCommande,
} from '@kaissi/domain'
import type {
  CategorieLocale,
  ModificateurLocal,
  ProduitLocal,
  VarianteLocale,
} from '@kaissi/db-local'
import { rendreTicketCuisine } from '@kaissi/printing'
import { useApp } from '../etat/contexte.js'
import { RefusOperation } from '../donnees/session.js'
import { Modale } from '../composants/Modale.js'
import { DemandePin } from '../composants/DemandePin.js'
import { TicketEcran } from '../composants/TicketEcran.js'
import { IMPRESSION_ACTIVE } from '../config.js'
import type { Employe } from '@kaissi/domain'

interface Props {
  readonly orderId: string
  readonly onRetour: () => void
  readonly onEncaisser: (orderId: string) => void
}

interface ChoixProduit {
  produit: ProduitLocal
  variantes: VarianteLocale[]
  modificateurs: ModificateurLocal[]
}

export function EcranCommande({ orderId, onRetour, onEncaisser }: Props) {
  const app = useApp()
  const { session, employe, config, stations, tables } = app

  const [categories, setCategories] = useState<CategorieLocale[]>([])
  const [produits, setProduits] = useState<ProduitLocal[]>([])
  const [categorieActive, setCategorieActive] = useState<string | null>(null)
  const [etat, setEtat] = useState<EtatCommande | null>(null)
  const [choix, setChoix] = useState<ChoixProduit | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [escalade, setEscalade] = useState<{
    message: string
    action: (manager: Employe) => Promise<void>
  } | null>(null)
  const [remiseOuverte, setRemiseOuverte] = useState(false)
  /**
   * Bons de cuisine qui viennent de partir, affichés tant que l'impression
   * est éteinte. La cuisine les voit de son côté au back-office ; cet aperçu
   * sert au serveur qui veut vérifier ce qu'il vient d'envoyer.
   */
  const [bonsEmis, setBonsEmis] = useState<Uint8Array[] | null>(null)

  const recharger = useCallback(async () => {
    setEtat(await session.etatDe(orderId))
  }, [session, orderId])

  // Dépend du CATALOGUE, pas de l'objet de contexte entier : ce dernier change
  // d'identité à chaque tic de la file d'impression, et l'effet se relancerait
  // en plein service.
  const catalogue = app.app.catalogue

  useEffect(() => {
    let vivant = true
    void (async () => {
      const [c, p] = await Promise.all([catalogue.categories(), catalogue.produits()])
      if (!vivant) return
      setCategories(c)
      setProduits(p)
      // On ne choisit une catégorie par défaut que s'il n'y en a pas déjà une
      // de VALIDE. Le back-office peut pousser une carte modifiée en plein
      // service : recharger le catalogue ne doit pas ramener le caissier sur
      // « Plats » alors qu'il est en train de saisir des boissons.
      setCategorieActive((actuelle) =>
        actuelle && c.some((categorie) => categorie.id === actuelle)
          ? actuelle
          : (c[0]?.id ?? null),
      )
      await recharger()
    })()
    return () => {
      vivant = false
    }
  }, [catalogue, recharger])

  const totaux: TotauxCommande | null = useMemo(() => {
    if (!etat) return null
    try {
      return calculerTotaux({
        lignes: etat.lignes,
        remiseGlobale: etat.remiseGlobale ?? undefined,
        config,
      })
    } catch {
      return null
    }
  }, [etat, config])

  /** Exécute une action de caisse en traitant proprement un refus escaladable. */
  const executer = useCallback(
    async (action: (manager?: Employe) => Promise<unknown>, libelle: string) => {
      try {
        await action()
        await recharger()
        app.rafraichir()
      } catch (e) {
        if (e instanceof RefusOperation && e.escaladePossible) {
          setEscalade({
            message: `${libelle} — ${e.message}`,
            action: async (manager) => {
              await action(manager)
              await recharger()
              app.rafraichir()
            },
          })
          return
        }
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [app, recharger],
  )

  const ouvrirProduit = async (produit: ProduitLocal) => {
    // Un produit retiré de la carte au back-office le DIT, au lieu d'être un
    // bouton gris sans explication. Le caissier n'a alors pas à deviner s'il
    // s'agit d'une rupture ou d'un écran qui a mal réagi.
    if (!produit.disponible) {
      setMessage(
        produit.motifRetrait === 'manuel'
          ? `${produit.nom} a été retiré de la carte par le gérant. ` +
            `Il n'est pas proposé pour le moment.`
          : `${produit.nom} est en rupture de stock. ` +
            `Il reviendra sur la carte dès que le gérant aura saisi la réception.`,
      )
      return
    }
    const [variantes, modificateurs] = await Promise.all([
      app.app.catalogue.variantes(produit.id),
      app.app.catalogue.modificateurs(produit.id),
    ])
    // Sans option à choisir, on ajoute directement : un clic au lieu de trois.
    if (variantes.length === 0 && modificateurs.length === 0) {
      await executer(
        () =>
          session.ajouterLigne(employe, orderId, {
            produitId: produit.id,
            designation: produit.nom,
            quantite: 1,
            prixBaseMillimes: millimes(produit.prixBaseMillimes),
            modificateursMillimes: millimes(0),
            tauxTaxeId: produit.tauxTaxeId,
            stationId: produit.stationId,
          }),
        'Ajout d’un article',
      )
      return
    }
    setChoix({ produit, variantes, modificateurs })
  }

  const envoyerCuisine = () =>
    executer(async () => {
      const libelleTable = tables.find((t) => t.id === etat?.tableId)?.label ?? null
      const resultat = await session.envoyerEnCuisine(
        employe,
        orderId,
        stations,
        libelleTable,
      )
      if (resultat.lignesEnvoyees === 0) {
        setMessage('Tout est déjà parti en cuisine.')
        return
      }
      if (IMPRESSION_ACTIVE) {
        setMessage(
          `${resultat.lignesEnvoyees} article(s) envoyé(s) — ${resultat.bons} bon(s).`,
        )
        return
      }
      setBonsEmis(resultat.tickets.map((t) => rendreTicketCuisine(t)))
    }, 'Envoi en cuisine')

  const lignesActives = etat?.lignes.filter((l) => !l.annulee) ?? []
  const modifiable = etat ? estModifiable(etat.statut) : false
  const nonEnvoyees = lignesActives.length > 0

  return (
    <div className="commande">
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
          {produits
            .filter((p) => !categorieActive || p.categorieId === categorieActive)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={`carte-produit${p.disponible ? '' : ' rupture'}`}
                // Indisponible reste CLIQUABLE : c'est le clic qui déclenche
                // l'explication. Un bouton désactivé ne dit rien, et le
                // caissier finit par taper trois fois dessus.
                disabled={!modifiable}
                onClick={() => void ouvrirProduit(p)}
              >
                <span className="nom">{p.nom}</span>
                {p.disponible ? (
                  <span className="prix">{formaterTND(millimes(p.prixBaseMillimes))}</span>
                ) : (
                  <span className="prix mention-rupture">Rupture</span>
                )}
              </button>
            ))}
        </div>
      </section>

      <aside className="ticket" aria-label="Commande en cours">
        <header className="entete-ticket">
          <button type="button" className="retour" onClick={onRetour}>
            ‹ Salle
          </button>
          <div className="titre">
            {etat?.tableId
              ? `Table ${tables.find((t) => t.id === etat.tableId)?.label ?? '?'}`
              : 'À emporter'}
            <small>{etat?.numeroTicket}</small>
          </div>
        </header>

        {lignesActives.length === 0 ? (
          <p className="vide">Touchez un produit pour l'ajouter.</p>
        ) : (
          <ul className="lignes">
            {lignesActives.map((l) => {
              const detail = totaux?.lignes.find((x) => x.id === l.id)
              return (
                <li key={l.id}>
                  <div className="haut">
                    <span className="qte">{l.quantite}×</span>
                    <span className="designation">{l.designation}</span>
                    <span className="montant">
                      {formaterTND(detail?.totalBrutMillimes ?? millimes(0), { symbole: false })}
                    </span>
                  </div>
                  {l.modificateurs.length > 0 && (
                    <div className="details">
                      {l.modificateurs.map((m) => m.nom).join(' · ')}
                    </div>
                  )}
                  {l.note && <div className="note">{l.note}</div>}
                  {modifiable && (
                    <div className="actions-ligne">
                      <button
                        type="button"
                        onClick={() =>
                          void executer(
                            () =>
                              session.changerQuantite(
                                employe,
                                orderId,
                                l.id,
                                Math.max(1, l.quantite - 1),
                              ),
                            'Modification de quantité',
                          )
                        }
                        aria-label="Diminuer"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void executer(
                            () =>
                              session.changerQuantite(employe, orderId, l.id, l.quantite + 1),
                            'Modification de quantité',
                          )
                        }
                        aria-label="Augmenter"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="retirer"
                        onClick={() =>
                          void executer(
                            (manager) =>
                              session.annulerLigne(
                                employe,
                                orderId,
                                l.id,
                                'Retiré par le caissier',
                                manager,
                              ),
                            'Annulation d’une ligne',
                          )
                        }
                        aria-label={`Retirer ${l.designation}`}
                      >
                        Retirer
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {totaux && lignesActives.length > 0 && (
          <div className="totaux">
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
            {totaux.ventilationTaxes.map((v) => (
              <div key={`${v.tauxTaxeId}-${v.nom}`} className="ligne-total taxe">
                <span>{v.nom}</span>
                <span>{formaterTND(v.taxeMillimes)}</span>
              </div>
            ))}
            <div className="ligne-total grand-total">
              <span>Total</span>
              <span>{formaterTND(totaux.totalMillimes)}</span>
            </div>
          </div>
        )}

        <div className="actions-commande">
          <button
            type="button"
            className="secondaire"
            disabled={!modifiable || lignesActives.length === 0}
            onClick={() => setRemiseOuverte(true)}
          >
            Remise
          </button>
          <button
            type="button"
            className="secondaire"
            disabled={!modifiable || !nonEnvoyees}
            onClick={() => void envoyerCuisine()}
          >
            Cuisine
          </button>
          <button
            type="button"
            className="principal"
            disabled={!modifiable || lignesActives.length === 0}
            onClick={() => onEncaisser(orderId)}
          >
            Encaisser
          </button>
        </div>
      </aside>

      {choix && (
        <ModaleOptions
          choix={choix}
          onAnnuler={() => setChoix(null)}
          onValider={async (variante, modificateurs, note) => {
            const deltaModificateurs = modificateurs.reduce(
              (total, m) => total + m.prixDeltaMillimes,
              0,
            )
            await executer(
              () =>
                session.ajouterLigne(employe, orderId, {
                  produitId: choix.produit.id,
                  variantId: variante?.id ?? null,
                  designation: variante
                    ? `${choix.produit.nom} (${variante.nom})`
                    : choix.produit.nom,
                  quantite: 1,
                  prixBaseMillimes: millimes(
                    choix.produit.prixBaseMillimes + (variante?.prixDeltaMillimes ?? 0),
                  ),
                  modificateursMillimes: millimes(deltaModificateurs),
                  modificateurs: modificateurs.map((m) => ({
                    id: m.id,
                    nom: m.nom,
                    prixDeltaMillimes: millimes(m.prixDeltaMillimes),
                  })),
                  tauxTaxeId: choix.produit.tauxTaxeId,
                  stationId: choix.produit.stationId,
                  note: note || undefined,
                }),
              'Ajout d’un article',
            )
            setChoix(null)
          }}
        />
      )}

      {remiseOuverte && (
        <ModaleRemise
          onAnnuler={() => setRemiseOuverte(false)}
          onValider={async (pourcent) => {
            setRemiseOuverte(false)
            await executer(
              (manager) =>
                session.appliquerRemise(
                  employe,
                  orderId,
                  { type: 'pourcentage', valeurBp: pointsDeBase(pourcent * 100) },
                  manager ? { autorisePar: manager } : {},
                ),
              `Remise de ${pourcent} %`,
            )
          }}
        />
      )}

      {escalade && (
        <DemandePin
          titre="Autorisation requise"
          sousTitre={escalade.message}
          candidats={app.employes.filter((e) => e.role === 'gerant' || e.role === 'admin')}
          onAnnuler={() => setEscalade(null)}
          onValide={(manager) => {
            const action = escalade.action
            setEscalade(null)
            void action(manager).catch((e: unknown) =>
              setMessage(e instanceof Error ? e.message : String(e)),
            )
          }}
        />
      )}

      {message && (
        <Modale titre="Information" onFermer={() => setMessage(null)}>
          <p>{message}</p>
        </Modale>
      )}

      {bonsEmis && (
        <Modale titre="Envoyé en cuisine" onFermer={() => setBonsEmis(null)}>
          <p className="aide">
            La cuisine voit cette commande sur son écran. Ces bons ne
            repartiront pas : ce qui est envoyé reste envoyé.
          </p>
          {bonsEmis.map((charge, i) => (
            <TicketEcran key={i} charge={charge} />
          ))}
        </Modale>
      )}
    </div>
  )
}

// ─── Choix des options d'un produit ─────────────────────────────────────────

function ModaleOptions({
  choix,
  onAnnuler,
  onValider,
}: {
  choix: ChoixProduit
  onAnnuler: () => void
  onValider: (
    variante: VarianteLocale | null,
    modificateurs: ModificateurLocal[],
    note: string,
  ) => Promise<void>
}) {
  const [variante, setVariante] = useState<VarianteLocale | null>(choix.variantes[0] ?? null)
  const [choisis, setChoisis] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')

  const groupes = useMemo(() => {
    const m = new Map<string, { nom: string; obligatoire: boolean; items: ModificateurLocal[] }>()
    for (const mod of choix.modificateurs) {
      const g = m.get(mod.groupeId) ?? {
        nom: mod.groupeNom,
        obligatoire: mod.obligatoire,
        items: [],
      }
      g.items.push(mod)
      m.set(mod.groupeId, g)
    }
    return [...m.entries()]
  }, [choix.modificateurs])

  // Un groupe obligatoire non renseigné bloque la validation : c'est le
  // point du « obligatoire », sinon la cuisine reçoit un plat sans cuisson.
  const manquants = groupes.filter(
    ([, g]) => g.obligatoire && !g.items.some((i) => choisis.has(i.id)),
  )

  const selection = choix.modificateurs.filter((m) => choisis.has(m.id))
  const total =
    choix.produit.prixBaseMillimes +
    (variante?.prixDeltaMillimes ?? 0) +
    selection.reduce((t, m) => t + m.prixDeltaMillimes, 0)

  return (
    <Modale
      titre={choix.produit.nom}
      sousTitre={formaterTND(millimes(total))}
      onFermer={onAnnuler}
      pied={
        <>
          <button type="button" className="secondaire" onClick={onAnnuler}>
            Annuler
          </button>
          <button
            type="button"
            className="principal"
            disabled={manquants.length > 0}
            onClick={() => void onValider(variante, selection, note)}
          >
            Ajouter · {formaterTND(millimes(total))}
          </button>
        </>
      }
    >
      {choix.variantes.length > 0 && (
        <fieldset>
          <legend>Taille</legend>
          <div className="options">
            {choix.variantes.map((v) => (
              <button
                key={v.id}
                type="button"
                className={variante?.id === v.id ? 'actif' : ''}
                onClick={() => setVariante(v)}
              >
                {v.nom}
                {v.prixDeltaMillimes !== 0 && (
                  <small>
                    {v.prixDeltaMillimes > 0 ? '+' : ''}
                    {formaterTND(millimes(v.prixDeltaMillimes), { symbole: false })}
                  </small>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {groupes.map(([id, g]) => (
        <fieldset key={id}>
          <legend>
            {g.nom}
            {g.obligatoire && <span className="obligatoire"> — obligatoire</span>}
          </legend>
          <div className="options">
            {g.items.map((m) => (
              <button
                key={m.id}
                type="button"
                className={choisis.has(m.id) ? 'actif' : ''}
                onClick={() =>
                  setChoisis((s) => {
                    const suivant = new Set(s)
                    if (suivant.has(m.id)) suivant.delete(m.id)
                    else {
                      // Un groupe à choix unique remplace au lieu d'ajouter.
                      if (m.maxSelect === 1) for (const i of g.items) suivant.delete(i.id)
                      suivant.add(m.id)
                    }
                    return suivant
                  })
                }
              >
                {m.nom}
                {m.prixDeltaMillimes !== 0 && (
                  <small>+{formaterTND(millimes(m.prixDeltaMillimes), { symbole: false })}</small>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      <label className="champ-note">
        Note pour la cuisine
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Sans oignon, bien cuit…"
          maxLength={120}
        />
      </label>
    </Modale>
  )
}

// ─── Remise ─────────────────────────────────────────────────────────────────

function ModaleRemise({
  onAnnuler,
  onValider,
}: {
  onAnnuler: () => void
  onValider: (pourcent: number) => Promise<void>
}) {
  return (
    <Modale titre="Remise sur la commande" onFermer={onAnnuler}>
      <p className="aide">
        Au-delà de votre plafond, le code d'un responsable sera demandé — et son
        nom restera dans le journal.
      </p>
      <div className="options grand">
        {[0, 5, 10, 15, 20, 25, 50].map((p) => (
          <button key={p} type="button" onClick={() => void onValider(p)}>
            {p} %
          </button>
        ))}
      </div>
    </Modale>
  )
}

export type { Millimes }
