/**
 * Coque de l'application : démarrage, navigation, bandeau d'état.
 */

import { useEffect, useState } from 'react'
import { demarrer, type ContexteApplication } from './donnees/demarrage.js'
import { useEtatReseau } from './donnees/reseau.js'
import { EcranCaisse } from './ecrans/EcranCaisse.js'
import { EcranDiagnostic } from './ecrans/EcranDiagnostic.js'

type Onglet = 'caisse' | 'diagnostic'

export function Application() {
  const [contexte, setContexte] = useState<ContexteApplication | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [onglet, setOnglet] = useState<Onglet>('caisse')
  const reseau = useEtatReseau()

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
    <div className="application">
      <header className="bandeau">
        <div className="bandeau-marque">
          <span className="logo">Kaissi</span>
          <span className="etablissement">Snack Lac 1</span>
        </div>

        <nav className="onglets">
          <button
            type="button"
            className={onglet === 'caisse' ? 'actif' : ''}
            onClick={() => setOnglet('caisse')}
          >
            Caisse
          </button>
          <button
            type="button"
            className={onglet === 'diagnostic' ? 'actif' : ''}
            onClick={() => setOnglet('diagnostic')}
          >
            Diagnostic
          </button>
        </nav>

        {/*
          L'indicateur réseau INFORME, il ne conditionne rien. Toutes les
          fonctions de caisse restent identiques hors ligne : c'est le
          principe même de l'architecture.
        */}
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
      </header>

      <main className="contenu">
        {onglet === 'caisse' ? (
          <EcranCaisse contexte={contexte} />
        ) : (
          <EcranDiagnostic contexte={contexte} reseau={reseau} />
        )}
      </main>
    </div>
  )
}
