/**
 * Coque de l'application : démarrage, verrouillage, navigation, bandeau d'état.
 *
 * L'enchaînement des écrans suit celui d'une vraie journée :
 *   verrouillé → prise de poste (PIN) → ouverture de caisse →
 *   salle → commande → encaissement → … → clôture de caisse
 */

import { useEffect, useState } from 'react'
import { Printer, TriangleAlert } from 'lucide-react'
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

type Vue =
  | { nom: 'salle' }
  | { nom: 'commande'; orderId: string }
  | { nom: 'paiement'; orderId: string }
  | { nom: 'cloture' }
  | { nom: 'diagnostic' }
  | { nom: 'sync' }
  | { nom: 'recus' }
  | { nom: 'periodes' }

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

  // ── Terminal verrouillé ────────────────────────────────────────────────
  if (!employe) {
    return (
      <div className="application">
        <BandeauSimple reseau={reseau} />
        <DemandePin
          titre="Prise de poste"
          sousTitre="Qui utilise la caisse ?"
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
          shift={null}
          vue={vue.nom}
          onSalle={() => setVue({ nom: 'salle' })}
          onVerrouiller={() => definirEmploye(null)}
          onDiagnostic={() => setVue({ nom: 'diagnostic' })}
          onCloturer={() => setVue({ nom: 'cloture' })}
          onSync={() => setVue({ nom: 'sync' })}
          onRecus={() => setVue({ nom: 'recus' })}
          onPeriodes={() => setVue({ nom: 'periodes' })}
          onBackOffice={ouvrirBackOffice}
          impression={etatImpression}
        />
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
        shift={shift}
        vue={vue.nom}
        onSalle={() => setVue({ nom: 'salle' })}
        onVerrouiller={() => definirEmploye(null)}
        onDiagnostic={() =>
          setVue((v) => (v.nom === 'diagnostic' ? { nom: 'salle' } : { nom: 'diagnostic' }))
        }
        onCloturer={() => setVue({ nom: 'cloture' })}
        onSync={() =>
          setVue((v) => (v.nom === 'sync' ? { nom: 'salle' } : { nom: 'sync' }))
        }
        onRecus={() =>
          setVue((v) => (v.nom === 'recus' ? { nom: 'salle' } : { nom: 'recus' }))
        }
        onPeriodes={() =>
          setVue((v) => (v.nom === 'periodes' ? { nom: 'salle' } : { nom: 'periodes' }))
        }
        onBackOffice={ouvrirBackOffice}
        impression={etatImpression}
      />

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

function BandeauSimple({ reseau }: { reseau: { connecte: boolean; type: string } }) {
  const { etablissement } = useApp()
  return (
    <header className="bandeau">
      <div className="bandeau-marque">
        <span className="logo">Kaissi</span>
        <span className="etablissement">{etablissement.nom}</span>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <IndicateurReseau reseau={reseau} />
      </div>
    </header>
  )
}

function Bandeau({
  reseau,
  shift,
  vue,
  onSalle,
  onVerrouiller,
  onDiagnostic,
  onCloturer,
  onSync,
  onRecus,
  onPeriodes,
  onBackOffice,
  impression,
}: {
  reseau: { connecte: boolean; type: string }
  shift: Shift | null
  vue: Vue['nom']
  onSalle: () => void
  onVerrouiller: () => void
  onDiagnostic: () => void
  onCloturer: () => void
  onSync: () => void
  onRecus: () => void
  onPeriodes: () => void
  onBackOffice: () => void
  impression: { enAttente: number; echecs: number }
}) {
  const { employe, etablissement, resumeSync, sync, app } = useApp()
  return (
    <header className="bandeau">
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
              'back-office n’arrivent pas ici. Seule l’application Android ' +
              'installée se synchronise réellement.'
            }
          >
            démo — mémoire
          </span>
        )}
      </div>

      <div className="bandeau-actions">
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
        */}
        {(!sync || resumeSync.enAttente > 0 || resumeSync.rejetes > 0 || resumeSync.etat === 'bloque') && (
          <button
            type="button"
            className={`badge-sync ${!sync || resumeSync.rejetes > 0 || resumeSync.etat === 'bloque' ? 'alerte' : ''}`}
            onClick={onSync}
            title={
              !sync
                ? 'Ce terminal n’est relié à aucun compte : ses ventes restent sur ' +
                  'l’appareil et n’arriveront JAMAIS au back-office. Touchez ici pour ' +
                  'l’appairer avec votre e-mail et votre mot de passe.'
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

        {/*
          Retour à la salle, toujours à la même place. Depuis Diagnostic ou
          l'écran de synchronisation, il n'y avait aucun chemin de retour
          évident : le caissier rechargeait la page.
        */}
        {vue !== 'salle' && (
          <button type="button" className="lien" onClick={onSalle}>
            Salle
          </button>
        )}

        {/*
          Accès PERMANENT à l'écran de synchronisation. Le badge ci-dessus ne
          s'affiche que s'il a quelque chose à dire — donc, terminal appairé
          et outbox vide, il disparaît, et avec lui le seul chemin vers cet
          écran. C'est exactement quand tout va bien qu'on cherche à vérifier
          que tout va bien.
        */}
        {/*
          `data-actif` marque l'écran COURANT.
          Les quatre liens se ressemblaient trait pour trait, quel que soit
          l'endroit où l'on se trouvait : depuis Diagnostic, rien ne disait
          qu'on y était — sinon le contenu, qu'il faut lire. La charte pose un
          trait terracotta sous l'onglet courant, exactement comme la colonne
          du back-office pose une barre à gauche du sien.
        */}
        {/*
          « Reçus » est posé AVANT « Sync » et « Diagnostic » : c'est le seul
          des trois qu'un caissier ouvre en service — retrouver un ticket
          pour un client qui réclame. Les deux autres sont des écrans de
          dépannage, consultés une fois par semaine.
        */}
        <button
          type="button"
          className="lien"
          data-actif={vue === 'recus'}
          onClick={onRecus}
        >
          Reçus
        </button>

        <button
          type="button"
          className="lien"
          data-actif={vue === 'periodes'}
          onClick={onPeriodes}
        >
          Périodes
        </button>

        <button
          type="button"
          className="lien"
          data-actif={vue === 'sync'}
          onClick={onSync}
        >
          Sync
        </button>

        <button
          type="button"
          className="lien"
          data-actif={vue === 'diagnostic'}
          onClick={onDiagnostic}
        >
          Diagnostic
        </button>
        {shift && (
          <button
            type="button"
            className="lien"
            data-actif={vue === 'cloture'}
            onClick={onCloturer}
          >
            Clôturer
          </button>
        )}
        {/*
          Le seul bouton qui SORT de l'application — d'où sa place, en
          dernier, et son libellé explicite. Il ouvre le navigateur du
          système : rien de ce qui s'affiche alors n'est Kaissi, et la caisse
          continue de tourner derrière avec son code empaqueté.

          Absent si aucune adresse n'est déclarée pour ce déploiement : un
          bouton qui ouvre une page blanche est pire que pas de bouton.
        */}
        {URL_BACKOFFICE && (
          <button type="button" className="lien" onClick={onBackOffice}>
            Back-office ↗
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
