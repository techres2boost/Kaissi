/**
 * Réglage TLS de la connexion PostgreSQL.
 *
 * Un seul endroit, parce qu'il y a deux entrées vers la base — le service
 * et le script d'appairage — et qu'elles doivent avoir EXACTEMENT la même
 * politique. Deux réglages divergents, c'est un chemin vérifié et un chemin
 * qui ne l'est pas, sans que personne ne le sache.
 *
 * La vérification du certificat reste active par défaut. Cette connexion
 * transporte l'intégralité des ventes et les empreintes des jetons
 * d'appareil : la désactiver rendrait toute la synchronisation
 * interceptable.
 */

import { readFileSync } from 'node:fs'

export type ReglageSsl = false | { rejectUnauthorized: boolean; ca?: string }

/**
 * `DATABASE_SSL=false`  → aucun TLS. Réservé au Postgres de test local, qui
 *                         n'en a pas. JAMAIS en production.
 * `DATABASE_CA_FILE`    → chemin d'une autorité supplémentaire (certificat
 *                         Supabase, ou celle d'un proxy qui inspecte le
 *                         trafic). La vérification RESTE active.
 */
export function sslDepuisEnvironnement(env = process.env): ReglageSsl {
  if (env['DATABASE_SSL'] === 'false') return false

  const chemin = env['DATABASE_CA_FILE']?.trim()
  if (chemin) {
    // Lue au démarrage : un chemin faux doit faire échouer TOUT DE SUITE,
    // pas à la première synchronisation d'une tablette.
    return { rejectUnauthorized: true, ca: readFileSync(chemin, 'utf8') }
  }

  return { rejectUnauthorized: true }
}
