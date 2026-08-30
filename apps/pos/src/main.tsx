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
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch((erreur: unknown) => {
      console.warn("Coque hors ligne indisponible :", erreur)
    })
  })
}

createRoot(racine).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
