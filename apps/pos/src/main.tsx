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
import './styles.css'

const racine = document.getElementById('racine')
if (!racine) throw new Error('Élément racine introuvable dans index.html')

createRoot(racine).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
