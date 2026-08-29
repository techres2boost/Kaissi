/**
 * Traduction des pannes de connexion à PostgreSQL.
 *
 * Même principe que pour l'impression : le message brut est exact et
 * inutilisable. `SELF_SIGNED_CERT_IN_CHAIN` suivi d'une pile Node ne dit
 * pas quoi faire, et surtout il ne dit pas ce qu'il ne faut PAS faire —
 * désactiver la vérification du certificat. Cette connexion transporte
 * l'intégralité des ventes et les empreintes des jetons d'appareil ; la
 * laisser interceptable n'est pas une option de dépannage.
 */

export interface DiagnosticBase {
  readonly explication: string
  readonly origine: string
}

export function expliquerErreurBase(erreur: unknown): DiagnosticBase {
  const origine = erreur instanceof Error ? erreur.message : String(erreur)
  const code =
    typeof erreur === 'object' && erreur !== null && 'code' in erreur
      ? String((erreur as { code: unknown }).code)
      : ''
  const m = `${code} ${origine}`.toLowerCase()

  if (m.includes('self_signed_cert') || m.includes('self-signed certificate')) {
    return {
      origine,
      explication: [
        "Le certificat TLS du serveur n'est pas reconnu.",
        '',
        "  Deux causes possibles, et la bonne réponse n'est PAS de désactiver",
        '  la vérification : cette connexion transporte toutes les ventes.',
        '',
        '  1. Un antivirus ou un proxy d\'entreprise inspecte le trafic TLS.',
        '     Exporte SON autorité de certification, puis :',
        '       NODE_EXTRA_CA_CERTS=C:\\chemin\\vers\\ca.crt',
        '',
        '  2. Supabase présente une chaîne que Node ne connaît pas.',
        '     Supabase → Project Settings → Database → SSL Configuration',
        '     → « Download certificate ». Puis, dans apps/sync/.env :',
        '       DATABASE_CA_FILE=C:\\chemin\\vers\\prod-ca-2021.crt',
        '',
        '  En DERNIER recours, et jamais en production : DATABASE_SSL=false.',
      ].join('\n'),
    }
  }

  if (m.includes('econnrefused')) {
    return {
      origine,
      explication:
        "La machine répond, mais rien n'écoute sur ce port. Vérifie l'hôte " +
        "et le port de DATABASE_URL (Supabase : session pooler, port 5432).",
    }
  }

  if (m.includes('enotfound') || m.includes('eai_again')) {
    return {
      origine,
      explication:
        "Ce nom d'hôte n'a pas pu être résolu. Vérifie DATABASE_URL — et que " +
        'cette machine a bien accès à Internet.',
    }
  }

  if (m.includes('password authentication failed') || m.includes('28p01')) {
    return {
      origine,
      explication:
        'Mot de passe refusé. Attention aux caractères qui cassent une URL : ' +
        "? # / % @ : et l'espace doivent être encodés, ou remplacés.",
    }
  }

  if (m.includes('etimedout') || m.includes('timeout')) {
    return {
      origine,
      explication:
        "Le serveur n'a pas répondu à temps. Un pare-feu bloque peut-être le " +
        'port 5432 sortant.',
    }
  }

  return { origine, explication: '' }
}

/** Bloc prêt à afficher dans un terminal. */
export function formaterErreurBase(erreur: unknown): string {
  const { explication, origine } = expliquerErreurBase(erreur)
  return explication ? `${explication}\n\n  Message d'origine : ${origine}` : origine
}
