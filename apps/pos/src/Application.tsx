/**
 * Coque de l'application : démarrage, verrouillage, navigation, bandeau d'état.
 *
 * L'enchaînement des écrans suit celui d'une vraie journée :
 *   verrouillé → prise de poste (PIN) → ouverture de caisse →
 *   salle → commande → encaissement → … → clôture de caisse
 */

import { useEffect, useState } from 'react'
import { Menu, Printer, TriangleAlert } from 'lucide-react'
import type { Shift } from '@kaissi/domain'
import { IMPRESSION_ACTIVE, URL_BACKOFFICE } from './config.js'
import { demarrer, type ContexteApplication } from './donnees/demarrage.js'
import { useEtatReseau } from './donnees/reseau.js'
import { FournisseurApp, useApp } from './etat/contexte.js'
import { DemandePin } from './composants/DemandePin.js'
import { EcranSalle } from './ecrans/EcranSalle.js'
import { EcranCommande } from './ecrans/EcranCommande.js'
import { EcranPaiement } from './ecrans/EcranPaiement.js'
import { EcranClotureShift, EcranOuvertureShift } from './ecrans/EcranShift.js'
import { EcranDiagnostic } from './ecrans/EcranDiagnostic.js'
import { Modale } from './composants/Modale.js'
import { EcranPeriodes } from './ecrans/EcranPeriodes.js'
import { EcranRecus } from './ecrans/EcranRecus.js'
import { EcranSync } from './ecrans/EcranSync.js'
import { EcranBienvenue } from './ecrans/EcranBienvenue.js'
import { ICONES_TIROIR, TiroirNavigation, type EntreeTiroir } from './composants/TiroirNavigation.js'
import type { Vue } from './navigation.js'

export function Application() {
  const [contexte, setContexte] = useState<ContexteApplication | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    demarrer()
      .then((c) => vivant && setContexte(c))
      .catch((e: unknown) => {
        if (vivant) setErreur(e instanceof Error ? e.message : String(e))
      })
    return () => {
      vivant = false
    }
  }, [])

  if (erreur) {
    return (
      <div className="ecran-bloquant">
        <h1>Démarrage impossible</h1>
        <p className="erreur">{erreur}</p>
        <p className="aide">
          La base locale n'a pas pu être ouverte ou migrée. Aucune vente n'est
          possible dans cet état. Redémarrez l'application ; si le problème
          persiste, transmettez ce message au support.
        </p>
      </div>
    )
  }

  if (!contexte) {
    return (
      <div className="ecran-bloquant">
        <div className="pastille-chargement" aria-hidden="true" />
        <p>Ouverture de la caisse…</p>
      </div>
    )
  }

  return (
    <FournisseurApp app={contexte}>
      <Terminal contexte={contexte} />
    </FournisseurApp>
  )
}

function Terminal({ contexte }: { contexte: ContexteApplication }) {
  const app = useApp()
  const { employe, definirEmploye, etatImpression, version } = app
  const reseau = useEtatReseau()

  const [shift, setShift] = useState<Shift | null | undefined>(undefined)
  const [vue, setVue] = useState<Vue>({ nom: 'salle' })
  /**
   * Le back-office a été demandé SANS réseau.
   *
   * Ouvrir quand même donnerait une page blanche dans le navigateur, et la
   * personne conclurait que le back-office est en panne. On préfère le dire
   * — et rappeler que la caisse, elle, continue.
   */
  const [backOfficeHorsLigne, setBackOfficeHorsLigne] = useState(false)
  const [tiroirOuvert, setTiroirOuvert] = useState(false)
  /*
   * Le choix fait sur l'écran d'accueil, relu au démarrage.
   *
   * `undefined` = on ne sait pas encore, et on n'affiche donc RIEN : montrer
   * l'accueil puis le retirer d'un coup ferait clignoter l'écran de toute
   * caisse déjà en démonstration, à chaque lancement.
   */
  const [demoAcceptee, setDemoAcceptee] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let vivant = true
    void app.app.etat.lire('accueil_demo_accepte').then((v) => {
      if (vivant) setDemoAcceptee(v === '1')
    })
    return () => {
      vivant = false
    }
  }, [app, version])

  /**
   * Ouvre le back-office dans le NAVIGATEUR DU SYSTÈME.
   *
   * `window.open(..., '_blank')` : dans une WebView Capacitor, une cible
   * externe est confiée au navigateur de l'appareil. Le code de la caisse
   * reste dans le paquet — ce n'est en rien un `server.url`.
   *
   * `noopener` : la page ouverte ne doit pas pouvoir manipuler celle de la
   * caisse par `window.opener`.
   */
  const ouvrirBackOffice = () => {
    if (!reseau.connecte) {
      setBackOfficeHorsLigne(true)
      return
    }
    window.open(URL_BACKOFFICE, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    let vivant = true
    void app.app.caisse.shiftOuvert().then((s) => {
      if (!vivant) return
      setShift(s)
      // Le shift courant est repris tel quel après un redémarrage : une
      // tablette qui plante en plein service ne perd pas sa caisse.
      void app.app.etat.ecrire('shift_courant', s?.id ?? '')
    })
    return () => {
      vivant = false
    }
  }, [app, version])

  /**
   * Les écrans du tiroir, dans l'ordre où on les ouvre en vrai.
   *
   * « Ventes » d'abord — c'est le retour à la salle, et de loin le lien le
   * plus pressé : un caissier égaré dans Diagnostic avec un client devant lui
   * cherche la sortie, pas une fonction. « Reçus » ensuite, le seul des
   * suivants qu'on ouvre EN SERVICE, pour retrouver un ticket qu'un client
   * réclame. Synchronisation et Diagnostic sont des écrans de dépannage,
   * consultés une fois par semaine ; ils passent après.
   *
   * Un écran déjà ouvert renvoie à la salle plutôt que de ne rien faire :
   * toucher « Reçus » depuis Reçus doit produire quelque chose.
   */
  const bascule = (nom: Vue['nom']) => () =>
    setVue((v) => (v.nom === nom ? { nom: 'salle' } : ({ nom } as Vue)))

  const entreesTiroir: EntreeTiroir[] = [
    {
      cle: 'salle',
      vues: ['salle', 'commande', 'paiement'],
      libelle: 'Ventes',
      icone: ICONES_TIROIR.salle,
      action: () => setVue({ nom: 'salle' }),
    },
    {
      cle: 'recus',
      vues: ['recus'],
      libelle: 'Reçus',
      icone: ICONES_TIROIR.recus,
      action: bascule('recus'),
    },
    {
      cle: 'periodes',
      vues: ['periodes'],
      libelle: 'Périodes de travail',
      icone: ICONES_TIROIR.periodes,
      action: bascule('periodes'),
    },
    {
      cle: 'sync',
      vues: ['sync'],
      libelle: 'Synchronisation',
      icone: ICONES_TIROIR.sync,
      action: bascule('sync'),
    },
    {
      cle: 'diagnostic',
      vues: ['diagnostic'],
      libelle: 'Diagnostic',
      icone: ICONES_TIROIR.diagnostic,
      action: bascule('diagnostic'),
    },
    ...(shift
      ? [
          {
            cle: 'cloture',
            vues: ['cloture' as const],
            libelle: 'Clôturer la caisse',
            icone: ICONES_TIROIR.cloture,
            action: () => setVue({ nom: 'cloture' }),
          },
        ]
      : []),
    /*
      Le seul lien qui SORT de l'application, donc mis à part sous un filet.
      Absent si aucune adresse n'est déclarée pour ce déploiement : un bouton
      qui ouvre une page blanche est pire que pas de bouton.
    */
    ...(URL_BACKOFFICE
      ? [
          {
            cle: 'back-office',
            libelle: 'Back-office',
            icone: ICONES_TIROIR.backOffice,
            action: ouvrirBackOffice,
            sortante: true,
          },
        ]
      : []),
  ]

  const tiroir = (
    <TiroirNavigation
      ouvert={tiroirOuvert}
      vue={vue.nom}
      entrees={entreesTiroir}
      employe={employe?.nom ?? null}
      etablissement={app.etablissement.nom}
      onFermer={() => setTiroirOuvert(false)}
      onVerrouiller={() => definirEmploye(null)}
    />
  )

  /*
   * ── Caisse jamais mise en service ──────────────────────────────────────
   *
   * AVANT la prise de poste, et c'est tout le changement. Une installation
   * fraîche allait droit au clavier PIN, sur les employés de la graine de
   * démonstration : rien ne disait que ce terminal n'était rattaché à aucun
   * établissement, et la mise en service était un écran de plus, caché
   * derrière « Sync ». Le gérant encaissait de vraies ventes sur une caisse
   * qui ne remonterait jamais rien, et il le découvrait en ouvrant un
   * back-office vide.
   *
   * Se connecter APPAIRE : il n'y a plus de « configuration de
   * synchronisation » à faire ensuite, c'est le même geste.
   *
   * `demoAcceptee === undefined` : on ne sait pas encore. On n'affiche rien
   * plutôt que l'accueil, sinon toute caisse en démonstration le verrait
   * clignoter à chaque lancement.
   */
  if (demoAcceptee === undefined) {
    return (
      <div className="ecran-bloquant">
        <div className="pastille-chargement" aria-hidden="true" />
      </div>
    )
  }
  if (!app.sync && !demoAcceptee) {
    return (
      <div className="application">
        <BandeauSimple reseau={reseau} etablissement={false} />
        <main className="contenu">
          <EcranBienvenue onDemonstration={() => setDemoAcceptee(true)} />
        </main>
      </div>
    )
  }

  // ── Terminal verrouillé ────────────────────────────────────────────────
  if (!employe) {
    return (
      <div className="application">
        <BandeauSimple reseau={reseau} />
        <DemandePin
          titre="Prise de poste"
          sousTitre="Qui utilise la caisse ?"
          proposerLHabitue
          onValide={definirEmploye}
        />
      </div>
    )
  }

  if (shift === undefined) {
    return (
      <div className="ecran-bloquant">
        <div className="pastille-chargement" aria-hidden="true" />
      </div>
    )
  }

  // ── Pas de caisse ouverte ──────────────────────────────────────────────
  //
  // Deux écrans restent joignables sans caisse ouverte, et ce n'est pas un
  // confort : ce sont ceux dont on a besoin AVANT de pouvoir encaisser.
  //
  //   • Diagnostic — savoir si la base et le réseau vont bien ;
  //   • Sync — METTRE LE TERMINAL EN SERVICE. C'est le tout premier geste
  //     d'une caisse neuve. L'exiger après une ouverture de caisse revenait
  //     à demander de compter un fond avant d'avoir rattaché la tablette à
  //     son établissement.
  //
  // Le bandeau proposait déjà les deux liens ; seul « Diagnostic » était
  // exempté ici, donc cliquer « Sync » ne changeait rien à l'écran.
  if (!shift && vue.nom !== 'diagnostic' && vue.nom !== 'sync') {
    return (
      <div className="application">
        <Bandeau
          reseau={reseau}
          onOuvrirTiroir={() => setTiroirOuvert(true)}
          onVerrouiller={() => definirEmploye(null)}
          onSync={() => setVue({ nom: 'sync' })}
          impression={etatImpression}
        />
        {tiroir}
        <main className="contenu">
          <EcranOuvertureShift onOuvert={() => setVue({ nom: 'salle' })} />
        </main>
      </div>
    )
  }

  return (
    <div className="application">
      <Bandeau
        reseau={reseau}
        onOuvrirTiroir={() => setTiroirOuvert(true)}
        onVerrouiller={() => definirEmploye(null)}
        onSync={bascule('sync')}
        impression={etatImpression}
      />
      {tiroir}

      <main className="contenu">
        {vue.nom === 'salle' && (
          <EcranSalle
            onOuvrirCommande={(orderId) => setVue({ nom: 'commande', orderId })}
            /*
             * `void` sur une fonction asynchrone passée à un gestionnaire
             * d'événement.
             *
             * Sans lui, la promesse n'est tenue par personne : une ouverture
             * de commande qui échoue — permission refusée, base verrouillée —
             * ne produit AUCUN effet à l'écran. C'est exactement le défaut
             * qui a fait croire que « Suspendre » était cassé, côté
             * back-office : un bouton qui ne dit ni oui ni non se presse
             * trois fois, puis on conclut que le logiciel ne marche pas.
             */
            onNouvelleCommande={(tableId) => void (async () => {
              const orderId = await app.session.ouvrirCommande(employe, {
                type: tableId ? 'dine_in' : 'takeaway',
                tableId,
              })
              app.rafraichir()
              setVue({ nom: 'commande', orderId })
            })()}
          />
        )}

        {vue.nom === 'commande' && (
          <EcranCommande
            orderId={vue.orderId}
            onRetour={() => setVue({ nom: 'salle' })}
            onEncaisser={(orderId) => setVue({ nom: 'paiement', orderId })}
          />
        )}

        {vue.nom === 'paiement' && (
          <EcranPaiement
            orderId={vue.orderId}
            onRetour={() => setVue({ nom: 'commande', orderId: vue.orderId })}
            onTermine={() => setVue({ nom: 'salle' })}
          />
        )}

        {vue.nom === 'cloture' && shift && (
          <EcranClotureShift
            shift={shift}
            onFerme={() => {
              setShift(null)
              definirEmploye(null)
              setVue({ nom: 'salle' })
            }}
            onAnnuler={() => setVue({ nom: 'salle' })}
          />
        )}

        {vue.nom === 'diagnostic' && (
          <EcranDiagnostic contexte={contexte} reseau={reseau} />
        )}

        {vue.nom === 'sync' && <EcranSync />}

        {vue.nom === 'recus' && <EcranRecus onRetour={() => setVue({ nom: 'salle' })} />}

        {vue.nom === 'periodes' && (
          <EcranPeriodes onRetour={() => setVue({ nom: 'salle' })} />
        )}
      </main>

      {backOfficeHorsLigne && (
        <Modale
          titre="Le back-office a besoin d’une connexion"
          onFermer={() => setBackOfficeHorsLigne(false)}
          pied={
            <button type="button" className="principal" onClick={() => setBackOfficeHorsLigne(false)}>
              Revenir à la caisse
            </button>
          }
        >
          <p>
            Cette tablette est hors ligne. Le back-office est un site web : il
            ne s’ouvrira pas tant que la connexion n’est pas revenue.
          </p>
          <p className="indication">
            La caisse, elle, continue de fonctionner normalement — encaissements
            compris. Ce qui attend d’être envoyé partira tout seul au retour du
            réseau.
          </p>
        </Modale>
      )}

    </div>
  )
}

// ─── Bandeaux ───────────────────────────────────────────────────────────────

function IndicateurReseau({ reseau }: { reseau: { connecte: boolean; type: string } }) {
  return (
    <div
      className={`etat-reseau ${reseau.connecte ? 'en-ligne' : 'hors-ligne'}`}
      title={
        reseau.connecte
          ? `Connecté (${reseau.type}) — les ventes seront synchronisées`
          : 'Hors ligne — la caisse fonctionne normalement, la synchronisation reprendra au retour du réseau'
      }
    >
      <span className="point" aria-hidden="true" />
      {reseau.connecte ? 'En ligne' : 'Hors ligne'}
    </div>
  )
}

function BandeauSimple({
  reseau,
  etablissement: montrerEtablissement = true,
}: {
  reseau: { connecte: boolean; type: string }
  /**
   * Faux sur l'écran d'accueil, et ce n'est pas cosmétique.
   *
   * Le nom affiché vient de la graine de DÉMONSTRATION tant que la caisse
   * n'est appairée à rien. Le bandeau annonçait donc « Snack Lac 1 » au-dessus
   * d'un écran qui demande à quel restaurant ce terminal appartient — soit
   * exactement la réponse à la question posée, et elle était fausse.
   */
  etablissement?: boolean
}) {
  const { etablissement } = useApp()
  return (
    <header className="bandeau">
      <div className="bandeau-marque">
        <span className="logo">Kaissi</span>
        {montrerEtablissement && <span className="etablissement">{etablissement.nom}</span>}
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <IndicateurReseau reseau={reseau} />
      </div>
    </header>
  )
}

function Bandeau({
  reseau,
  onOuvrirTiroir,
  onVerrouiller,
  onSync,
  impression,
}: {
  reseau: { connecte: boolean; type: string }
  onOuvrirTiroir: () => void
  onVerrouiller: () => void
  onSync: () => void
  impression: { enAttente: number; echecs: number }
}) {
  const { employe, etablissement, resumeSync, sync, app } = useApp()
  return (
    <header className="bandeau">
      {/*
        Le bouton du tiroir en PREMIER, à gauche, avant la marque : c'est là
        que le pouce le cherche, et c'est là qu'il est au back-office.
      */}
      <button
        type="button"
        className="ouvrir-tiroir"
        onClick={onOuvrirTiroir}
        aria-label="Ouvrir le menu"
      >
        <Menu size={22} strokeWidth={2} aria-hidden="true" />
      </button>

      <div className="bandeau-marque">
        <span className="logo">Kaissi</span>
        <span className="etablissement">{etablissement.nom}</span>
        {/*
          Base en mémoire = « pnpm pos:dev » dans un navigateur. Le catalogue
          vient alors de la graine locale, jamais du serveur : un prix modifié
          au back-office n'arrive PAS ici, et les ventes disparaissent au
          rechargement. Le dire à l'écran évite de chercher une panne là où il
          n'y en a pas — l'information existait, mais enfouie dans Diagnostic.
        */}
        {!app.base.persistant && (
          <span
            className="etiquette-demo"
            title={
              'Base SQLite en mémoire : tout disparaît au rechargement, et le ' +
              'catalogue vient de la graine locale — les modifications faites au ' +
              'back-office n\u2019arrivent pas ici. Seule l\u2019application Android ' +
              'installée se synchronise réellement.'
            }
          >
            démo — mémoire
          </span>
        )}
      </div>

      {/*
        ── Ce qui reste ici est un ÉTAT, jamais une destination ─────────────
        Les écrans sont passés dans le tiroir ; ces trois-là n'y vont pas, et
        ce n'est pas une exception mais la règle qui décide : un état rangé
        derrière un bouton n'est plus un état. « ⚠ À appairer » enfermé dans
        un tiroir ne serait jamais vu — et c'est justement le message qui
        explique pourquoi les ventes n'arrivent pas au back-office.
      */}
      <div className="bandeau-etats">
        {/*
          Le badge « tickets non imprimés » est visible en permanence : un KOT
          resté en file, c'est un plat qui n'arrivera jamais en salle.
        */}
        {IMPRESSION_ACTIVE && (impression.enAttente > 0 || impression.echecs > 0) && (
          <span
            className={`badge-impression ${impression.echecs > 0 ? 'echec' : ''}`}
            title={
              impression.echecs > 0
                ? `${impression.echecs} ticket(s) en échec d'impression`
                : `${impression.enAttente} ticket(s) en attente`
            }
          >
            {/*
              Une icône au TRAIT, pas un emoji.
              Le 🖨 était rendu par la police du système : plat sur Windows,
              en relief sur macOS, absent de certains Android — où il tombait
              en carré vide, sur le badge qui annonce justement une panne
              d'imprimante. Et il ne prenait pas la couleur du texte, donc il
              restait identique que le badge soit en attente ou en échec.
            */}
            {impression.echecs > 0 ? (
              <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Printer size={15} strokeWidth={2} aria-hidden="true" />
            )}{' '}
            {impression.echecs > 0 ? impression.echecs : impression.enAttente}
          </span>
        )}

        {/*
          Badge de synchronisation. Il ne s'affiche que s'il y a quelque
          chose à dire : un badge permanent devient invisible au bout d'une
          journée, et c'est justement celui-là qu'on veut voir.

          Il reste CLIQUABLE et mène à l'écran de synchronisation. Depuis que
          les liens sont dans le tiroir, c'est aussi le raccourci : on touche
          le problème qu'on voit, on ne le cherche pas dans un menu.
        */}
        {(!sync || resumeSync.enAttente > 0 || resumeSync.rejetes > 0 || resumeSync.etat === 'bloque') && (
          <button
            type="button"
            className={`badge-sync ${!sync || resumeSync.rejetes > 0 || resumeSync.etat === 'bloque' ? 'alerte' : ''}`}
            onClick={onSync}
            title={
              !sync
                ? 'Ce terminal n\u2019est relié à aucun compte : ses ventes restent sur ' +
                  'l\u2019appareil et n\u2019arriveront JAMAIS au back-office. Touchez ici pour ' +
                  'l\u2019appairer avec votre e-mail et votre mot de passe.'
                : resumeSync.rejetes > 0
                  ? `${resumeSync.rejetes} opération(s) refusée(s) — votre attention est requise`
                  : `${resumeSync.enAttente} opération(s) en attente d'envoi`
            }
          >
            {/*
              ── « ⇅ local » ne disait rien à personne ──────────────────────
              PANNE OBSERVÉE, sur le premier terminal installé chez le gérant.
              Il passe une commande, ouvre le back-office, ne la voit pas, et
              conclut : « la synchronisation ne marche pas, les deux ne sont
              pas liés ». Le diagnostic était exact et la cause était à
              l'écran — mais le mot « local » la décrivait au lieu de la
              NOMMER, et sans jamais dire quoi faire.

              Un terminal non appairé n'est pas un mode de fonctionnement :
              c'est une installation inachevée. Ses ventes n'arriveront jamais
              nulle part. Le badge le dit donc en toutes lettres, et prend le
              rouge des états qui demandent une action — au même titre qu'un
              rejet de synchronisation.
            */}
            {!sync
              ? '⚠ À appairer'
              : resumeSync.rejetes > 0
                ? `⚠ ${resumeSync.rejetes}`
                : `⇅ ${resumeSync.enAttente}`}
          </button>
        )}

        <button type="button" className="employe" onClick={onVerrouiller}>
          {employe?.nom ?? '—'}
          <small>verrouiller</small>
        </button>
        <IndicateurReseau reseau={reseau} />
      </div>
    </header>
  )
}
