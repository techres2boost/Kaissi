/**
 * Point d'entrée du terminal de caisse.
 *
 * Le bundle produit ici est EMPAQUETÉ dans l'APK. Il ne charge aucun script
 * distant, ne contacte aucun serveur au démarrage, et n'embarque aucune clé
 * Supabase : le POS ne connaîtra que l'URL de son API de synchronisation,
 * et seulement à partir de la Phase 2.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Application } from './Application.js'
import { CIBLE_WEB } from './config.js'
import './styles.css'

const racine = document.getElementById('racine')
if (!racine) throw new Error('Élément racine introuvable dans index.html')

/*
 * Cible web : on met la COQUE en cache pour que la caisse s'ouvre sans
 * réseau. C'est la traduction, pour un navigateur, de la règle qui interdit
 * de charger le code de l'application depuis le réseau.
 *
 * L'échec de l'enregistrement n'est PAS bloquant : sans service worker la
 * caisse fonctionne encore, elle perd seulement le démarrage hors ligne. La
 * faire échouer ici la rendrait inutilisable pour une raison secondaire.
 */
if (CIBLE_WEB && 'serviceWorker' in navigator) {
  /*
   * Une NOUVELLE version prend la main → on recharge, une seule fois.
   *
   * Sans cela, l'onglet déjà ouvert continue d'exécuter le bundle qu'il a
   * chargé au démarrage, même après l'installation d'un service worker plus
   * récent. Sur une tablette de caisse, l'onglet n'est jamais fermé : la
   * correction n'arriverait qu'au prochain redémarrage de la tablette, donc
   * peut-être jamais.
   *
   * `avaitUnControleur` évite un rechargement gratuit à la PREMIÈRE visite,
   * où `clients.claim()` déclenche aussi cet évènement alors que la page
   * exécute déjà la bonne version.
   */
  const avaitUnControleur = Boolean(navigator.serviceWorker.controller)
  let rechargementEnCours = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitUnControleur || rechargementEnCours) return
    rechargementEnCours = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('./sw.js')
      .then((enregistrement) => {
        // Le navigateur ne cherche une mise à jour qu'à la navigation, et au
        // plus une fois par jour. Une caisse dont l'onglet reste ouvert une
        // semaine ne naviguerait jamais : on le lui demande explicitement au
        // démarrage, puis toutes les heures.
        void enregistrement.update()
        setInterval(() => void enregistrement.update(), 60 * 60 * 1000)
      })
      .catch((erreur: unknown) => {
        console.warn("Coque hors ligne indisponible :", erreur)
      })
  })
}

createRoot(racine).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
