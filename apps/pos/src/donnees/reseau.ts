/**
 * Indicateur d'état réseau.
 *
 * Sa SEULE fonction est d'informer l'utilisateur. Aucun écran, aucune
 * fonction de caisse ne doit conditionner son comportement à cette valeur :
 * le POS travaille toujours en local, le réseau ne sert qu'à se réconcilier.
 */

import { useEffect, useState } from 'react'

export interface EtatReseau {
  readonly connecte: boolean
  readonly type: string
}

export function useEtatReseau(): EtatReseau {
  const [etat, setEtat] = useState<EtatReseau>({
    connecte: typeof navigator !== 'undefined' ? navigator.onLine : false,
    type: 'inconnu',
  })

  useEffect(() => {
    let vivant = true
    let retirer: (() => void) | undefined

    const majDepuisNavigateur = () => {
      if (vivant) setEtat({ connecte: navigator.onLine, type: 'navigateur' })
    }

    void (async () => {
      try {
        const { Network } = await import('@capacitor/network')
        const statut = await Network.getStatus()
        if (vivant) setEtat({ connecte: statut.connected, type: statut.connectionType })
        const ecouteur = await Network.addListener('networkStatusChange', (s) => {
          if (vivant) setEtat({ connecte: s.connected, type: s.connectionType })
        })
        retirer = () => void ecouteur.remove()
      } catch {
        // Pas de plugin natif (navigateur de développement) : repli.
        majDepuisNavigateur()
        window.addEventListener('online', majDepuisNavigateur)
        window.addEventListener('offline', majDepuisNavigateur)
        retirer = () => {
          window.removeEventListener('online', majDepuisNavigateur)
          window.removeEventListener('offline', majDepuisNavigateur)
        }
      }
    })()

    return () => {
      vivant = false
      retirer?.()
    }
  }, [])

  return etat
}
