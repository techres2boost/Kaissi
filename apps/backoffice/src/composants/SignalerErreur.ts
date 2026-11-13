'use client'

import { useEffect } from 'react'
import { signalerErreurEcran } from '../serveur/signaler-erreur.js'

/**
 * Prévient le service UNE fois par erreur et par onglet. « Réessayer » qui
 * retombe sur la même erreur ne la renvoie pas : `sessionStorage` retient
 * ce qui est déjà parti.
 */
export function useSignalerErreur(error: Error & { digest?: string }): void {
  useEffect(() => {
    const chemin = window.location.pathname
    const cle = `kaissi.erreur.${error.digest ?? error.message.slice(0, 80)}.${chemin}`
    try {
      if (window.sessionStorage.getItem(cle)) return
      window.sessionStorage.setItem(cle, '1')
    } catch {
      // Stockage interdit : on envoie quand même, une fois par rendu.
    }
    void signalerErreurEcran({ chemin, digest: error.digest ?? null, message: error.message ?? '' })
  }, [error])
}
