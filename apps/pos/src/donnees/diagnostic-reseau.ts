/**
 * Traduction des échecs d'appel au serveur de synchronisation.
 *
 * `fetch` ne rend qu'un « Failed to fetch » pour des causes très
 * différentes — serveur éteint, mauvaise adresse, refus du navigateur. Le
 * gérant qui appaire une tablette n'a aucun moyen de trancher, et les
 * gestes à faire n'ont rien à voir entre eux.
 */

/** Vrai pour les adresses de boucle locale, vues DEPUIS la tablette. */
function estBoucleLocale(hote: string): boolean {
  return hote === 'localhost' || hote === '127.0.0.1' || hote === '::1'
}

export function expliquerEchecReseau(erreur: unknown, url: string): string {
  const origine = erreur instanceof Error ? erreur.message : String(erreur)

  let hote = ''
  let protocole = ''
  try {
    const analysee = new URL(url)
    hote = analysee.hostname
    protocole = analysee.protocol
  } catch {
    return `Adresse invalide. Attendu : http://10.0.2.2:8787 ou https://…`
  }

  // La confusion la plus fréquente sur émulateur : « localhost » désigne la
  // TABLETTE, jamais le PC. Rien dans le message d'origine ne le dit.
  if (estBoucleLocale(hote)) {
    return (
      `Serveur injoignable — « ${hote} » désigne la tablette elle-même, ` +
      `pas ton PC. Depuis un émulateur Android, la machine hôte s'appelle ` +
      `10.0.2.2. Sur une vraie tablette, mets l'adresse du PC sur le Wi-Fi ` +
      `(192.168.…). — ${origine}`
    )
  }

  if (protocole === 'http:') {
    return (
      `Serveur injoignable. Vérifie que « pnpm sync:dev » tourne et affiche ` +
      `« connexion vérifiée », et que le pare-feu Windows laisse passer le ` +
      `port. En HTTP, seule l'adresse de développement 10.0.2.2 est ` +
      `autorisée ; en production, l'API doit être en HTTPS. — ${origine}`
    )
  }

  // Hôte HTTPS distant + « Failed to fetch » = presque toujours CORS. Le
  // serveur RÉPOND (curl .../sante le prouve), mais il n'autorise pas CE
  // POS : le navigateur jette alors la réponse, et `fetch` ne peut pas dire
  // pourquoi — la spécification le lui interdit. On donne donc le geste, et
  // l'adresse EXACTE à autoriser.
  const moi =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : "l'adresse de ce POS"
  return (
    `Le serveur répond peut-être, mais il refuse ce terminal (blocage CORS). ` +
    `Sur le serveur de synchronisation (Railway), la variable SYNC_ORIGINES ` +
    `doit CONTENIR « ${moi} » — plusieurs adresses séparées par des virgules, ` +
    `sans barre oblique finale — puis redéploie. Vérifie aussi que le serveur ` +
    `répond : ouvre « ${url.replace(/\/+$/, '')}/sante » dans un navigateur. ` +
    `— ${origine}`
  )
}
