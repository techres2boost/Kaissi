/**
 * Prise de commande.
 *
 * Chaque geste passe par `SessionCaisse` : contrôle de permission, écriture
 * de l'événement, reprojection, puis affichage. Rien n'est jamais muté
 * directement dans l'état React — l'état vient toujours du journal réduit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChefHat, ChevronLeft, Minus, MoreHorizontal, Percent, Plus, Trash2, UserRound } from 'lucide-react'
import {
  calculerTotaux,
  formaterPourcentage,
  formaterTND,
  millimes,
  pointsDeBase,
  estCommandeVide,
  estModifiable,
  peutModifierCatalogue,
  type EtatCommande,
  type Millimes,
  type Remise,
  type TotauxCommande,
} from '@kaissi/domain'
import type {
  CategorieLocale,
  ClientLocal,
  ModificateurLocal,
  ProduitLocal,
  ReductionLocale,
  VarianteLocale,
} from '@kaissi/db-local'
import { rendreTicketCuisine } from '@kaissi/printing'
import { useApp } from '../etat/contexte.js'
import { RefusOperation } from '../donnees/session.js'
import { Modale } from '../composants/Modale.js'
import { DemandePin } from '../composants/DemandePin.js'
import { TicketEcran } from '../composants/TicketEcran.js'
import { ModaleNouvelArticle } from '../composants/ModaleNouvelArticle.js'
import { ModaleNouvelleCategorie } from '../composants/ModaleNouvelleCategorie.js'
import {
  ModaleAnnulerCommande,
  ModaleArticleLibre,
  ModaleAutresActions,
  ModaleChangerTable,
} from '../composants/ModalesCommande.js'
import { IMPRESSION_ACTIVE } from '../config.js'
import type { Employe } from '@kaissi/domain'
import { t, tm } from '../i18n.js'

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
  /**
   * Les lignes déjà parties en cuisine. Elles le DISENT sur le ticket : le
   * serveur sait d'un coup d'œil ce que la cuisine a déjà, et pourquoi un
   * « + » sur une ligne partie en crée une nouvelle au lieu de la gonfler.
   */
  const [envoyees, setEnvoyees] = useState<ReadonlySet<string>>(new Set())
  const [choix, setChoix] = useState<ChoixProduit | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [escalade, setEscalade] = useState<{
    message: string
    action: (manager: Employe) => Promise<void>
  } | null>(null)
  const [remiseOuverte, setRemiseOuverte] = useState(false)
  const [nouvelArticle, setNouvelArticle] = useState(false)
  const [nouvelleCategorie, setNouvelleCategorie] = useState(false)
  const [clientOuvert, setClientOuvert] = useState(false)
  const [plusOuvert, setPlusOuvert] = useState(false)
  const [changerTable, setChangerTable] = useState(false)
  const [annulation, setAnnulation] = useState(false)
  const [articleLibre, setArticleLibre] = useState(false)
  /*
   * Sur TÉLÉPHONE seulement, le ticket se replie en une barre.
   *
   * Empilé sous la carte, il prenait tout l'écran dès la première ligne :
   * en-tête, lignes, totaux, quatre boutons — et la grille d'articles
   * tombait à une rangée qu'il fallait faire défiler pour trouver un plat.
   * Vu sur un iPhone, en démonstration. La carte est ce qu'on touche
   * vingt fois par commande ; le détail du ticket, une fois, avant
   * d'encaisser. Replié, il garde ce qui sert à chaque geste : combien
   * d'articles, quel total, « Cuisine » et « Encaisser ».
   *
   * Sur tablette (au-delà de 900 px), cet état n'a aucun effet : le ticket
   * est une colonne, toujours ouverte (styles.css, `.resume-ticket`).
   */
  const [ticketDeplie, setTicketDeplie] = useState(false)
  /**
   * Bons de cuisine qui viennent de partir, affichés tant que l'impression
   * est éteinte. La cuisine les voit de son côté au back-office ; cet aperçu
   * sert au serveur qui veut vérifier ce qu'il vient d'envoyer.
   */
  const [bonsEmis, setBonsEmis] = useState<Uint8Array[] | null>(null)

  const caisseLocale = app.app.caisse
  const recharger = useCallback(async () => {
    const [nouvelEtat, parties] = await Promise.all([
      session.etatDe(orderId),
      caisseLocale.lignesDejaEnvoyees(orderId),
    ])
    setEnvoyees(parties)
    setEtat(nouvelEtat)
  }, [session, orderId, caisseLocale])

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
            message: `${libelle} — ${tm(e.message)}`,
            action: async (manager) => {
              await action(manager)
              await recharger()
              app.rafraichir()
            },
          })
          return
        }
        setMessage(e instanceof Error ? tm(e.message) : String(e))
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
          ? t("{nom} a été retiré de la carte par le gérant. Il n'est pas proposé pour le moment.", {
              nom: produit.nom,
            })
          : t(
              '{nom} est en rupture de stock. Il reviendra sur la carte dès que le gérant aura saisi la réception.',
              { nom: produit.nom },
            ),
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
        t('Ajout d’un article'),
      )
      return
    }
    setChoix({ produit, variantes, modificateurs })
  }

  const envoyerCuisine = () =>
    executer(async () => {
      const libelleTable = tables.find((elt) => elt.id === etat?.tableId)?.label ?? null
      const resultat = await session.envoyerEnCuisine(
        employe,
        orderId,
        stations,
        libelleTable,
      )
      if (resultat.lignesEnvoyees === 0) {
        setMessage(t('Tout est déjà parti en cuisine.'))
        return
      }
      if (IMPRESSION_ACTIVE) {
        setMessage(
          t('{articles} article(s) envoyé(s) — {bons} bon(s).', {
            articles: resultat.lignesEnvoyees,
            bons: resultat.bons,
          }),
        )
        return
      }
      setBonsEmis(resultat.tickets.map((elt) => rendreTicketCuisine(elt)))
    }, t('Envoi en cuisine'))

  const lignesActives = etat?.lignes.filter((l) => !l.annulee) ?? []
  /*
   * Les lignes RETIRÉES restent à l'écran, barrées, hors du total.
   *
   * Elles disparaissaient : le caissier qui venait de toucher « Retirer » ne
   * voyait plus rien, ne savait pas si l'action avait pris, et recommençait
   * sur la ligne suivante. Une annulation n'efface jamais rien (RÈGLE 6) —
   * l'écran ne doit pas faire croire le contraire.
   */
  const lignesRetirees = etat?.lignes.filter((l) => l.annulee) ?? []

  /**
   * Retire une ligne — le même geste depuis « Retirer » et depuis « − » à 1.
   *
   * Le motif reste en FRANÇAIS : il est écrit dans le journal, qui est une
   * donnée, pas un écran. Il se traduit à l'affichage, partout où il est lu.
   */
  const retirerLigne = (ligneId: string) =>
    executer(
      (manager) =>
        session.annulerLigne(employe, orderId, ligneId, 'Retiré par le caissier', manager),
      t('Annulation d’une ligne'),
    )
  const modifiable = etat ? estModifiable(etat.statut) : false
  const vide = etat ? estCommandeVide(etat) : false

  /*
   * Annuler, puis revenir à la salle : la commande n'existe plus à l'écran,
   * rester dessus montrerait un ticket figé qu'on ne peut plus toucher.
   *
   * Vide, c'est `libererTableVide` — le serveur qui s'est trompé de table
   * n'a besoin de personne. Sinon `annulerCommande`, et c'est le droit de
   * CELUI QUI AUTORISE qui compte : un serveur déclenche, un gérant pose
   * son code (l'escalade de `executer`).
   */
  const annuler = (motif: string) =>
    executer(async (manager) => {
      if (vide) await session.libererTableVide(employe, orderId)
      else {
        const autorise = manager ?? employe
        if (!autorise) throw new RefusOperation(t('Aucun employé identifié sur ce terminal.'), false)
        await session.annulerCommande(employe, orderId, motif, autorise)
      }
      onRetour()
    }, vide ? t('Libérer la table') : t('Annuler la commande'))
  const nonEnvoyees = lignesActives.length > 0
  const nombreArticles = lignesActives.reduce((somme, l) => somme + l.quantite, 0)
  const titreTicket = etat?.tableId
    ? t('Table {numero}', { numero: tables.find((elt) => elt.id === etat.tableId)?.label ?? '?' })
    : t('À emporter')

  return (
    <div className="commande">
      <section className="menu" aria-label={t('Carte')}>
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
          {/*
            « + » au BOUT des catégories, là où l'œil cherche celle qui
            manque — même geste que la tuile « Nouvel article » au bout des
            plats. Gérant et administrateur seulement : le serveur relit le
            rôle en base et refuserait de toute façon un serveur de salle.
          */}
          {employe && peutModifierCatalogue(employe.role) && (
            <button
              type="button"
              className="ajout-categorie"
              onClick={() => setNouvelleCategorie(true)}
              aria-label={t('Nouvelle catégorie')}
              title={t('Nouvelle catégorie')}
            >
              <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
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
                  <span className="prix mention-rupture">{t('Rupture')}</span>
                )}
                {/*
                  L'article créé ICI et pas encore remonté. Le dire sur la
                  TUILE, et pas seulement dans un écran de synchronisation :
                  c'est là que le caissier le voit, et c'est là qu'il doit
                  savoir que le back-office ne le connaît pas encore.
                */}
                {p.etatLocal === 'en_attente' && (
                  <span className="badge attente" title={t('Pas encore remonté au back-office')}>{t('en attente')}</span>
                )}
                {p.etatLocal === 'rejete' && (
                  <span
                    className="badge alerte"
                    title={t('Le serveur a refusé cet article — voir l’écran Sync.')}
                  >{t('refusé')}</span>
                )}
              </button>
            ))}

          {/*
            « Prix libre » pour TOUS : c'est le serveur au comptoir qui en a
            besoin, devant le client — pas le gérant au bureau.
          */}
          <button
            type="button"
            className="carte-produit prix-libre"
            disabled={!modifiable}
            onClick={() => setArticleLibre(true)}
          >
            <span className="nom">{t('Prix libre')}</span>
            <span className="prix">{t('Article hors carte')}</span>
          </button>

          {/*
            Une TUILE, en fin de grille, et pas un bouton dans une barre : on
            ajoute un article à l'endroit précis où l'on vient de ne pas le
            trouver. Le geste suit le regard.
          */}
          {employe && peutModifierCatalogue(employe.role) && (
            <button
              type="button"
              className="carte-produit nouvel-article"
              disabled={!modifiable}
              onClick={() => setNouvelArticle(true)}
            >
              <span className="nom">{t('+ Nouvel article')}</span>
              <span className="prix">{t('Ajouter à la carte')}</span>
            </button>
          )}
        </div>
      </section>

      <aside
        className={`ticket ${ticketDeplie ? 'deplie' : 'replie'}`}
        aria-label={t('Commande en cours')}
      >
        {/*
          La barre du téléphone — masquée sur tablette. Toucher le résumé
          déplie le ticket ; le toucher encore le replie. Le compte change
          à chaque article ajouté : c'est l'accusé de réception du geste,
          sans avoir à ouvrir quoi que ce soit.
        */}
        <div className="resume-ticket">
          <button type="button" className="retour" onClick={onRetour}>{t('‹ Salle')}</button>
          <button
            type="button"
            className="ouvrir-ticket"
            aria-expanded={ticketDeplie}
            onClick={() => setTicketDeplie((v) => !v)}
          >
            <span className="resume-titre">
              {titreTicket} <small>{etat?.numeroTicket}</small>
            </span>
            <span className="resume-chiffres">
              <span key={nombreArticles} className="compte">
                {t('{n} article(s)', { n: nombreArticles })}
              </span>
              {' · '}
              <span className="montant">{formaterTND(totaux?.totalMillimes ?? millimes(0))}</span>
            </span>
            <span className="chevron" aria-hidden="true">{ticketDeplie ? '▾' : '▴'}</span>
          </button>
        </div>
        <div className="actions-rapides">
          <button
            type="button"
            className="secondaire"
            disabled={!modifiable || !nonEnvoyees}
            onClick={() => void envoyerCuisine()}
          >
            <ChefHat size={18} strokeWidth={2} aria-hidden="true" /> {t('Cuisine')}
          </button>
          <button
            type="button"
            className="principal"
            disabled={!modifiable || lignesActives.length === 0}
            onClick={() => onEncaisser(orderId)}
          >{t('Encaisser')}</button>
        </div>

        <header className="entete-ticket">
          <button type="button" className="retour" onClick={onRetour}>
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" className="sens" />
            {t('Salle')}
          </button>
          <div className="titre">
            {titreTicket}
            <small>{etat?.numeroTicket}</small>
          </div>
        </header>

        {lignesActives.length === 0 && lignesRetirees.length === 0 ? (
          <p className="vide">{t('Touchez un produit pour l\'ajouter.')}</p>
        ) : (
          <ul className="lignes">
            {lignesActives.map((l) => {
              const detail = totaux?.lignes.find((x) => x.id === l.id)
              return (
                <li key={l.id} className={envoyees.has(l.id) ? 'envoyee' : undefined}>
                  <div className="haut">
                    <span className="qte">{l.quantite}</span>
                    <span className="designation">
                      {l.designation}
                      {envoyees.has(l.id) && (
                        <span className="marque-envoyee" title={t('Déjà en cuisine')}>
                          <ChefHat size={13} strokeWidth={2} aria-hidden="true" />
                          <span className="lecteur-ecran">{t('Déjà en cuisine')}</span>
                        </span>
                      )}
                    </span>
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
                      <span className="pas">
                      {/*
                       * À 1, « − » RETIRE la ligne. Il était borné à 1 et ne
                       * faisait donc rien : le bouton le plus naturel pour
                       * enlever un article était le seul qui ne répondait pas.
                       */}
                      <button
                        type="button"
                        onClick={() =>
                          void (l.quantite <= 1
                            ? retirerLigne(l.id)
                            : executer(
                                () =>
                                  session.changerQuantite(employe, orderId, l.id, l.quantite - 1),
                                t('Modification de quantité'),
                              ))
                        }
                        aria-label={l.quantite <= 1 ? t('Retirer {nom}', { nom: l.designation }) : t('Diminuer')}
                      >
                        <Minus size={16} strokeWidth={2.25} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void executer(
                            () =>
                              session.augmenter(employe, orderId, l.id),
                            t('Modification de quantité'),
                          )
                        }
                        aria-label={t('Augmenter')}
                      >
                        <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
                      </button>
                      </span>
                      {/*
                        Une corbeille, discrète et au BOUT de la ligne : le mot
                        « Retirer » en rouge, en gros, sous chaque plat, était
                        l'élément le plus voyant du ticket — plus que le total.
                      */}
                      <button
                        type="button"
                        className="retirer"
                        onClick={() => void retirerLigne(l.id)}
                        aria-label={t('Retirer {nom}', { nom: l.designation })}
                        title={t('Retirer')}
                      >
                        <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
            {lignesRetirees.map((l) => (
              <li key={l.id} className="retiree" aria-label={t('{nom}, retiré', { nom: l.designation })}>
                <div className="haut">
                  <span className="qte">{l.quantite}</span>
                  <span className="designation">{l.designation}</span>
                  <span className="montant">{t('retiré')}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {totaux && lignesActives.length > 0 && (
          <div className="totaux">
            <div className="ligne-total">
              <span>{t('Sous-total')}</span>
              <span>{formaterTND(totaux.sousTotalMillimes)}</span>
            </div>
            {totaux.totalRemisesMillimes > 0 && (
              <div className="ligne-total remise-appliquee">
                <span>{t('Remise')}</span>
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
              <span>{t('Total')}</span>
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
            <Percent size={15} strokeWidth={2} aria-hidden="true" /> {t('Remise')}
          </button>
          {/*
            « Client » à côté de « Remise », pas dans un menu.
            
            On note à qui l'on vend au moment où on prend la commande — un
            numéro de téléphone pour un plat à emporter, un habitué qu'on
            reconnaît. Trois clics plus loin, personne ne le fait, et la
            fiche client reste vide pour toujours.
          */}
          <button
            type="button"
            className="secondaire"
            disabled={!modifiable}
            onClick={() => setClientOuvert(true)}
          >
            {etat?.clientNom ? (
              <>
                <UserRound size={15} strokeWidth={2} aria-hidden="true" /> {etat.clientNom}
              </>
            ) : (
              <>
                <UserRound size={15} strokeWidth={2} aria-hidden="true" /> {t('Client')}
              </>
            )}
          </button>
          <button
            type="button"
            className="secondaire plus"
            disabled={!modifiable}
            onClick={() => setPlusOuvert(true)}
            aria-label={t('Autres actions')}
          >
            <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" /> {t('Plus')}
          </button>
          <button
            type="button"
            className="secondaire cuisine"
            disabled={!modifiable || !nonEnvoyees}
            onClick={() => void envoyerCuisine()}
          >
            <ChefHat size={18} strokeWidth={2} aria-hidden="true" /> {t('Cuisine')}
          </button>
          {/* Le total SUR le bouton : on lit ce qu'on va encaisser en le touchant. */}
          <button
            type="button"
            className="principal"
            disabled={!modifiable || lignesActives.length === 0}
            onClick={() => onEncaisser(orderId)}
          >
            <span>{t('Encaisser')}</span>
            {lignesActives.length > 0 && totaux && (
              <span className="montant">{formaterTND(totaux.totalMillimes)}</span>
            )}
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
              t('Ajout d’un article'),
            )
            setChoix(null)
          }}
        />
      )}

      {nouvelArticle && employe && (
        <ModaleNouvelArticle
          employe={employe}
          categories={categories}
          categorieActive={categorieActive}
          onFerme={() => setNouvelArticle(false)}
          onCree={async (nom) => {
            /*
             * On relit la carte ICI, et seulement ici.
             *
             * L'effet de chargement dépend de `catalogue`, pas de `version` :
             * ajouter `version` rechargerait tout le catalogue à CHAQUE ligne
             * ajoutée — `rafraichir()` est appelé à chaque geste de caisse, et
             * ajouter un article doit rester sous les 50 ms. Une relecture par
             * création coûte une requête, quelques fois par service.
             */
            setProduits(await catalogue.produits())
            /*
             * PAS de modale de confirmation, et c'est délibéré : l'article
             * APPARAÎT dans la carte, avec son badge « en attente ». Un
             * dialogue par-dessus dirait la même chose et demanderait un
             * geste de plus — en plein service, devant un client.
             */
            void nom
          }}
        />
      )}

      {plusOuvert && etat && (
        <ModaleAutresActions
          vide={vide}
          surTable={etat.tableId !== null}
          onFermer={() => setPlusOuvert(false)}
          onChangerTable={() => {
            setPlusOuvert(false)
            setChangerTable(true)
          }}
          onAnnuler={() => {
            setPlusOuvert(false)
            setAnnulation(true)
          }}
        />
      )}

      {changerTable && etat && (
        <ModaleChangerTable
          orderId={orderId}
          tableActuelle={etat.tableId}
          tables={tables}
          onFermer={() => setChangerTable(false)}
          onChoisir={(tableId) => {
            setChangerTable(false)
            void executer(
              () => session.transfererTable(employe, orderId, tableId),
              t('Changement de table'),
            )
          }}
        />
      )}

      {annulation && (
        <ModaleAnnulerCommande
          vide={vide}
          onFermer={() => setAnnulation(false)}
          onConfirmer={(motif) => {
            setAnnulation(false)
            void annuler(motif)
          }}
        />
      )}

      {articleLibre && (
        <ModaleArticleLibre
          stations={stations}
          onFermer={() => setArticleLibre(false)}
          onAjouter={async (article) => {
            await executer(
              () => session.ajouterArticleLibre(employe, orderId, article),
              t('Ajout d’un article'),
            )
            setArticleLibre(false)
          }}
        />
      )}

      {nouvelleCategorie && employe && (
        <ModaleNouvelleCategorie
          employe={employe}
          onFerme={() => setNouvelleCategorie(false)}
          onCree={async (_nom, id) => {
            // Relue ICI seulement, comme après un nouvel article : recharger
            // la carte à chaque ligne ajoutée coûterait le délai de 50 ms.
            setCategories(await catalogue.categories())
            setCategorieActive(id)
          }}
        />
      )}

      {remiseOuverte && (
        <ModaleRemise
          reductions={app.reductions}
          onAnnuler={() => setRemiseOuverte(false)}
          onValider={async (remise) => {
            setRemiseOuverte(false)
            await executer(
              (manager) =>
                session.appliquerRemise(
                  employe,
                  orderId,
                  remise,
                  manager ? { autorisePar: manager } : {},
                ),
              remise.motif
                ? t('Remise « {motif} »', { motif: remise.motif })
                : remise.type === 'pourcentage'
                  ? t('Remise de {taux} %', { taux: formaterPourcentage(remise.valeurBp) })
                  : t('Remise de {montant}', { montant: formaterTND(remise.valeurMillimes) }),
            )
          }}
        />
      )}

      {clientOuvert && (
        <ModaleClient
          rechercher={(texte) => app.app.catalogue.clients(texte)}
          actuel={etat?.clientId ? { id: etat.clientId, nom: etat.clientNom ?? '' } : null}
          onAnnuler={() => setClientOuvert(false)}
          onChoisir={async (client) => {
            setClientOuvert(false)
            await executer(
              () => session.attacherClient(employe, orderId, client),
              client ? t('Client « {nom} »', { nom: client.nom }) : t('Client retiré de la commande'),
            )
          }}
        />
      )}

      {escalade && (
        <DemandePin
          titre={t('Autorisation requise')}
          sousTitre={escalade.message}
          candidats={app.employes.filter((e) => e.role === 'gerant' || e.role === 'admin')}
          onAnnuler={() => setEscalade(null)}
          onValide={(manager) => {
            const action = escalade.action
            setEscalade(null)
            void action(manager).catch((e: unknown) =>
              setMessage(e instanceof Error ? tm(e.message) : String(e)),
            )
          }}
        />
      )}

      {message && (
        <Modale titre={t('Information')} onFermer={() => setMessage(null)}>
          <p>{message}</p>
        </Modale>
      )}

      {bonsEmis && (
        <Modale titre={t('Envoyé en cuisine')} onFermer={() => setBonsEmis(null)}>
          <p className="aide">{t('La cuisine voit cette commande sur son écran. Ces bons ne repartiront pas : ce qui est envoyé reste envoyé.')}</p>
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
    selection.reduce((elt, m) => elt + m.prixDeltaMillimes, 0)

  return (
    <Modale
      titre={choix.produit.nom}
      sousTitre={formaterTND(millimes(total))}
      onFermer={onAnnuler}
      pied={
        <>
          <button type="button" className="secondaire" onClick={onAnnuler}>{t('Annuler')}</button>
          <button
            type="button"
            className="principal"
            disabled={manquants.length > 0}
            onClick={() => void onValider(variante, selection, note)}
          >{t('Ajouter · {montant}', { montant: formaterTND(millimes(total)) })}</button>
        </>
      }
    >
      {choix.variantes.length > 0 && (
        <fieldset>
          <legend>{t('Taille')}</legend>
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
            {g.obligatoire && <span className="obligatoire">{' '}{t('— obligatoire')}</span>}
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

      <label className="champ-note">{t('Note pour la cuisine')}<input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('Sans oignon, bien cuit…')}
          maxLength={120}
        />
      </label>
    </Modale>
  )
}

// ─── Remise ─────────────────────────────────────────────────────────────────

/**
 * Le choix d'une remise : les réductions de la maison, puis la saisie libre.
 *
 * ── Pourquoi le référentiel D'ABORD ───────────────────────────────────────
 *
 * Une remise saisie à la main ne dit que son montant. « 12 % sur la table 4 »
 * ne se juge pas : happy hour, geste commercial, personnel de la maison, ce
 * sont trois décisions différentes — et le rapport ne pouvait pas les
 * distinguer. Choisir dans une liste nomme la décision, en un geste au lieu
 * de deux.
 *
 * ── Pourquoi la saisie libre RESTE ────────────────────────────────────────
 *
 * Le geste commercial n'entre dans aucune case, et il se décide devant un
 * client qui attend. Obliger à créer une réduction au back-office avant de
 * l'accorder, c'est garantir qu'on la contournera — ou qu'on ne remisera
 * plus du tout.
 */
function ModaleRemise({
  reductions,
  onAnnuler,
  onValider,
}: {
  reductions: readonly ReductionLocale[]
  onAnnuler: () => void
  onValider: (remise: Remise) => Promise<void>
}) {
  const [libre, setLibre] = useState(reductions.length === 0)

  return (
    <Modale titre={t('Remise sur la commande')} onFermer={onAnnuler}>
      <p className="aide">{t('Au-delà de votre plafond, le code d\'un responsable sera demandé — et son nom restera dans le journal.')}</p>

      {!libre && (
        <>
          <div className="options grand">
            {reductions.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() =>
                  void onValider(
                    r.type === 'montant'
                      ? {
                          type: 'montant',
                          valeurMillimes: millimes(r.montantMillimes ?? 0),
                          motif: r.nom,
                          reductionId: r.id,
                        }
                      : {
                          type: 'pourcentage',
                          valeurBp: pointsDeBase(r.valeurBp ?? 0),
                          motif: r.nom,
                          reductionId: r.id,
                        },
                  )
                }
              >
                <span className="nom-reduction">{r.nom}</span>
                <span className="valeur-reduction">
                  {r.type === 'montant'
                    ? `− ${formaterTND(millimes(r.montantMillimes ?? 0))}`
                    : `− ${formaterPourcentage(r.valeurBp ?? 0)} %`}
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="secondaire" onClick={() => setLibre(true)}>{t('Autre remise…')}</button>
        </>
      )}

      {libre && (
        <>
          {/*
            La remise libre n'a PAS de motif : elle n'en invente pas un. Le
            rapport la range sous « Sans motif », ce qui est la vérité — et ce
            qui rend visible le jour où elle devient l'habitude.
          */}
          <div className="options grand">
            {[0, 5, 10, 15, 20, 25, 50].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() =>
                  void onValider({ type: 'pourcentage', valeurBp: pointsDeBase(p * 100) })
                }
              >
                {p} %
              </button>
            ))}
          </div>
          {reductions.length > 0 && (
            <button type="button" className="secondaire" onClick={() => setLibre(false)}>{t('‹ Revenir aux réductions de la maison')}</button>
          )}
        </>
      )}
    </Modale>
  )
}

/**
 * Choisir le client d'une commande.
 *
 * ── Une recherche, pas une liste ──────────────────────────────────────────
 *
 * Un carnet de restaurant fait deux mille fiches au bout d'un an. Les
 * dérouler sur une tablette est plus long que de retaper le nom. On tape donc
 * ce qu'on a sous la main — un prénom, quatre chiffres du numéro — et la
 * recherche cherche dans les deux : au comptoir, on a le téléphone à
 * l'oreille, pas le temps de choisir une colonne.
 *
 * ── Ce que cette modale ne fait PAS ───────────────────────────────────────
 *
 * Créer une fiche. Le protocole de synchronisation ne remonte que des
 * ÉVÉNEMENTS DE COMMANDE ; une fiche créée ici n'aurait aucun chemin pour
 * monter, et resterait sur cette tablette — invisible au back-office et aux
 * autres terminaux. Un bouton « Nouveau client » qui produit une fiche que
 * personne d'autre ne verra est pire que pas de bouton du tout.
 */
function ModaleClient({
  rechercher,
  actuel,
  onAnnuler,
  onChoisir,
}: {
  rechercher: (texte: string) => Promise<ClientLocal[]>
  actuel: { id: string; nom: string } | null
  onAnnuler: () => void
  onChoisir: (client: ClientLocal | null) => Promise<void>
}) {
  const [texte, setTexte] = useState('')
  const [resultats, setResultats] = useState<ClientLocal[]>([])

  useEffect(() => {
    let vivant = true
    // 150 ms : assez pour ne pas interroger la base à chaque touche, assez peu
    // pour que la liste suive la frappe.
    const minuteur = setTimeout(() => {
      void rechercher(texte).then((r) => {
        if (vivant) setResultats(r)
      })
    }, 150)
    return () => {
      vivant = false
      clearTimeout(minuteur)
    }
  }, [texte, rechercher])

  return (
    <Modale titre={t('Client de la commande')} onFermer={onAnnuler}>
      <input
        className="recherche-client"
        type="search"
        value={texte}
        autoFocus
        placeholder={t('Nom ou téléphone…')}
        aria-label={t('Rechercher un client')}
        onChange={(e) => setTexte(e.target.value)}
      />

      {actuel && (
        <button type="button" className="secondaire" onClick={() => void onChoisir(null)}>{t('Retirer « {nom} » de la commande', { nom: actuel.nom })}</button>
      )}

      {resultats.length === 0 ? (
        <p className="aide">
          {texte.trim() === ''
            ? t('Aucun client enregistré. Les fiches se créent au back-office et redescendent à la prochaine synchronisation.')
            : t('Aucun client ne correspond à « {texte} ».', { texte })}
        </p>
      ) : (
        <div className="options grand">
          {resultats.map((c) => (
            <button key={c.id} type="button" onClick={() => void onChoisir(c)}>
              <span className="nom-reduction">{c.nom}</span>
              {c.telephone && <span className="detail">{c.telephone}</span>}
            </button>
          ))}
        </div>
      )}
    </Modale>
  )
}

export type { Millimes }
