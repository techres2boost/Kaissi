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

export function expliquerEchecReseau(
  erreur: unknown,
  url: string,
  /** Coque Android / iOS : les appels passent en natif, CORS ne s'applique pas. */
  natif = false,
): string {
  const origine = erreur instanceof Error ? erreur.message : String(erreur)

  // Déclarés SANS valeur : le `catch` ci-dessous retourne, donc un
  // initialiseur ne serait jamais lu — et laisserait croire à un repli qui
  // n'existe pas.
  let hote: string
  let protocole: string
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

  const sante = `${url.replace(/\/+$/, '')}/sante`

  /*
   * Hôte HTTPS distant + « Failed to fetch » : DEUX causes, dans cet ordre.
   *
   * ⚑ PANNE DE DIAGNOSTIC OBSERVÉE. Ce message affirmait « blocage CORS »
   *   d'emblée. Le serveur Railway, lui, ne démarrait même pas (build en
   *   échec) — et son « Not Found » arrive SANS en-tête CORS, donc le
   *   navigateur le traduit lui aussi en « Failed to fetch ». On a ajusté
   *   SYNC_ORIGINES pendant une heure pour un serveur éteint.
   *
   *   1. Le serveur ne répond pas (éteint, en redéploiement, mauvaise
   *      adresse). C'est le cas le plus fréquent, et il se vérifie en une
   *      seconde : `/sante` doit afficher « etat : ok ».
   *   2. Il répond, mais n'autorise pas CE POS (CORS). Seulement dans un
   *      navigateur : la coque native appelle hors navigateur, CORS ne s'y
   *      applique pas — l'évoquer là enverrait chercher au mauvais endroit.
   */
  if (natif) {
    return (
      `Serveur injoignable. Ouvre « ${sante} » dans un navigateur : il doit ` +
      `afficher « etat : ok ». Sinon, le serveur est éteint ou en cours de ` +
      `redéploiement — la caisse, elle, continue d'encaisser. — ${origine}`
    )
  }

  const moi =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : "l'adresse de ce POS"
  return (
    `Serveur injoignable depuis ce navigateur. Deux causes possibles :\n` +
    `1. Le serveur ne répond pas. Ouvre « ${sante} » : il doit afficher ` +
    `« etat : ok ». Sinon, il est éteint ou en redéploiement (sur Railway, ` +
    `regarde le dernier déploiement).\n` +
    `2. Si « /sante » répond bien, le serveur refuse ce POS (CORS) : la ` +
    `variable SYNC_ORIGINES doit CONTENIR « ${moi} », sans barre oblique ` +
    `finale, puis redéploie. — ${origine}`
  )
}
