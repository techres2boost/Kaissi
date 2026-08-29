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
import { rootCertificates } from 'node:tls'

export type ReglageSsl = false | { rejectUnauthorized: boolean; ca?: string | string[] }

export class ErreurCertificat extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurCertificat'
  }
}

/**
 * `DATABASE_SSL=false`  → aucun TLS. Réservé au Postgres de test local, qui
 *                         n'en a pas. JAMAIS en production.
 * `DATABASE_CA_FILE`    → chemin d'une autorité supplémentaire (certificat
 *                         Supabase, ou celle d'un antivirus qui inspecte le
 *                         trafic). La vérification RESTE active.
 *
 * L'autorité du fichier est AJOUTÉE aux racines de confiance de Node, elle
 * ne les REMPLACE pas. C'est le piège de l'option `ca` de Node : la passer
 * seule ferait que Node ne fait plus confiance qu'à ELLE, et une connexion
 * qui marchait par la chaîne publique casserait. On concatène donc avec
 * `rootCertificates` — le comportement de NODE_EXTRA_CA_CERTS, mais ciblé
 * sur cette seule connexion.
 */
export function sslDepuisEnvironnement(env = process.env): ReglageSsl {
  if (env['DATABASE_SSL'] === 'false') return false

  const chemin = env['DATABASE_CA_FILE']?.trim()
  if (chemin) {
    let contenu: string
    try {
      // Lue au démarrage : un chemin faux doit faire échouer TOUT DE SUITE,
      // avec un message clair, pas à la première synchronisation d'une
      // tablette avec un ENOENT brut.
      contenu = readFileSync(chemin, 'utf8')
    } catch (erreur) {
      const cause = erreur instanceof Error ? erreur.message : String(erreur)
      throw new ErreurCertificat(
        `DATABASE_CA_FILE pointe vers un fichier illisible :\n    ${chemin}\n\n` +
          `  ${cause}\n\n` +
          "  Vérifie le chemin exact (attention aux antislashs Windows), ou\n" +
          '  retire la ligne DATABASE_CA_FILE si tu ne sais pas quoi y mettre.',
      )
    }
    return { rejectUnauthorized: true, ca: [...rootCertificates, contenu] }
  }

  return { rejectUnauthorized: true }
}
