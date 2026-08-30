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

/**
 * Ce que la configuration a réellement tenté, pour ne pas conseiller un
 * remède qui ne s'applique pas.
 */
export interface ContexteConnexion {
  /** Vrai si le mot de passe vient de DATABASE_PASSWORD, hors de l'URL. */
  readonly motDePasseSepare?: boolean
  /** L'utilisateur envoyé au serveur. Une faute ici rend la même erreur. */
  readonly utilisateur?: string
}

export function expliquerErreurBase(
  erreur: unknown,
  contexte: ContexteConnexion = {},
): DiagnosticBase {
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
        "  Le pooler Supabase présente un certificat signé par SA PROPRE",
        '  autorité, que Node ne connaît pas. La réponse n\'est PAS de',
        '  désactiver la vérification : cette connexion transporte toutes les',
        '  ventes. Il faut donner ce certificat à Node.',
        '',
        '  Récupère-le : Supabase → Project Settings → Database → SSL',
        '  Configuration → « Download certificate » (prod-ca-2021.crt).',
        '',
        '  ▸ Dans un CONTENEUR (Railway, Render, Fly) — ton cas ici :',
        '    un CHEMIN de fichier ne désigne rien dans le conteneur. Ouvre le',
        '    .crt dans un éditeur de texte, copie tout son contenu, et colle-le',
        '    dans une variable  DATABASE_CA  (le contenu, pas le chemin).',
        '',
        '  ▸ En LOCAL, un chemin suffit, dans apps/sync/.env :',
        '       DATABASE_CA_FILE=C:\\chemin\\vers\\prod-ca-2021.crt',
        '',
        '  Autre cause possible en local : un antivirus ou un proxy',
        '  d\'entreprise inspecte le trafic TLS. Alors c\'est SON autorité',
        '  qu\'il faut fournir de la même façon.',
        '',
        '  En DERNIER recours, et jamais en production : DATABASE_SSL=false.',
      ].join('\n'),
    }
  }

  // ENETUNREACH / EHOSTUNREACH : aucune route vers l’adresse. Sur Railway,
  // Render ou Fly, c’est presque toujours la connexion DIRECTE de Supabase,
  // qui ne résout plus qu’en IPv6 alors que ces plateformes n’ont pas de
  // sortie IPv6. Le message brut (une adresse « 2a05:… ») ne dit rien de
  // tout cela, et pousse à chercher un pare-feu qui n’existe pas.
  if (m.includes('enetunreach') || m.includes('ehostunreach')) {
    const ipv6 = /connect e(net|host)unreach [0-9a-f]*:[0-9a-f]*:/i.test(origine)
    return {
      origine,
      explication: [
        "Aucune route réseau vers l'adresse de la base." +
          (ipv6 ? ' Elle a été jointe en IPv6.' : ''),
        '',
        "  C'est le piège Supabase + Railway/Render/Fly le plus courant :",
        "  la connexion DIRECTE « db.<ref>.supabase.co » ne résout plus qu'en",
        "  IPv6, et ces plateformes n'ont pas de sortie IPv6. La connexion",
        "  échoue donc avant même d'atteindre le serveur.",
        '',
        "  La solution n'est PAS d'activer IPv6 : utilise le SESSION POOLER,",
        "  qui répond en IPv4. Dans DATABASE_URL, l'hôte doit être",
        '      aws-0-<région>.pooler.supabase.com     (port 5432)',
        "  et l'utilisateur   postgres.<ref>   — et non « postgres » seul.",
        '',
        '  Supabase → bouton « Connect » → onglet « Session pooler »',
        "  (ni « Direct connection », ni la chaîne « DIRECT_URL » de Prisma).",
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
    const utilisateur = contexte.utilisateur
      ? `\n\n  Utilisateur envoyé : ${contexte.utilisateur}\n` +
        '  (Supabase le rapporte tronqué à « postgres » — c\'est normal.)'
      : ''

    // Avec DATABASE_PASSWORD, le mot de passe n'a traversé AUCUNE URL. Lui
    // reparler d'encodage l'enverrait chercher là où il n'y a rien : c'est
    // exactement le remède qu'il vient d'appliquer.
    if (contexte.motDePasseSepare) {
      return {
        origine,
        explication:
          'Mot de passe refusé par le serveur.\n\n' +
          "  L'encodage n'est PAS en cause : DATABASE_PASSWORD ne traverse\n" +
          '  aucune URL, sa valeur part telle quelle. Le serveur dit donc\n' +
          "  simplement que ce mot de passe n'est pas le sien.\n\n" +
          '  ⚠ Supabase a DEUX mots de passe, et ils se confondent facilement :\n' +
          '      • celui du COMPTE — pour se connecter à supabase.com.\n' +
          "        Son écran réclame le mot de passe ACTUEL. Ce n'est pas lui.\n" +
          '      • celui de la BASE — le seul que cette variable attend :\n' +
          '        Project Settings → Database → Reset database password.\n' +
          "        Cet écran ne demande aucun mot de passe actuel.\n\n" +
          '  Le serveur a reconnu ton projet — un identifiant erroné donnerait\n' +
          "  « Tenant or user not found ». Seul le mot de passe est en cause." +
          utilisateur,
      }
    }

    return {
      origine,
      explication:
        'Mot de passe refusé.\n\n' +
        '  Deux causes, dans cet ordre de probabilité :\n\n' +
        "  1. Le mot de passe dans l'URL contient un caractère qui casse une\n" +
        '     URL (? # / % @ : ou un espace). Ne l\'encode pas à la main :\n' +
        '     laisse MOT2PASSE dans DATABASE_URL et ajoute plutôt\n' +
        '       DATABASE_PASSWORD="ton mot de passe exact"\n\n' +
        "  2. Ce n'est pas le bon mot de passe. Supabase → Project Settings\n" +
        '     → Database → Reset database password.' +
        utilisateur,
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
export function formaterErreurBase(
  erreur: unknown,
  contexte: ContexteConnexion = {},
): string {
  const { explication, origine } = expliquerErreurBase(erreur, contexte)
  return explication ? `${explication}\n\n  Message d'origine : ${origine}` : origine
}
