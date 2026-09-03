/**
 * Coque de l'application : démarrage, verrouillage, navigation, bandeau d'état.
 *
 * L'enchaînement des écrans suit celui d'une vraie journée :
 *   verrouillé → prise de poste (PIN) → ouverture de caisse →
 *   salle → commande → encaissement → … → clôture de caisse
 */

import { useEffect, useState } from 'react'
import type { Shift } from '@kaissi/domain'
import { IMPRESSION_ACTIVE } from './config.js'
import { demarrer, type ContexteApplication } from './donnees/demarrage.js'
import { useEtatReseau } from './donnees/reseau.js'
import { FournisseurApp, useApp } from './etat/contexte.js'
import { DemandePin } from './composants/DemandePin.js'
import { EcranSalle } from './ecrans/EcranSalle.js'
import { EcranCommande } from './ecrans/EcranCommande.js'
import { EcranPaiement } from './ecrans/EcranPaiement.js'
import { EcranClotureShift, EcranOuvertureShift } from './ecrans/EcranShift.js'
import { EcranDiagnostic } from './ecrans/EcranDiagnostic.js'
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

function Terminal({ contexte }: { contexte: ContexteApplication }) {
  const app = useApp()
  const { employe, definirEmploye, etatImpression, version } = app
  const reseau = useEtatReseau()

  const [shift, setShift] = useState<Shift | null | undefined>(undefined)
  const [vue, setVue] = useState<Vue>({ nom: 'salle' })

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
  if (!shift && vue.nom !== 'diagnostic') {
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
        impression={etatImpression}
      />

      <main className="contenu">
        {vue.nom === 'salle' && (
          <EcranSalle
            onOuvrirCommande={(orderId) => setVue({ nom: 'commande', orderId })}
            onNouvelleCommande={async (tableId) => {
              const orderId = await app.session.ouvrirCommande(employe, {
                type: tableId ? 'dine_in' : 'takeaway',
                tableId,
              })
              app.rafraichir()
              setVue({ nom: 'commande', orderId })
            }}
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
      </main>
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
            {impression.echecs > 0 ? '⚠' : '🖨'}{' '}
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
            className={`badge-sync ${resumeSync.rejetes > 0 || resumeSync.etat === 'bloque' ? 'alerte' : ''}`}
            onClick={onSync}
            title={
              !sync
                ? 'Terminal non appairé — la caisse fonctionne en local'
                : resumeSync.rejetes > 0
                  ? `${resumeSync.rejetes} opération(s) refusée(s) — votre attention est requise`
                  : `${resumeSync.enAttente} opération(s) en attente d'envoi`
            }
          >
            {!sync ? '⇅ local' : resumeSync.rejetes > 0 ? `⚠ ${resumeSync.rejetes}` : `⇅ ${resumeSync.enAttente}`}
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
        <button type="button" className="lien" onClick={onSync}>
          Sync
        </button>

        <button type="button" className="lien" onClick={onDiagnostic}>
          Diagnostic
        </button>
        {shift && (
          <button type="button" className="lien" onClick={onCloturer}>
            Clôturer
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
