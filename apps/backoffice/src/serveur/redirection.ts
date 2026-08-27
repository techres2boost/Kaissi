/**
 * Filtrage des destinations de redirection.
 *
 * Après connexion, on renvoie l'utilisateur là où il allait. Cette
 * destination vient d'un paramètre d'URL — donc de l'extérieur, et
 * potentiellement d'un lien qu'on lui a envoyé.
 */

import type { Route } from 'next'

/**
 * Ne garde qu'un chemin interne à ce site.
 *
 * Le piège : « commence par une barre » ne suffit pas. « //evil.tn » commence
 * par une barre et est une URL PROTOCOL-RELATIVE — le navigateur y voit un
 * autre domaine. Un gérant fraîchement authentifié atterrirait sur un site
 * tiers, avec l'impression d'être encore chez lui. C'est exactement le
 * scénario d'une redirection ouverte.
 */
export function destinationSure(demande: string): Route {
  const propre = demande.trim()
  if (!propre.startsWith('/')) return '/'
  // « // » et « /\ » sont tous deux interprétés comme protocol-relative par
  // les navigateurs ; ne filtrer que le premier laisserait la porte ouverte.
  if (propre.startsWith('//') || propre.startsWith('/\\')) return '/'
  return propre as Route
}
