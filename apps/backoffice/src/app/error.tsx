'use client'

/**
 * Ce qu'un gérant voit quand une page casse.
 *
 * ── Ce qu'il voyait avant ─────────────────────────────────────────────────
 *
 * « Application error: a server-side exception has occurred (see the server
 * logs for more information). Digest: 857891440 ». En anglais, sans issue,
 * sans bouton, sans indication de ce qu'il faut faire — et « voir les
 * journaux du serveur » s'adresse à quelqu'un qui n'est pas là. C'est
 * exactement l'écran qu'un client a rencontré, en plein service.
 *
 * ── Ce que celui-ci fait de plus ──────────────────────────────────────────
 *
 * Il dit trois choses, dans cet ordre : que les données ne sont pas perdues
 * — c'est la première inquiétude devant un écran de caisse cassé —, ce qu'on
 * peut faire tout de suite, et le code à communiquer au support. Le
 * `digest` reste affiché : c'est lui qui relie l'écran à la trace serveur,
 * et sans lui le support cherche à l'aveugle.
 *
 * ── Ce qu'il ne fait PAS ──────────────────────────────────────────────────
 *
 * Afficher `error.message`. En production, Next.js le remplace déjà par un
 * message générique pour ne pas divulguer la structure interne ; en
 * développement, l'afficher ici masquerait la vraie pile d'appels de la
 * console. Dans les deux cas, il n'apprend rien à qui lit.
 */

import { useEffect } from 'react'

export default function ErreurEcran({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    /*
     * Le journal du NAVIGATEUR, en plus de celui du serveur.
     *
     * Une erreur de rendu client ne laisse aucune trace côté serveur : sans
     * cette ligne, elle n'existe nulle part. C'est aussi le point de
     * branchement d'un collecteur (Sentry) le jour où il sera posé.
     */
    console.error('[kaissi] écran en erreur', { digest: error.digest, message: error.message })
  }, [error])

  return (
    <main className="enveloppe">
      <section className="carte">
        <h1>Cette page n’a pas pu s’afficher</h1>
        <p className="message avertissement">
          <strong>Vos données ne sont pas perdues.</strong> Aucune vente, aucun
          réglage n’a été modifié : c’est l’affichage qui a échoué, pas
          l’enregistrement.
        </p>

        <p>Ce que vous pouvez faire, dans l’ordre :</p>
        <ol>
          <li>
            <button type="button" className="principal" onClick={() => reset()}>
              Réessayer
            </button>{' '}
            — une coupure réseau passagère suffit à provoquer cet écran.
          </li>
          <li>
            Choisir une <strong>période plus courte</strong> si vous étiez sur un
            rapport : une période très longue peut dépasser ce qu’une page peut
            charger.
          </li>
          <li>
            Revenir à l’<a href="/">accueil</a>, puis rouvrir l’écran.
          </li>
        </ol>

        {error.digest && (
          <p className="indication">
            Si cela se reproduit, communiquez ce code au support — c’est lui qui
            relie cet écran à la trace enregistrée côté serveur :{' '}
            <code className="mono">{error.digest}</code>
          </p>
        )}
      </section>
    </main>
  )
}
