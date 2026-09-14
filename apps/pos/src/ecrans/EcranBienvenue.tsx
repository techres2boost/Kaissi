/**
 * Le premier écran d'une caisse neuve.
 *
 * ── Ce qui s'affichait avant, et pourquoi c'était faux ────────────────────
 *
 * Une installation fraîche allait DROIT à la prise de poste, sur les employés
 * de la graine de démonstration. Rien ne disait que ce terminal n'était
 * rattaché à aucun établissement ; la mise en service était un écran de plus,
 * caché derrière « Sync », qu'il fallait savoir ouvrir. Le gérant encaissait
 * donc de vraies ventes sur une caisse qui ne remonterait jamais rien — et il
 * ne le découvrait qu'en ouvrant le back-office, vide.
 *
 * ── Ce que l'écran fait, et ce qu'il ne fait pas ──────────────────────────
 *
 * Il pose la question dans l'ordre où elle se pose vraiment : ce terminal
 * appartient-il à un restaurant qui existe déjà, ou à un restaurant qu'on
 * ouvre aujourd'hui ? Se connecter APPAIRE — il n'y a plus de « configuration
 * de synchronisation » à faire ensuite, c'est le même geste.
 *
 * La troisième voie, « Découvrir sans compte », n'est pas une concession :
 * c'est le parcours commercial réel — on montre le POS au restaurateur, puis
 * on le met en service. La rendre EXPLICITE plutôt que de la déduire d'un
 * indice (base en mémoire, variable de build) a deux vertus : la personne sait
 * ce qu'elle choisit, et l'écran d'accueil passe sous les tests de bout en
 * bout au lieu d'être contourné par eux.
 */

import { useState } from 'react'
import { LogIn, Store } from 'lucide-react'
import { useApp } from '../etat/contexte.js'
import { FormulaireAppairage } from './EcranSync.js'
import { FormulaireInscription } from '../composants/FormulaireInscription.js'

export function EcranBienvenue({ onDemonstration }: { onDemonstration: () => void }) {
  const { app, rafraichir } = useApp()
  const [voie, setVoie] = useState<'choix' | 'connexion' | 'creation'>('choix')

  const accepterDemonstration = () => {
    void (async () => {
      await app.etat.ecrire('accueil_demo_accepte', '1')
      onDemonstration()
    })()
  }

  if (voie === 'connexion') {
    return (
      <div className="bienvenue">
        <button type="button" className="retour-accueil" onClick={() => setVoie('choix')}>
          ‹ Retour
        </button>
        <FormulaireAppairage onAppaire={rafraichir} />
      </div>
    )
  }

  if (voie === 'creation') {
    return (
      <div className="bienvenue">
        <button type="button" className="retour-accueil" onClick={() => setVoie('choix')}>
          ‹ Retour
        </button>
        <FormulaireInscription
          onInscrit={onDemonstration}
          onDejaUnCompte={() => setVoie('connexion')}
        />
      </div>
    )
  }

  return (
    <div className="bienvenue">
      <div className="bienvenue-marque">
        <span className="logo">Kaissi</span>
        <span className="signature">Caisse et gestion de restaurant</span>
      </div>

      <section className="carte-action">
        {/* Pas « Mettre cette caisse en service » : c'est le titre du
            formulaire qui suit, et répéter le même titre sur deux écrans
            enchaînés donne l'impression de n'avoir pas avancé. */}
        <h1>À quel restaurant appartient cette caisse ?</h1>
        <p>
          Connectez-vous avec le compte du restaurant. Ce terminal recevra son
          identité tout seul — il n'y a aucun code à recopier, et rien d'autre à
          régler ensuite.
        </p>

        <button type="button" className="principal" onClick={() => setVoie('connexion')}>
          <LogIn size={18} strokeWidth={2} aria-hidden="true" /> Se connecter
        </button>

        <button type="button" onClick={() => setVoie('creation')}>
          <Store size={18} strokeWidth={2} aria-hidden="true" /> Créer un compte
        </button>
      </section>

      {/*
        En bas, discret, et NOMMÉ pour ce qu'il est. « Continuer » ou « Plus
        tard » laisseraient croire à un report anodin ; ce qu'on choisit ici,
        c'est une caisse dont les ventes ne quitteront jamais l'appareil.
      */}
      <button type="button" className="lien-discret" onClick={accepterDemonstration}>
        Découvrir sans compte — les ventes resteront sur cet appareil
      </button>
    </div>
  )
}
