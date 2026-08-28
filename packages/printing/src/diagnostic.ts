/**
 * Traduction des pannes d'impression réseau.
 *
 * Le plugin natif remonte le message brut de Java :
 *
 *   failed to connect to /10.0.2.2 (port 9100) from /10.0.2.16 (port 58972)
 *   after 4000ms: isConnected failed: ECONNREFUSED (Connection refused)
 *
 * Un gérant de snack ne peut rien en faire, et c'est pourtant lui qui est
 * devant la tablette à 20 h quand les bons ne sortent plus. Ces trois codes
 * couvrent la quasi-totalité des cas de terrain, et chacun appelle un geste
 * DIFFÉRENT — d'où l'intérêt de les distinguer plutôt que d'afficher
 * « erreur d'impression ».
 *
 * Le message d'origine est TOUJOURS conservé : sans lui, un cas qu'on n'a
 * pas prévu devient indiagnosticable au téléphone.
 */

export interface DiagnosticImpression {
  /** Une phrase, en français, qui dit quoi faire. */
  readonly explication: string
  /** Le message brut du système, conservé tel quel. */
  readonly origine: string
}

export function expliquerErreurImpression(message: string): DiagnosticImpression {
  const m = message.toLowerCase()

  // L'hôte a répondu, mais RIEN n'écoute sur ce port. C'est le cas le plus
  // fréquent en développement : l'imprimante virtuelle n'est pas lancée.
  if (m.includes('econnrefused') || m.includes('connection refused')) {
    return {
      explication:
        "La machine répond, mais rien n'écoute sur ce port. L'imprimante est " +
        "éteinte, en veille, ou le port n'est pas 9100. En développement : " +
        "l'imprimante virtuelle n'est pas lancée sur le PC.",
      origine: message,
    }
  }

  // Personne n'a répondu du tout : mauvaise adresse, autre sous-réseau, ou
  // isolation client sur la borne Wi-Fi.
  if (
    m.includes('etimedout') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('ehostunreach') ||
    m.includes('unreachable') ||
    m.includes('network is unreachable')
  ) {
    return {
      explication:
        "Personne ne répond à cette adresse. Vérifier l'adresse IP, et que la " +
        "tablette est bien sur le même réseau que l'imprimante — l'isolation " +
        "client d'une borne Wi-Fi produit exactement ce symptôme.",
      origine: message,
    }
  }

  // Le nom n'a pas pu être résolu : on a saisi un nom au lieu d'une IP.
  if (m.includes('unable to resolve host') || m.includes('enotfound')) {
    return {
      explication:
        "Ce nom n'a pas pu être résolu. Saisir l'adresse IP de l'imprimante " +
        '(par exemple 192.168.1.50), pas un nom.',
      origine: message,
    }
  }

  if (m.includes('epipe') || m.includes('broken pipe') || m.includes('econnreset')) {
    return {
      explication:
        "La connexion s'est ouverte puis a été coupée en cours d'envoi. " +
        "L'imprimante s'est éteinte, ou un autre appareil imprime en même temps.",
      origine: message,
    }
  }

  return { explication: '', origine: message }
}

/** Rend le diagnostic sur une seule ligne, pour un tableau. */
export function formaterErreurImpression(message: string): string {
  const { explication, origine } = expliquerErreurImpression(message)
  return explication ? `${explication} (${origine})` : origine
}
