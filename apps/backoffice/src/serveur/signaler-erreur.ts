'use server'

/**
 * La page d'erreur du back-office prévient le centre de supervision.
 *
 * Elle ne doit JAMAIS échouer à son tour, ni rediriger : on est déjà sur la
 * page qui dit « ça n'a pas marché ». Sans session (page de connexion), on
 * n'envoie rien — le service n'accepte que des comptes connectés, et une
 * route ouverte à tous serait une porte pour remplir le journal.
 */

import { appelerService } from './service-sync.js'

export async function signalerErreurEcran(e: {
  chemin: string
  digest: string | null
  message: string
}): Promise<void> {
  try {
    await appelerService('/admin/erreur-ecran', {
      chemin: e.chemin.slice(0, 200),
      digest: e.digest,
      // Une erreur SERVEUR n'a qu'un message générique en production : seul
      // son `digest` la relie à la trace de Vercel. Le message n'est utile
      // que pour une erreur de rendu CLIENT.
      message: e.digest ? '' : e.message.slice(0, 300),
    })
  } catch {
    // Rien : c'est un diagnostic, pas une fonction.
  }
}
