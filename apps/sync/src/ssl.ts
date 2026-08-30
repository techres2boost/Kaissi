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
 * `DATABASE_CA`         → le CONTENU PEM d'une autorité supplémentaire,
 *                         collé directement dans la variable. C'est la forme
 *                         qui convient à un conteneur (Railway, Render, Fly) :
 *                         un chemin de fichier n'y désigne rien.
 * `DATABASE_CA_FILE`    → un CHEMIN vers ce même certificat. Pratique en
 *                         local (« C:\…\prod-ca-2021.crt »), inutilisable
 *                         dans un conteneur où ce fichier n'existe pas.
 *
 * Les deux coexistent ; `DATABASE_CA` l'emporte s'il est renseigné. Dans les
 * deux cas la vérification RESTE active.
 *
 * L'autorité est AJOUTÉE aux racines de confiance de Node, elle ne les
 * REMPLACE pas. C'est le piège de l'option `ca` de Node : la passer seule
 * ferait que Node ne fait plus confiance qu'à ELLE, et une connexion qui
 * marchait par la chaîne publique casserait. On concatène donc avec
 * `rootCertificates` — le comportement de NODE_EXTRA_CA_CERTS, mais ciblé
 * sur cette seule connexion.
 */
export function sslDepuisEnvironnement(env = process.env): ReglageSsl {
  if (env['DATABASE_SSL'] === 'false') return false

  // Le CONTENU d'abord : c'est la forme qui traverse un conteneur.
  const contenuBrut = env['DATABASE_CA']?.trim()
  if (contenuBrut) {
    // Certaines interfaces (dont Railway, selon le mode de saisie) aplatissent
    // les sauts de ligne en « \n » littéraux. Un PEM sans vrais retours à la
    // ligne est refusé par OpenSSL : s'il n'y a AUCUN vrai retour à la ligne,
    // on interprète les « \n » littéraux comme des sauts de ligne.
    const contenu = contenuBrut.includes('\n')
      ? contenuBrut
      : contenuBrut.replace(/\\n/g, '\n')
    if (!contenu.includes('BEGIN CERTIFICATE')) {
      throw new ErreurCertificat(
        'DATABASE_CA ne ressemble pas à un certificat PEM : il doit contenir\n' +
          '  la ligne « -----BEGIN CERTIFICATE----- ». Colle le CONTENU du\n' +
          '  fichier prod-ca-2021.crt, pas son chemin (ça, c’est DATABASE_CA_FILE).',
      )
    }
    return { rejectUnauthorized: true, ca: [...rootCertificates, contenu] }
  }

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
          "  Ce chemin est lu SUR LA MACHINE qui exécute le service. Dans un\n" +
          '  conteneur (Railway, Render, Fly), un chemin Windows ne désigne\n' +
          '  rien : colle plutôt le CONTENU du certificat dans DATABASE_CA.\n\n' +
          "  En local, vérifie le chemin exact (attention aux antislashs), ou\n" +
          '  retire la ligne si tu ne sais pas quoi y mettre.',
      )
    }
    return { rejectUnauthorized: true, ca: [...rootCertificates, contenu] }
  }

  return { rejectUnauthorized: true }
}
